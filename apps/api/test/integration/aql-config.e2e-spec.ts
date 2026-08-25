/**
 * INS-063 — the per-class AQL is configurable end-to-end, proven against the
 * real DB at the HTTP boundary.
 *
 * The AQL plan is the commercial heart of the product: it decides how many
 * defects a lot may carry before the QA Manager's binding call goes FAIL. Before
 * this item the value was effectively a constant (critical 0 / major 2.5 /
 * minor 4.0) no matter what a buyer agreement said. What must now hold:
 *
 *   - a configured plan is VALIDATED, STORED and COMPUTED (major 1.5 at lot 1000
 *     -> code letter J, Ac 3 / Re 4 — not the default's Ac 5 / Re 6);
 *   - an AQL outside the verified Z1.4 band is a 400 that NAMES the accepted
 *     values, never an unhandled 500 (the raw engine throws);
 *   - a lot whose code letter has no column for the requested AQL (lot 100 ->
 *     letter F) is a clean 400 from BOTH the preview and the create, so the
 *     screen can never show a plan the create would reject;
 *   - omitting the plan still yields the spec defaults (no silent behaviour change);
 *   - submit RE-DERIVES the plan from the snapshot frozen at creation, so the
 *     verdict matches the plan the QA Manager configured and saw — a plan that
 *     FAILs a lot the defaults would have PASSed.
 *
 * The inspection LEVEL stays locked to II on purpose; only LEVEL_II_LOT_RANGES
 * is verified (see src/aql/aql-tables.ts).
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
  WorkspaceFixture,
} from './support';

jest.setTimeout(180_000);

/** Nest renders `BadRequestException(msg)` as `{ statusCode, error, message }`. */
const message = (body: any): string =>
  Array.isArray(body?.message)
    ? body.message.join(', ')
    : String(body?.message ?? '');

