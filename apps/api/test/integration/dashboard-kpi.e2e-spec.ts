/**
 * INS-068 — GET /dashboard/summary KPIs against a hand-computed fixture.
 *
 * Two freshly created orgs, so every number below is exact rather than "at
 * least": org A runs two inspections to a binding QA decision (one PASS with a
 * single MINOR defect, one FAIL with a clean lot), org Z is left empty and then
 * given exactly one FAIL. The suite asserts:
 *   - the per-status breakdown the console now renders as tiles
 *   - the qaDecision rollup (PASS/FAIL/HOLD/PENDING)
 *   - DPHU + passRate matching the arithmetic done by hand here
 *   - the zero-state: nothing decided -> nulls/0, never NaN or a 500
 *   - tenant isolation in BOTH directions (A never sees Z's rows, Z never
 *     sees A's) — the metrics are the easiest place for a missing orgId filter
 *     to hide, because a leak shows up as a slightly-wrong number, not an error
 *   - the QA_MANAGER floor: an INSPECTOR is refused
 *
 * Fixture arithmetic (lot 1000 -> ISO 2859-1 code J -> sampleSize 80):
 *   org A: (1 MINOR / 80) decided PASS + (0 defects / 80) decided FAIL
 *          sampledUnits 160, defectsFound 1
 *          DPHU     = 100 × 1 / 160 = 0.625 -> 0.63 (2dp)
 *          passRate = 100 × 1 / 2   = 50    (HOLD excluded; there are none)
 *   org Z: (0 defects / 80) decided FAIL
 *          DPHU 0 (a clean lot — deliberately NOT null), passRate 0
 */
import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ApiClient,
  apiClient,
  bootApp,
  createOrgWithOwner,
  createWorkspace,
  expect2xx,
  inviteAndActivate,
  loginAdmin,
  OrgFixture,
  runTag,
  WorkspaceFixture,
} from './support';

interface Summary {
  inspectionsByStatus: Record<string, number>;
  qaDecisionCounts: {
    PASS: number;
    FAIL: number;
    HOLD: number;
    PENDING: number;
  };
  quality: {
    decidedInspections: number;
    sampledUnits: number;
    defectsFound: number;
    dphu: number | null;
    passRate: number | null;
    verdicts: number;
    truncated: boolean;
  };
  /** INS-055: one unified counterparty count (was `buyers` + `suppliers`). */
  companies: number;
  products: number;
  purchaseOrders: number;
  reports: number;
}

