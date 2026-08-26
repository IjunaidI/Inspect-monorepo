/**
 * INS-079: a Platform Admin may assume an org and operate inside it. These tests
 * are the tenant boundary and the audit-honesty proof — the two things that make
 * the feature safe.
 */
import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { verifyChain } from '../../src/audit/audit-chain';
import {
  ApiClient,
  apiClient,
  bootApp,
  createOrgWithOwner,
  createWorkspace,
  expect2xx,
  loginAdmin,
  runTag,
} from './support';

describe('Platform-Admin org assumption (INS-079)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let adminToken: string;
  let orgA: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let orgB: Awaited<ReturnType<typeof createOrgWithOwner>>;
  let buyerAName: string;
  let buyerBName: string;

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    adminToken = await loginAdmin(client);
    orgA = await createOrgWithOwner(client, adminToken, runTag('assume-a'));
    orgB = await createOrgWithOwner(client, adminToken, runTag('assume-b'));

    buyerAName = `Assume Buyer ${runTag('a')}`;
    buyerBName = `Assume Buyer ${runTag('b')}`;
    expect2xx(
      await client.post('/companies', {
        token: orgA.ownerToken,
        body: { name: buyerAName },
      }),
      'POST /buyers (org A)',
    );
    expect2xx(
      await client.post('/companies', {
        token: orgB.ownerToken,
        body: { name: buyerBName },
      }),
      'POST /buyers (org B)',
    );
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('still 403s an admin with no assumed org', async () => {
    const res = await client.get('/companies', { token: adminToken });
    expect(res.status).toBe(403);
  });

  it('reads the assumed org and only the assumed org', async () => {
    const a = expect2xx(
      await client.get('/companies', { token: adminToken, orgId: orgA.orgId }),
      'GET /companies (assuming org A)',
    ) as { name: string }[];
    expect(a.some((b) => b.name === buyerAName)).toBe(true);

    const b = expect2xx(
      await client.get('/companies', { token: adminToken, orgId: orgB.orgId }),
      'GET /companies (assuming org B)',
    ) as { name: string }[];
    expect(b.some((x) => x.name === buyerAName)).toBe(false);
    // Positive control: org B's list must not simply be empty/irrelevant —
    // it must actually be org B's own data.
    expect(b.some((x) => x.name === buyerBName)).toBe(true);
  });

  // The tenant boundary: the header must do nothing at all for a non-admin.
  it('ignores X-Org-Id from an ORG_OWNER — no leak, no error', async () => {
    const res = await client.get('/companies', {
      token: orgB.ownerToken,
      orgId: orgA.orgId,
    });
    const rows = expect2xx(res, 'GET /companies (owner B spoofing org A)') as {
      name: string;
    }[];
    expect(rows.some((x) => x.name === buyerAName)).toBe(false);
    // Positive control: a 200 with an empty/irrelevant list would satisfy the
    // assertion above vacuously. Proving the response is genuinely owner B's
    // own (unaffected) org data is what shows the header was truly ignored.
    expect(rows.some((x) => x.name === buyerBName)).toBe(true);
  });

  it('attributes an assumed-org write to PLATFORM_ADMIN with the real admin id', async () => {
    const created = expect2xx(
      await client.post('/companies', {
        token: adminToken,
        orgId: orgA.orgId,
        body: { name: `Admin-made Buyer ${runTag('adm')}` },
      }),
      'POST /buyers (assuming org A)',
    );
    // Archive is DELETE /buyers/:id (CompaniesController), not a dedicated
    // /:id/archive route.
    expect2xx(
      await client.delete(`/companies/${created.id}`, {
        token: adminToken,
        orgId: orgA.orgId,
      }),
      'DELETE /companies/:id (assuming org A)',
    );

    const me = expect2xx(
      await client.get('/auth/me', { token: adminToken }),
      'GET /auth/me',
    );

    // There is no audit read endpoint (verified: no @Controller('audit') exists),
    // so assert against the row directly. This is the whole point of the task —
    // an admin's in-tenant write must not look like an org member's.
    const prisma = new PrismaClient();
    try {
      const row = await prisma.auditLog.findFirst({
        where: {
          orgId: orgA.orgId,
          action: 'company.archived',
          entityId: created.id,
        },
      });
      expect(row).toBeTruthy();
      expect(row!.actorType).toBe('PLATFORM_ADMIN');
      expect(row!.actorUserId).toBe(me.userId);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("leaves org A's audit chain verifiable after an assumed-org write", async () => {
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.auditLog.findMany({
        where: { orgId: orgA.orgId },
        orderBy: { sequence: 'asc' },
      });
      expect(rows.length).toBeGreaterThan(0);
      // Full hash-chain verification (sequence monotonicity + prevEntryHash
      // linkage), not just a sequence-gap check: an admin write must not fork
      // or break the chain it joins.
      expect(verifyChain(rows)).toBe(true);
      // Keyed to the write actually under test (org A's beforeAll fixture
      // also logs a PLATFORM_ADMIN 'org.created' row, so a bare actorType
      // check would pass even if attribution on THIS write regressed).
      expect(
        rows.some(
          (r) =>
            r.action === 'company.archived' && r.actorType === 'PLATFORM_ADMIN',
        ),
      ).toBe(true);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('does not let an assumed admin mint another PLATFORM_ADMIN', async () => {
    const res = await client.post('/users', {
      token: adminToken,
      orgId: orgA.orgId,
      body: {
        name: 'Escalation Attempt',
        email: `escalate+${runTag('x')}@e2e.local`,
        password: 'NotAllowed!12345',
        role: 'PLATFORM_ADMIN',
      },
    });
    expect(res.status).toBe(403);
  });

  it('403s an ORG_OWNER on POST /admin/orgs', async () => {
    const res = await client.post('/admin/orgs', {
      token: orgA.ownerToken,
      body: {
        name: 'Should Not Exist',
        type: 'INSPECTION_COMPANY',
        ownerEmail: `no+${runTag('n')}@e2e.local`,
      },
    });
    expect(res.status).toBe(403);
  });

  // Extra (beyond the brief): ReportsService.generate(orgId, actor, inspectionId)
  // now threads `actor` all the way through to the audit row for
  // 'report.generated' (previously it had no actorUserId at all). That change
  // has no unit spec of its own — generate() needs Prisma + Ed25519 signing +
  // canonical-snapshot machinery — so this integration test is the only place
  // it is covered. It drives a full inspection lifecycle (mirroring
  // core-loop.e2e-spec.ts) as the org owner, then has the ASSUMING admin
  // perform the final report-generation call, and asserts the resulting audit
  // row is attributed to the admin, not to the org.
  it('attributes report generation by an assuming admin to PLATFORM_ADMIN with the real admin id', async () => {
    const tag = runTag('rpt');
    const ws = await createWorkspace(client, orgA.ownerToken, tag);

    const inspection = expect2xx(
      await client.post('/inspections', {
        token: orgA.ownerToken,
        body: {
          poId: ws.poId,
          loopPresetId: ws.presetId,
          lotSize: 1000,
          clientRequestId: `e2e-${tag}`,
        },
      }),
      'POST /inspections',
    );
    const inspectionId = inspection.id as string;
    const loopId = inspection.items?.[0]?.id as string;
    expect(inspectionId).toBeTruthy();
    expect(loopId).toBeTruthy();

    // Populate as the (already cross-tenant) Platform Admin — no assumed org
    // needed for this Platform-Admin-only surface (verified against
    // populate.service.ts's loadForPopulate: it looks the inspection up by id
    // only, matching the write routes' established cross-tenant contract).
    const presign = expect2xx(
      await client.post(
        `/inspections/${inspectionId}/populate/photos/presign`,
        {
          token: adminToken,
          body: { ext: 'jpg' },
        },
      ),
      'populate presign',
    );
    const contentHash = createHash('sha256')
      .update(`e2e-photo-${tag}`)
      .digest('hex');
    // The binding is unused — expect2xx is what asserts the 2xx here.
    expect2xx(
      await client.post(`/inspections/${inspectionId}/populate/photos`, {
        token: adminToken,
        body: {
          storageKey: presign.storageKey,
          contentHash,
          inspectionLoopItemId: loopId,
          cycleIndex: 0,
          clientRequestId: `photo-${tag}`,
        },
      }),
      'populate register photo',
    );
    // INS-081: the photo already landed in its (item, cycle) slot at registration —
    // there is no separate assign step, and no floating photo to assign.

    // Submit + QA decision as the org owner (same as the core loop).
    const submitted = expect2xx(
      await client.post(`/inspections/${inspectionId}/submit`, {
        token: orgA.ownerToken,
        body: { deviceId: 'e2e-device', gps: { lat: 0, lng: 0 } },
      }),
      'POST /inspections/:id/submit',
    );
    expect(submitted.status).toBe('SUBMITTED');

    const decided = expect2xx(
      await client.post(`/inspections/${inspectionId}/decision`, {
        token: orgA.ownerToken,
        body: { decision: 'PASS', remarks: 'e2e pass' },
      }),
      'POST /inspections/:id/decision',
    );
    expect(decided.status).toBe('APPROVED');

    // The point of this test: the ASSUMING admin (not the org owner) generates
    // the report.
    const report = expect2xx(
      await client.post(`/inspections/${inspectionId}/report`, {
        token: adminToken,
        orgId: orgA.orgId,
      }),
      'POST /inspections/:id/report (assuming org A)',
    );
    expect(report.id).toBeTruthy();

    const me = expect2xx(
      await client.get('/auth/me', { token: adminToken }),
      'GET /auth/me',
    );

    const prisma = new PrismaClient();
    try {
      const row = await prisma.auditLog.findFirst({
        where: {
          orgId: orgA.orgId,
          action: 'report.generated',
          entityId: report.id,
        },
      });
      expect(row).toBeTruthy();
      expect(row!.actorType).toBe('PLATFORM_ADMIN');
      expect(row!.actorUserId).toBe(me.userId);
    } finally {
      await prisma.$disconnect();
    }
  });
});