describe('AQL configurability end-to-end (INS-063)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let prisma: PrismaService;
  let adminToken: string;
  let org: OrgFixture;
  let ws: WorkspaceFixture;
  const tag = runTag('aqlcfg');

  /** The inspection created with the CONFIGURED plan; submitted in the last test. */
  let configuredId: string;
  let configuredLoopId: string;

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    prisma = app.get(PrismaService);
    adminToken = await loginAdmin(client);
    org = await createOrgWithOwner(client, adminToken, tag);
    ws = await createWorkspace(client, org.ownerToken, tag);
  });

  afterAll(async () => {
    await app.close();
  });

  it('stores and computes a configured per-class plan (major 1.5 @ lot 1000 -> letter J, Ac 3 / Re 4)', async () => {
    const created = expect2xx(
      await client.post('/inspections', {
        token: org.ownerToken,
        body: {
          poId: ws.poId,
          loopPresetId: ws.presetId,
          lotSize: 1000,
          aqlPlan: { major: 1.5 },
        },
      }),
      'POST /inspections (major 1.5)',
    );
    configuredId = created.id;
    configuredLoopId = created.items?.[0]?.id;
    expect(configuredId).toBeTruthy();
    expect(configuredLoopId).toBeTruthy();

    // The plan is frozen EXPLICITLY (omitted classes resolved to the defaults),
    // so re-deriving later cannot drift if a code-level default ever changes.
    expect(created.aqlPlan).toEqual({ critical: 0, major: 1.5, minor: 4 });
    expect(created.aqlLevel).toBe('II');
    expect(created.computedSampling?.sampleSizeCodeLetter).toBe('J');
    expect(created.computedSampling?.sampleSize).toBe(80);
    // The whole point: 1.5 is NOT the default 2.5 (which is Ac 5 / Re 6 at J).
    expect(created.computedSampling?.perClass?.major).toEqual({
      aql: 1.5,
      ac: 3,
      re: 4,
    });
    expect(created.computedSampling?.perClass?.critical).toEqual({
      aql: 0,
      ac: 0,
      re: 1,
    });
    expect(created.computedSampling?.perClass?.minor).toEqual({
      aql: 4,
      ac: 7,
      re: 8,
    });

    // It really landed in the database, not just in the response.
    const row = await prisma.inspection.findUnique({
      where: { id: configuredId },
    });
    expect(row?.aqlPlan).toEqual({ critical: 0, major: 1.5, minor: 4 });

    // The create screen's preview agrees with what create actually stored.
    const preview = expect2xx(
      await client.get(
        '/inspections/aql-preview?lotSize=1000&critical=0&major=1.5&minor=4',
        {
          token: org.ownerToken,
        },
      ),
      'GET /inspections/aql-preview (major 1.5)',
    );
    expect(preview.sampleSizeCodeLetter).toBe('J');
    expect(preview.perClass.major).toEqual({ aql: 1.5, ac: 3, re: 4 });
  });

  it('rejects an AQL outside the verified band with a 400 naming the allowed values (never a 500)', async () => {
    const before = await prisma.inspection.count({
      where: { orgId: org.orgId },
    });

    const res = await client.post('/inspections', {
      token: org.ownerToken,
      body: {
        poId: ws.poId,
        loopPresetId: ws.presetId,
        lotSize: 1000,
        aqlPlan: { major: 3.0 },
      },
    });
    expect(res.status).toBe(400);
    expect(message(res.body)).toMatch(/aqlPlan\.major must be one of/i);
    // The message has to be actionable: it lists the values the API accepts.
    for (const allowed of ['0', '1.0', '1.5', '2.5', '4.0', '6.5']) {
      expect(message(res.body)).toContain(allowed);
    }
    expect(res.body.id).toBeUndefined();
    // A rejected plan must not leave a half-built inspection behind.
    expect(await prisma.inspection.count({ where: { orgId: org.orgId } })).toBe(
      before,
    );

    // Same rule on the preview, so the screen and the create path agree.
    const previewRes = await client.get(
      '/inspections/aql-preview?lotSize=1000&major=3',
      {
        token: org.ownerToken,
      },
    );
    expect(previewRes.status).toBe(400);
    expect(message(previewRes.body)).toMatch(/aqlPlan\.major must be one of/i);

    // Junk that Number() would fold to 0 ("any defect rejects") is rejected too —
    // silently tightening a buyer's plan is as wrong as silently loosening it.
    const junk = await client.post('/inspections', {
      token: org.ownerToken,
      body: {
        poId: ws.poId,
        loopPresetId: ws.presetId,
        lotSize: 1000,
        aqlPlan: { minor: '' },
      },
    });
    expect(junk.status).toBe(400);
    expect(message(junk.body)).toMatch(/aqlPlan\.minor must be one of/i);
  });

  it('turns a hole in the verified grid into a clean 400 from BOTH preview and create (lot 100 -> letter F)', async () => {
    // Lot 100 is code letter F, which the verified band has no Ac/Re column for:
    // the engine throws AqlPlanNotAvailableError. That is USER input, so it must
    // arrive as a 400 naming the letter — not as an unhandled 500.
    const previewRes = await client.get(
      '/inspections/aql-preview?lotSize=100&major=2.5',
      {
        token: org.ownerToken,
      },
    );
    expect(previewRes.status).toBe(400);
    expect(message(previewRes.body)).toMatch(/code letter F/i);

    // Create, with the SAME plan explicitly...
    const createRes = await client.post('/inspections', {
      token: org.ownerToken,
      body: {
        poId: ws.poId,
        loopPresetId: ws.presetId,
        lotSize: 100,
        aqlPlan: { major: 2.5 },
      },
    });
    expect(createRes.status).toBe(400);
    expect(message(createRes.body)).toMatch(/code letter F/i);

    // ...and with the plan omitted, since the defaults are non-zero too.
    const defaultsRes = await client.post('/inspections', {
      token: org.ownerToken,
      body: { poId: ws.poId, loopPresetId: ws.presetId, lotSize: 100 },
    });
    expect(defaultsRes.status).toBe(400);
    expect(message(defaultsRes.body)).toMatch(/code letter F/i);

    // The refusal is about the missing GRID COLUMN, not about small lots: an
    // all-zero plan ("any defect rejects") needs no column and still works at F.
    const zeroPlan = expect2xx(
      await client.get(
        '/inspections/aql-preview?lotSize=100&critical=0&major=0&minor=0',
        {
          token: org.ownerToken,
        },
      ),
      'GET /inspections/aql-preview (lot 100, all-zero plan)',
    );
    expect(zeroPlan.sampleSizeCodeLetter).toBe('F');
    expect(zeroPlan.sampleSize).toBe(20);
    expect(zeroPlan.perClass.major).toEqual({ aql: 0, ac: 0, re: 1 });
  });

  it('still applies the spec defaults when no aqlPlan is sent (critical 0 / major 2.5 / minor 4.0)', async () => {
    const created = expect2xx(
      await client.post('/inspections', {
        token: org.ownerToken,
        body: { poId: ws.poId, loopPresetId: ws.presetId, lotSize: 1000 },
      }),
      'POST /inspections (no aqlPlan)',
    );
    expect(created.aqlPlan).toEqual({ critical: 0, major: 2.5, minor: 4 });
    expect(created.computedSampling?.perClass).toEqual({
      critical: { aql: 0, ac: 0, re: 1 },
      major: { aql: 2.5, ac: 5, re: 6 },
      minor: { aql: 4, ac: 7, re: 8 },
    });
  });

  it('submit re-derives the frozen plan: 4 majors FAIL at AQL 1.5 where the defaults would PASS', async () => {
    // Evidence first — INS-056 refuses to submit a loop that is short of photos.
    expect2xx(
      await client.post(`/inspections/${configuredId}/populate/photos`, {
        token: adminToken,
        body: {
          storageKey: `e2e/${tag}/aqlcfg.jpg`,
          contentHash: createHash('sha256')
            .update(`${tag}-aqlcfg`)
            .digest('hex'),
          inspectionLoopItemId: configuredLoopId,
          cycleIndex: 0,
          clientRequestId: `photo-${tag}`,
        },
      }),
      'populate register photo',
    );

    // 4 MAJOR defects: at the CONFIGURED 1.5 plan (Ac 3 / Re 4) that is a FAIL;
    // at the default 2.5 plan (Ac 5 / Re 6) the very same lot would PASS. The
    // verdict below is therefore only reachable via the frozen plan.
    for (let i = 0; i < 4; i += 1) {
      expect2xx(
        await client.post(`/inspections/${configuredId}/populate/defects`, {
          token: adminToken,
          body: {
            customText: `Open seam #${i} (${tag})`,
            severity: 'MAJOR',
            inspectionLoopItemId: configuredLoopId,
            cycleIndex: 0,
            clientRequestId: `defect-${tag}-${i}`,
          },
        }),
        `populate tag MAJOR defect ${i}`,
      );
    }
    expect(
      await prisma.defectInstance.count({
        where: { inspectionId: configuredId },
      }),
    ).toBe(4);

    const submitted = expect2xx(
      await client.post(`/inspections/${configuredId}/submit`, {
        token: org.ownerToken,
        body: { deviceId: 'e2e-aqlcfg' },
      }),
      'POST /inspections/:id/submit',
    );
    expect(submitted.status).toBe('SUBMITTED');
    // Submit rewrites computedSampling from the frozen aqlPlan — still 1.5, not
    // the code-level default that a re-read of DEFAULT_AQL would have produced.
    expect(submitted.computedSampling?.perClass?.major).toEqual({
      aql: 1.5,
      ac: 3,
      re: 4,
    });
    expect(submitted.aqlResult?.perClass?.major).toEqual({
      found: 4,
      ac: 3,
      re: 4,
      outcome: 'FAIL',
    });
    expect(submitted.aqlResult?.systemRecommendation).toBe('FAIL');

    const row = await prisma.inspection.findUnique({
      where: { id: configuredId },
    });
    expect(row?.aqlPlan).toEqual({ critical: 0, major: 1.5, minor: 4 });
  });
});
