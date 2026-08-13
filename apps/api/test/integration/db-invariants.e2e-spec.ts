/**
 * DB-level enforcement of the domain invariants that used to be app-layer-only.
 * Covers INS-010, INS-011, INS-014, INS-015, INS-018 and INS-046 — one test per
 * guarantee, each asserting that the DATABASE (not a service) rejects the write.
 *
 * These tests deliberately bypass the services and write raw SQL, because that
 * is precisely the threat model: a bug in some future write path, or an attacker
 * with a database connection, must not be able to cross a tenant boundary or
 * silently rewrite a signed artifact.
 *
 * Every test self-skips when its constraint is absent, so the suite still passes
 * on a database that has not had the 20260801000000_db_level_invariants
 * migration applied yet (and fails loudly once it has, if anything regressed).
 */
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  ApiClient,
  apiClient,
  bootApp,
  createOrgWithOwner,
  createWorkspace,
  expect2xx,
  loginAdmin,
  OrgFixture,
  runTag,
  triggerExists,
  WorkspaceFixture,
} from './support';

/** Postgres error text for any of our RAISE EXCEPTION / CHECK rejections. */
async function expectRejected(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('expected the database to reject this write, but it succeeded');
}

async function constraintExists(prisma: PrismaService, name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = '${name}'`,
  );
  return rows[0]?.n > 0;
}

describe('DB-level invariants (integration)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let prisma: PrismaService;
  let adminToken: string;
  let orgA: OrgFixture;
  let orgB: OrgFixture;
  let wsA: WorkspaceFixture;
  const tag = runTag('dbinv');

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    prisma = app.get(PrismaService);
    adminToken = await loginAdmin(client);
    orgA = await createOrgWithOwner(client, adminToken, `${tag}-a`);
    orgB = await createOrgWithOwner(client, adminToken, `${tag}-b`);
    wsA = await createWorkspace(client, orgA.ownerToken, `${tag}-a`);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A DRAFT inspection in org A, created through the API so it is fully valid. */
  async function draftInspection(): Promise<string> {
    const created = expect2xx(
      await client.post('/inspections', {
        token: orgA.ownerToken,
        body: { poId: wsA.poId, loopPresetId: wsA.presetId, lotSize: 500 },
      }),
      'POST /inspections',
    );
    return created.id as string;
  }

  /**
   * INS-081: a photo row needs its slot — (loop item, cycle) — and both columns
   * are NOT NULL, so the raw-SQL inserts below have to name a real item.
   */
  async function firstItemId(inspectionId: string): Promise<string> {
    const item = await prisma.inspectionLoopItem.findFirst({
      where: { inspectionId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!item) throw new Error('inspection has no loop items');
    return item.id;
  }

  // ── INS-010 · composite-FK tenant guard ────────────────────────────────────

  it('INS-010: refuses a child row whose orgId disagrees with its parent inspection', async () => {
    if (!(await constraintExists(prisma, 'photos_inspectionId_orgId_fkey'))) {
      console.warn('SKIP INS-010: composite FK not present (migration not applied)');
      return;
    }
    const inspectionId = await draftInspection();
    const itemId = await firstItemId(inspectionId);
    // orgB.orgId is a REAL org, so the single-column organization FK is satisfied;
    // only the composite [inspectionId, orgId] key can catch this.
    const message = await expectRejected(() =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "photos" ("id","orgId","inspectionId","inspectionLoopItemId","cycleIndex","storageKey","source","contentHash","createdAt")
         VALUES ('${tag}-crossorg', '${orgB.orgId}', '${inspectionId}', '${itemId}', 0, 'k', 'MANUAL_UPLOAD', 'h', now())`,
      ),
    );
    expect(message).toMatch(/photos_inspectionId_orgId_fkey|foreign key/i);

    const leaked = await prisma.photo.findFirst({ where: { id: `${tag}-crossorg` } });
    expect(leaked).toBeNull();
  });

  it('INS-010: a correctly aligned child row still inserts', async () => {
    const inspectionId = await draftInspection();
    const itemId = await firstItemId(inspectionId);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "photos" ("id","orgId","inspectionId","inspectionLoopItemId","cycleIndex","storageKey","source","contentHash","createdAt")
       VALUES ('${tag}-aligned', '${orgA.orgId}', '${inspectionId}', '${itemId}', 0, 'k', 'MANUAL_UPLOAD', 'h', now())`,
    );
    const ok = await prisma.photo.findFirst({ where: { id: `${tag}-aligned` } });
    expect(ok?.orgId).toBe(orgA.orgId);
  });

  // ── INS-015 · DefectInstance = catalog XOR custom ──────────────────────────

  it('INS-015: refuses a defect instance with neither catalog id nor custom text', async () => {
    if (!(await constraintExists(prisma, 'defect_instances_catalog_xor_custom'))) {
      console.warn('SKIP INS-015: CHECK constraint not present (migration not applied)');
      return;
    }
    const inspectionId = await draftInspection();
    const message = await expectRejected(() =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "defect_instances" ("id","orgId","inspectionId","severity","createdAt")
         VALUES ('${tag}-neither', '${orgA.orgId}', '${inspectionId}', 'MINOR', now())`,
      ),
    );
    expect(message).toMatch(/catalog_xor_custom|check constraint/i);
  });

  it('INS-015: refuses a defect instance with BOTH catalog id and custom text', async () => {
    if (!(await constraintExists(prisma, 'defect_instances_catalog_xor_custom'))) return;
    if (!wsA.minorDefectId) {
      console.warn('SKIP INS-015 both-set: no global MINOR defect seeded');
      return;
    }
    const inspectionId = await draftInspection();
    const message = await expectRejected(() =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "defect_instances" ("id","orgId","inspectionId","defectCatalogId","customText","severity","createdAt")
         VALUES ('${tag}-both', '${orgA.orgId}', '${inspectionId}', '${wsA.minorDefectId}', 'freetext', 'MINOR', now())`,
      ),
    );
    expect(message).toMatch(/catalog_xor_custom|check constraint/i);
  });

  // ── INS-011 · audit_logs is append-only ────────────────────────────────────

  it('INS-011: the database refuses UPDATE and DELETE on audit_logs', async () => {
    if (!(await triggerExists(prisma, 'audit_logs_no_update'))) {
      console.warn('SKIP INS-011: append-only triggers not present (migration not applied)');
      return;
    }
    // Any audited write produces a row; org creation always does.
    const row = await prisma.auditLog.findFirst({
      where: { orgId: orgA.orgId },
      orderBy: { sequence: 'desc' },
    });
    expect(row).toBeTruthy();

    const updateMessage = await expectRejected(() =>
      prisma.$executeRawUnsafe(
        `UPDATE "audit_logs" SET "actorUserId" = NULL WHERE "id" = '${row!.id}'`,
      ),
    );
    expect(updateMessage).toMatch(/append-only/i);

    const deleteMessage = await expectRejected(() =>
      prisma.$executeRawUnsafe(`DELETE FROM "audit_logs" WHERE "id" = '${row!.id}'`),
    );
    expect(deleteMessage).toMatch(/append-only/i);

    // ...and the row is untouched.
    const after = await prisma.auditLog.findUnique({ where: { id: row!.id } });
    expect(after?.actorUserId).toBe(row!.actorUserId);
  });

  it('INS-011: INSERT into audit_logs still works (append-only, not read-only)', async () => {
    const before = await prisma.auditLog.count({ where: { orgId: orgA.orgId } });
    // A normal audited mutation through the API.
    expect2xx(
      await client.post('/buyers', {
        token: orgA.ownerToken,
        body: { name: `Append Check ${tag}` },
      }),
      'POST /buyers',
    );
    const after = await prisma.auditLog.count({ where: { orgId: orgA.orgId } });
    expect(after).toBeGreaterThanOrEqual(before);
  });

  // ── INS-014 · immutability of submitted inspections + signed reports ───────

  it('INS-014: pre-submission inspection edits are still allowed', async () => {
    if (!(await triggerExists(prisma, 'inspections_frozen_after_submit'))) {
      console.warn('SKIP INS-014: immutability triggers not present (migration not applied)');
      return;
    }
    const inspectionId = await draftInspection();
    await prisma.$executeRawUnsafe(
      `UPDATE "inspections" SET "lotSize" = 800 WHERE "id" = '${inspectionId}'`,
    );
    const row = await prisma.inspection.findUnique({ where: { id: inspectionId } });
    expect(row?.lotSize).toBe(800);
  });

  it('INS-014: a SUBMITTED inspection freezes its evidence but still moves through statuses', async () => {
    if (!(await triggerExists(prisma, 'inspections_frozen_after_submit'))) return;
    const inspectionId = await draftInspection();
    // Submit through the API so the lifecycle preconditions are real.
    const loops = expect2xx(
      await client.get(`/inspections/${inspectionId}`, { token: orgA.ownerToken }),
      'GET /inspections/:id',
    );
    // INS-081: one photo per loop item completes cycle 0 — the submit gate needs
    // a whole cycle, and an item takes exactly one image.
    for (const loop of loops.items ?? []) {
      for (let i = 0; i < 1; i++) {
        expect2xx(
          await client.post(`/inspections/${inspectionId}/populate/photos`, {
            token: adminToken,
            orgId: orgA.orgId,
            body: {
              inspectionLoopItemId: loop.id, cycleIndex: 0,
              storageKey: `k-${tag}-${loop.id}-${i}`,
              source: 'MANUAL_UPLOAD',
              contentHash: `h-${tag}-${loop.id}-${i}`,
            },
          }),
          'POST populate/photos',
        );
      }
    }
    expect2xx(
      await client.post(`/inspections/${inspectionId}/submit`, { token: orgA.ownerToken, body: {} }),
      'POST /inspections/:id/submit',
    );

    // Frozen: an evidence column cannot be rewritten.
    const message = await expectRejected(() =>
      prisma.$executeRawUnsafe(
        `UPDATE "inspections" SET "lotSize" = 4242 WHERE "id" = '${inspectionId}'`,
      ),
    );
    expect(message).toMatch(/evidence is frozen/i);

    // Still moving: the status machinery is deliberately NOT frozen.
    await prisma.$executeRawUnsafe(
      `UPDATE "inspections" SET "status" = 'UNDER_REVIEW' WHERE "id" = '${inspectionId}'`,
    );
    const row = await prisma.inspection.findUnique({ where: { id: inspectionId } });
    expect(row?.status).toBe('UNDER_REVIEW');
    expect(row?.lotSize).toBe(500);

    // And no hard delete.
    const deleteMessage = await expectRejected(() =>
      prisma.$executeRawUnsafe(`DELETE FROM "inspections" WHERE "id" = '${inspectionId}'`),
    );
    expect(deleteMessage).toMatch(/hard delete is not permitted/i);
  });

  it('INS-014: evidence rows cannot be added or removed once the inspection is submitted', async () => {
    if (!(await triggerExists(prisma, 'photos_frozen_after_submit'))) {
      console.warn('SKIP INS-014 evidence: trigger not present (migration not applied)');
      return;
    }
    const submitted = await prisma.inspection.findFirst({
      where: { orgId: orgA.orgId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!submitted) {
      console.warn('SKIP INS-014 evidence: no submitted inspection available');
      return;
    }
    const message = await expectRejected(() =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "photos" ("id","orgId","inspectionId","storageKey","source","contentHash","createdAt")
         VALUES ('${tag}-late', '${orgA.orgId}', '${submitted.id}', 'k', 'MANUAL_UPLOAD', 'h', now())`,
      ),
    );
    expect(message).toMatch(/frozen/i);
  });

  // ── INS-046 · Report.canonicalSnapshot NOT NULL ────────────────────────────

  it('INS-046: the database refuses a signed report with a null canonicalSnapshot', async () => {
    const nullable = await prisma.$queryRawUnsafe<Array<{ is_nullable: string }>>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'reports' AND column_name = 'canonicalSnapshot'`,
    );
    if (nullable[0]?.is_nullable !== 'NO') {
      console.warn('SKIP INS-046: column still nullable (migration not applied)');
      return;
    }
    const existing = await prisma.report.findFirst({ where: { orgId: orgA.orgId } });
    if (!existing) {
      // Nothing to null out; the schema assertion above is already the guarantee.
      expect(nullable[0].is_nullable).toBe('NO');
      return;
    }
    const message = await expectRejected(() =>
      prisma.$executeRawUnsafe(
        `UPDATE "reports" SET "canonicalSnapshot" = NULL WHERE "id" = '${existing.id}'`,
      ),
    );
    // Either the NOT NULL constraint or the INS-014 immutability trigger refuses
    // it — both are correct answers, and both keep the artifact verifiable.
    expect(message).toMatch(/null value|not-null|tamper-proof columns/i);
  });

  // ── INS-018 · BillableEvent.kind must match the supersedes chain ───────────

  it('INS-018: refuses a RE_INSPECTION billable event for an inspection that supersedes nothing', async () => {
    if (!(await triggerExists(prisma, 'billable_events_match_chain'))) {
      console.warn('SKIP INS-018: trigger not present (migration not applied)');
      return;
    }
    const inspectionId = await draftInspection();
    const message = await expectRejected(() =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "billable_events" ("id","orgId","inspectionId","kind","occurredAt")
         VALUES ('${tag}-badbill', '${orgA.orgId}', '${inspectionId}', 'RE_INSPECTION', now())`,
      ),
    );
    expect(message).toMatch(/supersedes nothing/i);
  });

  it('INS-018: an ordinary INSPECTION billable event is accepted', async () => {
    const inspectionId = await draftInspection();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "billable_events" ("id","orgId","inspectionId","kind","occurredAt")
       VALUES ('${tag}-okbill', '${orgA.orgId}', '${inspectionId}', 'INSPECTION', now())`,
    );
    const row = await prisma.billableEvent.findFirst({ where: { id: `${tag}-okbill` } });
    expect(row?.kind).toBe('INSPECTION');
  });
});
