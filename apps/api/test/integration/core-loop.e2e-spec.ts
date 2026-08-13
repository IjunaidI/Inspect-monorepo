/**
 * INS-009 — the full inspection loop as a Jest integration test (the committed
 * smoke driver's 25 steps, folded into CI): admin login -> create org -> accept
 * owner invite -> workspace CRUD -> inspection -> cross-tenant Platform-Admin
 * populate -> submit (AQL) -> QA decision -> Ed25519-signed report -> public
 * verify -> guest magic-link fetch.
 *
 * Plus two invariants the smoke driver never asserted:
 *   - tamper evidence: mutating the stored canonicalSnapshot flips public
 *     verification to valid:false (the INS-038 guarantee, exercised at the DB)
 *   - immutability: populate writes are rejected once the inspection is locked
 */
import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
  setReportsImmutabilityTrigger,
  WorkspaceFixture,
} from './support';

describe('Core inspection loop (integration)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let adminToken: string;
  let org: OrgFixture;
  let ws: WorkspaceFixture;
  const tag = runTag('loop');

  // Cross-test state, in loop order.
  let inspectionId: string;
  let loopId: string;
  let photoId: string;
  let reportId: string;
  let verificationToken: string;

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    adminToken = await loginAdmin(client);
    org = await createOrgWithOwner(client, adminToken, tag);
    ws = await createWorkspace(client, org.ownerToken, tag);
  });

  afterAll(async () => {
    await app.close();
  });

  it('buyer list carries live relation counts (INS-005)', async () => {
    const buyers = expect2xx(
      await client.get('/buyers', { token: org.ownerToken }),
      'GET /buyers (_count)',
    ) as Array<{ id: string; _count?: Record<string, number> }>;
    const mine = buyers.find((b) => b.id === ws.buyerId);
    expect(mine).toBeTruthy();
    expect(mine!._count?.purchaseOrders).toBe(1);
    expect(mine!._count?.reports).toBe(0); // none generated yet at this point
  });

  it('creates an inspection with a snapshotted preset and computed AQL sampling (lot 1000 -> code J)', async () => {
    const inspection = expect2xx(
      await client.post('/inspections', {
        token: org.ownerToken,
        body: {
          poId: ws.poId,
          loopPresetId: ws.presetId,
          lotSize: 1000,
          clientRequestId: `e2e-${tag}`,
        },
      }),
      'POST /inspections',
    );
    inspectionId = inspection.id;
    loopId = inspection.items?.[0]?.id;
    expect(inspectionId).toBeTruthy();
    expect(loopId).toBeTruthy();
    expect(inspection.computedSampling?.sampleSizeCodeLetter).toBe('J');
    expect(inspection.computedSampling?.sampleSize).toBe(80);
  });

  it('replays inspection create idempotently on the same clientRequestId', async () => {
    const replay = expect2xx(
      await client.post('/inspections', {
        token: org.ownerToken,
        body: {
          poId: ws.poId,
          loopPresetId: ws.presetId,
          lotSize: 1000,
          clientRequestId: `e2e-${tag}`,
        },
      }),
      'POST /inspections (replay)',
    );
    expect(replay.id).toBe(inspectionId);
  });

  it('populates as the cross-tenant Platform Admin: presign, register into a slot, tag, measure', async () => {
    const presign = expect2xx(
      await client.post(`/inspections/${inspectionId}/populate/photos/presign`, {
        token: adminToken,
        body: { ext: 'jpg' },
      }),
      'populate presign',
    );
    expect(presign.storageKey).toBeTruthy();
    expect(presign.uploadUrl).toBeTruthy();

    const contentHash = createHash('sha256').update(`e2e-photo-${tag}`).digest('hex');
    const photo = expect2xx(
      await client.post(`/inspections/${inspectionId}/populate/photos`, {
        token: adminToken,
        body: {
          storageKey: presign.storageKey,
          contentHash,
          inspectionLoopItemId: loopId, cycleIndex: 0,
          clientRequestId: `photo-${tag}`,
        },
      }),
      'populate register photo',
    );
    photoId = photo.id;
    expect(photoId).toBeTruthy();

    // INS-081: registration already placed the photo in its slot — the old
    // assign-to-loop step no longer exists.

    const defectBody = {
      ...(ws.minorDefectId
        ? { defectCatalogId: ws.minorDefectId, notes: 'e2e' }
        : { customText: 'Loose thread (e2e)', severity: 'MINOR' }),
      inspectionLoopItemId: loopId, cycleIndex: 0,
      photoIds: [photoId],
      clientRequestId: `defect-${tag}`,
    };
    const defect = expect2xx(
      await client.post(`/inspections/${inspectionId}/populate/defects`, {
        token: adminToken,
        body: defectBody,
      }),
      'populate tag defect',
    );
    expect(defect.severity).toBe('MINOR');

    // INS-044: replaying the same clientRequestId returns the ORIGINAL row —
    // a duplicate here would change the AQL count and could flip the verdict.
    const replay = expect2xx(
      await client.post(`/inspections/${inspectionId}/populate/defects`, {
        token: adminToken,
        body: defectBody,
      }),
      'populate tag defect (replay)',
    );
    expect(replay.id).toBe(defect.id);

    const measurement = expect2xx(
      await client.post(`/inspections/${inspectionId}/populate/measurements`, {
        token: adminToken,
        body: { cycleIndex: 0, label: 'Length', recordedValue: '42.0', unit: 'cm' },
      }),
      'populate record measurement',
    );
    expect(measurement.id).toBeTruthy();
  });

  it('inspection detail returns the loop evidence on reload (photos/defects/measurements)', async () => {
    const detail = expect2xx(
      await client.get(`/inspections/${inspectionId}`, { token: org.ownerToken }),
      'GET /inspections/:id (evidence includes)',
    );
    const loop = detail.items?.find((l: { id: string }) => l.id === loopId);
    expect(loop).toBeTruthy();
    expect(loop.photos?.some((p: { id: string }) => p.id === photoId)).toBe(true);
    // Exactly one: the INS-044 replay above must not have created a duplicate.
    expect(loop.defects?.length).toBe(1);
    // INS-081: measurements are per-CYCLE and hang off the inspection, not the item.
    expect(
      detail.measurements?.some((m: { label: string; cycleIndex: number }) => m.label === 'Length' && m.cycleIndex === 0),
    ).toBe(true);
  });

  it('submit runs the AQL evaluation: 1 MINOR on code J -> SUBMITTED with PASS recommendation', async () => {
    const submitted = expect2xx(
      await client.post(`/inspections/${inspectionId}/submit`, {
        token: org.ownerToken,
        body: { deviceId: 'e2e-device', gps: { lat: 0, lng: 0 } },
      }),
      'POST /inspections/:id/submit',
    );
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.aqlResult?.systemRecommendation).toBe('PASS');
  });

  it('rejects populate writes once the inspection is locked (immutability)', async () => {
    const res = await client.post(`/inspections/${inspectionId}/populate/measurements`, {
      token: adminToken,
      body: { cycleIndex: 0, label: 'Late', recordedValue: '1', unit: 'cm' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('records the binding QA decision: PASS -> APPROVED', async () => {
    const decided = expect2xx(
      await client.post(`/inspections/${inspectionId}/decision`, {
        token: org.ownerToken,
        body: { decision: 'PASS', remarks: 'e2e pass' },
      }),
      'POST /inspections/:id/decision',
    );
    expect(decided.status).toBe('APPROVED');
  });

  it('generates the Ed25519-signed report, idempotently', async () => {
    const report = expect2xx(
      await client.post(`/inspections/${inspectionId}/report`, { token: org.ownerToken }),
      'POST /inspections/:id/report',
    );
    reportId = report.id;
    verificationToken = report.verificationToken;
    expect(reportId).toBeTruthy();
    expect(verificationToken).toBeTruthy();
    expect(report.signature).toBeTruthy();

    const again = expect2xx(
      await client.post(`/inspections/${inspectionId}/report`, { token: org.ownerToken }),
      'POST /inspections/:id/report (regenerate)',
    );
    expect(again.id).toBe(reportId);
  });

  it('publicly verifies the signed report (no auth)', async () => {
    const verify = expect2xx(
      await client.get(`/reports/verify/${verificationToken}`),
      'GET /reports/verify/:token',
    );
    expect(verify.valid).toBe(true);
    expect(verify.hashMatches).toBe(true);
    expect(verify.signatureValid).toBe(true);
  });

  it('detects DB-level tampering with the signed content (INS-038 guarantee)', async () => {
    const prisma = app.get(PrismaService);
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    expect(report).toBeTruthy();
    const original = report!.canonicalSnapshot as Record<string, unknown>;

    // INS-014 added a BEFORE UPDATE trigger that REFUSES to change a signed
    // report's tamper-proof columns, so this test can no longer tamper through
    // an ordinary UPDATE — which is the point of that trigger. To keep proving
    // the INS-038 DETECTION guarantee we deliberately step around the
    // PREVENTION layer, modelling an attacker who reached the database with
    // owner rights. (That residual risk is documented in
    // docs/reference/inspect-schema.md: full protection needs a least-privilege
    // application role that does not own the tables.)
    await setReportsImmutabilityTrigger(prisma, false);
    // An attacker with DB write access edits a buyer-visible field post-signing.
    // Restore in finally: if an assertion throws (or the run is killed), the
    // shared DB must not keep a permanently-tampered signed report row — and the
    // protection trigger must not stay disabled.
    await prisma.report.update({
      where: { id: reportId },
      data: { canonicalSnapshot: { ...original, lotSize: 999999 } },
    });
    try {
      const tampered = expect2xx(
        await client.get(`/reports/verify/${verificationToken}`),
        'GET /reports/verify/:token (tampered)',
      );
      expect(tampered.valid).toBe(false);
      expect(tampered.hashMatches).toBe(false);
    } finally {
      await prisma.report.update({
        where: { id: reportId },
        data: { canonicalSnapshot: original as any },
      });
      await setReportsImmutabilityTrigger(prisma, true);
    }
    const restored = expect2xx(
      await client.get(`/reports/verify/${verificationToken}`),
      'GET /reports/verify/:token (restored)',
    );
    expect(restored.valid).toBe(true);
  });

  it('the org owner fetches the report; other tenants cannot', async () => {
    const fetched = expect2xx(
      await client.get(`/reports/${reportId}`, { token: org.ownerToken }),
      'GET /reports/:id',
    );
    expect(fetched.id).toBe(reportId);

    const foreignOrg = await createOrgWithOwner(client, adminToken, `${tag}-foreign`);
    const res = await client.get(`/reports/${reportId}`, { token: foreignOrg.ownerToken });
    expect(res.status).toBe(404);
  });

  it('a buyer guest fetches the report through the public magic link', async () => {
    const guestRes = expect2xx(
      await client.post(`/buyers/${ws.buyerId}/guests`, {
        token: org.ownerToken,
        body: { email: `guest+${tag}@e2e.local` },
      }),
      'POST /buyers/:buyerId/guests',
    );
    expect(guestRes.token).toBeTruthy();

    const guestReports = expect2xx(
      await client.get(`/guest/reports?token=${encodeURIComponent(guestRes.token)}`),
      'GET /guest/reports (public magic link)',
    );
    expect(Array.isArray(guestReports)).toBe(true);
    expect((guestReports as any[]).some((r) => r.id === reportId)).toBe(true);
  });
});