describe('Dashboard KPIs (integration, INS-068)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let adminToken: string;
  let orgA: OrgFixture;
  let wsA: WorkspaceFixture;
  let orgZ: OrgFixture;
  const tag = runTag('kpi');

  const summaryFor = async (token: string): Promise<Summary> =>
    expect2xx(
      await client.get('/dashboard/summary', { token }),
      'GET /dashboard/summary',
    );

  /**
   * Drive one inspection from create to a binding QA decision. Populate is
   * Platform-Admin-only in the MVP, so photos/defects go in on adminToken;
   * presign only signs a URL (no bytes are uploaded), which is all the
   * INS-056 photo-evidence gate needs.
   */
  const runInspection = async (
    org: OrgFixture,
    ws: WorkspaceFixture,
    opts: { label: string; defects: number; decision: 'PASS' | 'FAIL' },
  ): Promise<string> => {
    const inspection = expect2xx(
      await client.post('/inspections', {
        token: org.ownerToken,
        body: { poId: ws.poId, loopPresetId: ws.presetId, lotSize: 1000 },
      }),
      `POST /inspections (${opts.label})`,
    );
    const inspectionId: string = inspection.id;
    const loopId: string = inspection.items[0].id;
    // Lot 1000 -> code J -> n=80. The whole DPHU denominator rests on this.
    expect(inspection.computedSampling.sampleSize).toBe(80);

    const presign = expect2xx(
      await client.post(
        `/inspections/${inspectionId}/populate/photos/presign`,
        {
          token: adminToken,
          body: { ext: 'jpg' },
        },
      ),
      `presign (${opts.label})`,
    );
    expect2xx(
      await client.post(`/inspections/${inspectionId}/populate/photos`, {
        token: adminToken,
        body: {
          storageKey: presign.storageKey,
          contentHash: createHash('sha256')
            .update(`${tag}-${opts.label}`)
            .digest('hex'),
          inspectionLoopItemId: loopId,
          cycleIndex: 0,
        },
      }),
      `register photo (${opts.label})`,
    );

    for (let i = 0; i < opts.defects; i += 1) {
      expect2xx(
        await client.post(`/inspections/${inspectionId}/populate/defects`, {
          token: adminToken,
          body: {
            ...(ws.minorDefectId
              ? { defectCatalogId: ws.minorDefectId }
              : { customText: `KPI defect ${i}`, severity: 'MINOR' }),
            inspectionLoopItemId: loopId,
            cycleIndex: 0,
            clientRequestId: `kpi-${tag}-${opts.label}-${i}`,
          },
        }),
        `tag defect ${i} (${opts.label})`,
      );
    }

    expect2xx(
      await client.post(`/inspections/${inspectionId}/submit`, {
        token: org.ownerToken,
        body: { deviceId: 'kpi-e2e' },
      }),
      `submit (${opts.label})`,
    );
    expect2xx(
      await client.post(`/inspections/${inspectionId}/decision`, {
        token: org.ownerToken,
        body: { decision: opts.decision, remarks: `kpi ${opts.label}` },
      }),
      `decision (${opts.label})`,
    );
    return inspectionId;
  };

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    adminToken = await loginAdmin(client);
    orgA = await createOrgWithOwner(client, adminToken, `${tag}-a`);
    wsA = await createWorkspace(client, orgA.ownerToken, `${tag}-a`);
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('zero-state: a brand-new org reports nulls and zeros, never NaN', async () => {
    orgZ = await createOrgWithOwner(client, adminToken, `${tag}-z`);
    const summary = await summaryFor(orgZ.ownerToken);

    expect(summary.inspectionsByStatus).toEqual({});
    expect(summary.qaDecisionCounts).toEqual({
      PASS: 0,
      FAIL: 0,
      HOLD: 0,
      PENDING: 0,
    });
    expect(summary.quality).toEqual({
      decidedInspections: 0,
      sampledUnits: 0,
      defectsFound: 0,
      dphu: null,
      passRate: null,
      verdicts: 0,
      truncated: false,
    });
    // An explicit null (render "—"), not a NaN that JSON.stringify silently
    // turned into null on the way out.
    expect(summary.quality.dphu).toBeNull();
    expect(summary.quality.passRate).toBeNull();
  }, 120_000);

  it('org A: two decided inspections roll up to the hand-computed DPHU 0.63 / passRate 50', async () => {
    await runInspection(orgA, wsA, {
      label: 'pass',
      defects: 1,
      decision: 'PASS',
    });
    await runInspection(orgA, wsA, {
      label: 'fail',
      defects: 0,
      decision: 'FAIL',
    });

    const summary = await summaryFor(orgA.ownerToken);

    // The breakdown the console renders: PASS -> APPROVED, FAIL -> REJECTED.
    expect(summary.inspectionsByStatus).toEqual({ APPROVED: 1, REJECTED: 1 });
    expect(summary.qaDecisionCounts).toEqual({
      PASS: 1,
      FAIL: 1,
      HOLD: 0,
      PENDING: 0,
    });

    expect(summary.quality.decidedInspections).toBe(2);
    expect(summary.quality.sampledUnits).toBe(160); // 80 + 80
    expect(summary.quality.defectsFound).toBe(1); // the single MINOR
    expect(summary.quality.dphu).toBe(0.63); // 100 × 1 / 160 = 0.625 -> 0.63
    expect(summary.quality.passRate).toBe(50); // 100 × 1 / 2
    expect(summary.quality.verdicts).toBe(2);
    expect(summary.quality.truncated).toBe(false);
  }, 180_000);

  it('is tenant-isolated in both directions: org Z sees only its own decided lot', async () => {
    const wsZ = await createWorkspace(client, orgZ.ownerToken, `${tag}-z`);
    await runInspection(orgZ, wsZ, {
      label: 'z-fail',
      defects: 0,
      decision: 'FAIL',
    });

    const z = await summaryFor(orgZ.ownerToken);
    expect(z.inspectionsByStatus).toEqual({ REJECTED: 1 });
    expect(z.qaDecisionCounts).toEqual({
      PASS: 0,
      FAIL: 1,
      HOLD: 0,
      PENDING: 0,
    });
    expect(z.quality.decidedInspections).toBe(1);
    expect(z.quality.sampledUnits).toBe(80); // NOT 240 — org A's 160 must not leak in
    expect(z.quality.defectsFound).toBe(0);
    expect(z.quality.dphu).toBe(0); // a clean lot is 0, distinct from the null zero-state
    expect(z.quality.passRate).toBe(0);
    // INS-055: createWorkspace makes TWO companies — the one that plays the
    // client role and the one that plays the factory role — where it used to
    // make one buyer and one supplier. The point of the assertion is unchanged:
    // org Z's count is its own, and org A's rows never leak in.
    expect(z.companies).toBe(2);

    // ...and org A is unchanged by org Z's activity.
    const a = await summaryFor(orgA.ownerToken);
    expect(a.inspectionsByStatus).toEqual({ APPROVED: 1, REJECTED: 1 });
    expect(a.qaDecisionCounts).toEqual({
      PASS: 1,
      FAIL: 1,
      HOLD: 0,
      PENDING: 0,
    });
    expect(a.quality.sampledUnits).toBe(160);
    expect(a.quality.dphu).toBe(0.63);
    expect(a.quality.passRate).toBe(50);
  }, 180_000);

  it('keeps the QA_MANAGER floor: an INSPECTOR is refused the KPI summary', async () => {
    const inspector = await inviteAndActivate(client, orgA.ownerToken, {
      email: `inspector+${tag}@e2e.local`,
      role: 'INSPECTOR',
      password: `E2eInspector!${tag}`,
    });
    const res = await client.get('/dashboard/summary', {
      token: inspector.token,
    });
    expect(res.status).toBe(403);
  }, 120_000);
});
