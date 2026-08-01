/**
 * INS-007 / INS-016 — the populate invariants, proven against the real DB.
 *
 * PopulateService is the only enforcement point for immutability (no writes
 * once the inspection is LOCKED) and for clientRequestId idempotency, and the
 * dedupe key is org-scoped in the schema (`@@unique([orgId, clientRequestId])`)
 * while the meaningful unit of retry is a single inspection. This suite pins
 * the decided contract at the HTTP boundary:
 *
 *   - replay (same token, same inspection)     -> 2xx, the ORIGINAL row, no duplicate
 *   - collision (same token, other inspection) -> 409, and nothing attached anywhere
 *   - a fresh token on the other inspection    -> still works
 *   - any populate write after submit          -> 4xx, nothing written
 *
 * Two inspections in ONE org are required — that is exactly the shape the
 * org-scoped unique constraint used to swallow.
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

describe('populate invariants: immutability + clientRequestId idempotency (INS-007/INS-016)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let prisma: PrismaService;
  let adminToken: string;
  let org: OrgFixture;
  let ws: WorkspaceFixture;
  const tag = runTag('popinv');

  // Two inspections in the SAME org — the collision case the org-scoped
  // unique constraint used to hide.
  let inspA: string;
  let loopA: string;
  let inspB: string;
  let loopB: string;

  const PHOTO_CRID = `crid-photo-${tag}`;
  const DEFECT_CRID = `crid-defect-${tag}`;
  let photoAId: string;
  let defectAId: string;

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    prisma = app.get(PrismaService);
    adminToken = await loginAdmin(client);
    org = await createOrgWithOwner(client, adminToken, tag);
    ws = await createWorkspace(client, org.ownerToken, tag);

    const a = await createInspection('a');
    inspA = a.id;
    loopA = a.loopId;
    const b = await createInspection('b');
    inspB = b.id;
    loopB = b.loopId;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createInspection(suffix: string): Promise<{ id: string; loopId: string }> {
    const created = expect2xx(
      await client.post('/inspections', {
        token: org.ownerToken,
        body: { poId: ws.poId, loopPresetId: ws.presetId, lotSize: 1000 },
      }),
      `POST /inspections (${suffix})`,
    );
    return { id: created.id, loopId: created.loops[0].id };
  }

  function photoBody(inspectionLoopId: string, clientRequestId: string, seed: string) {
    return {
      storageKey: `e2e/${tag}/${seed}.jpg`,
      contentHash: createHash('sha256').update(`${tag}-${seed}`).digest('hex'),
      inspectionLoopId,
      clientRequestId,
    };
  }

  function defectBody(inspectionLoopId: string, clientRequestId: string) {
    return {
      ...(ws.minorDefectId
        ? { defectCatalogId: ws.minorDefectId }
        : { customText: `Loose thread (${tag})`, severity: 'MINOR' }),
      inspectionLoopId,
      clientRequestId,
      notes: 'populate-invariants',
    };
  }

  it('registers a photo on inspection A and replays it idempotently (same id, no duplicate row)', async () => {
    const body = photoBody(loopA, PHOTO_CRID, 'a1');
    const first = expect2xx(
      await client.post(`/inspections/${inspA}/populate/photos`, { token: adminToken, body }),
      'register photo A',
    );
    photoAId = first.id;
    expect(photoAId).toBeTruthy();
    expect(first.inspectionId).toBe(inspA);

    // Same token, same inspection -> 2xx with the ORIGINAL row, no unique-violation error.
    const replay = await client.post(`/inspections/${inspA}/populate/photos`, {
      token: adminToken,
      body,
    });
    expect(replay.status).toBeGreaterThanOrEqual(200);
    expect(replay.status).toBeLessThan(300);
    expect(replay.body.id).toBe(photoAId);

    const rows = await prisma.photo.count({
      where: { orgId: org.orgId, clientRequestId: PHOTO_CRID },
    });
    expect(rows).toBe(1);
  });

  it('409s when the SAME photo clientRequestId is reused on inspection B, and attaches nothing', async () => {
    const before = await prisma.photo.count({ where: { inspectionId: inspB } });

    const res = await client.post(`/inspections/${inspB}/populate/photos`, {
      token: adminToken,
      body: photoBody(loopB, PHOTO_CRID, 'b1'),
    });
    expect(res.status).toBe(409);
    // The old behaviour returned A's photo with a 2xx while writing nothing here.
    expect(res.body.id).not.toBe(photoAId);
    expect(String(res.body.message)).toMatch(/different inspection/i);

    expect(await prisma.photo.count({ where: { inspectionId: inspB } })).toBe(before);
    expect(
      await prisma.photo.count({ where: { orgId: org.orgId, clientRequestId: PHOTO_CRID } }),
    ).toBe(1);
  });

  it('accepts a FRESH clientRequestId on inspection B (the token, not the inspection, was the problem)', async () => {
    const fresh = `${PHOTO_CRID}-b`;
    const created = expect2xx(
      await client.post(`/inspections/${inspB}/populate/photos`, {
        token: adminToken,
        body: photoBody(loopB, fresh, 'b2'),
      }),
      'register photo B (fresh token)',
    );
    expect(created.inspectionId).toBe(inspB);
    expect(created.id).not.toBe(photoAId);
  });

  it('tags a defect on inspection A and replays it idempotently (same id, no duplicate row)', async () => {
    const body = defectBody(loopA, DEFECT_CRID);
    const first = expect2xx(
      await client.post(`/inspections/${inspA}/populate/defects`, { token: adminToken, body }),
      'tag defect A',
    );
    defectAId = first.id;
    expect(first.severity).toBe('MINOR');

    const replay = await client.post(`/inspections/${inspA}/populate/defects`, {
      token: adminToken,
      body,
    });
    expect(replay.status).toBeGreaterThanOrEqual(200);
    expect(replay.status).toBeLessThan(300);
    expect(replay.body.id).toBe(defectAId);

    // A phantom duplicate here would change the per-class AQL count on submit.
    expect(await prisma.defectInstance.count({ where: { inspectionId: inspA } })).toBe(1);
  });

  it('409s when the SAME defect clientRequestId is reused on inspection B', async () => {
    const res = await client.post(`/inspections/${inspB}/populate/defects`, {
      token: adminToken,
      body: defectBody(loopB, DEFECT_CRID),
    });
    expect(res.status).toBe(409);
    expect(res.body.id).not.toBe(defectAId);
    expect(await prisma.defectInstance.count({ where: { inspectionId: inspB } })).toBe(0);
  });

  it('refuses every populate write once inspection A is submitted (immutability)', async () => {
    const submitted = expect2xx(
      await client.post(`/inspections/${inspA}/submit`, {
        token: org.ownerToken,
        body: { deviceId: 'e2e-popinv', gps: { lat: 0, lng: 0 } },
      }),
      'POST /inspections/:id/submit',
    );
    expect(submitted.status).toBe('SUBMITTED');

    const photosBefore = await prisma.photo.count({ where: { inspectionId: inspA } });
    const defectsBefore = await prisma.defectInstance.count({ where: { inspectionId: inspA } });

    const attempts = await Promise.all([
      client.post(`/inspections/${inspA}/populate/photos/presign`, {
        token: adminToken,
        body: { ext: 'jpg' },
      }),
      client.post(`/inspections/${inspA}/populate/photos`, {
        token: adminToken,
        body: photoBody(loopA, `${PHOTO_CRID}-late`, 'late'),
      }),
      client.patch(`/inspections/${inspA}/populate/photos/${photoAId}/loop`, {
        token: adminToken,
        body: { inspectionLoopId: loopA },
      }),
      client.post(`/inspections/${inspA}/populate/defects`, {
        token: adminToken,
        body: defectBody(loopA, `${DEFECT_CRID}-late`),
      }),
      client.post(`/inspections/${inspA}/populate/measurements`, {
        token: adminToken,
        body: { inspectionLoopId: loopA, label: 'Late', recordedValue: '1', unit: 'cm' },
      }),
    ]);
    for (const res of attempts) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }

    expect(await prisma.photo.count({ where: { inspectionId: inspA } })).toBe(photosBefore);
    expect(await prisma.defectInstance.count({ where: { inspectionId: inspA } })).toBe(
      defectsBefore,
    );

    // An idempotent replay of an ALREADY-STORED write is refused too: the lock
    // is checked before the dedupe lookup, so a late retry cannot resurrect the
    // populate step on a frozen inspection.
    const lateReplay = await client.post(`/inspections/${inspA}/populate/defects`, {
      token: adminToken,
      body: defectBody(loopA, DEFECT_CRID),
    });
    expect(lateReplay.status).toBeGreaterThanOrEqual(400);
    expect(lateReplay.status).toBeLessThan(500);
  });
});
