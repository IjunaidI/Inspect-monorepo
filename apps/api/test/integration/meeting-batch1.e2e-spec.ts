/**
 * Meeting-batch-1 (2026-07-18): INS-056/057/058/059/061/062/065/066 live coverage.
 * One shared fixture: org A (owner + inspector + workspace) and control org B.
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

jest.setTimeout(180_000);

describe('meeting batch 1 (product-feedback 2026-07-17)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let adminToken: string;
  let orgA: OrgFixture;
  let orgB: OrgFixture;
  let ws: WorkspaceFixture;
  let inspectorToken: string;
  let inspectorId: string;
  const tag = runTag('mb1');

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    adminToken = await loginAdmin(client);
    orgA = await createOrgWithOwner(client, adminToken, `${tag}-a`);
    orgB = await createOrgWithOwner(client, adminToken, `${tag}-b`);
    ws = await createWorkspace(client, orgA.ownerToken, tag);
    ({ token: inspectorToken, userId: inspectorId } = await inviteAndActivate(client, orgA.ownerToken, {
      email: `mb1-inspector+${tag}@e2e.local`,
      role: 'INSPECTOR',
      password: `E2eInspector!${tag}`,
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  /** Org-A inspection from the shared PO/preset; returns its id + first loop id. */
  async function createInspection(assign: boolean): Promise<{ id: string; loopId: string }> {
    const created = expect2xx(
      await client.post('/inspections', {
        token: orgA.ownerToken,
        body: {
          poId: ws.poId,
          loopPresetId: ws.presetId,
          lotSize: 500,
          ...(assign ? { assignedInspectorId: inspectorId } : {}),
        },
      }),
      'POST /inspections (fixture)',
    );
    return { id: created.id, loopId: created.loops[0].id };
  }

  /** Register a fabricated photo directly onto a loop (Platform-Admin populate route). */
  async function registerPhoto(inspectionId: string, loopId: string, seed: string): Promise<string> {
    const contentHash = createHash('sha256').update(seed).digest('hex');
    const photo = expect2xx(
      await client.post(`/inspections/${inspectionId}/populate/photos`, {
        token: adminToken,
        body: {
          storageKey: `e2e/${seed}.jpg`,
          contentHash,
          inspectionLoopId: loopId,
          clientRequestId: seed,
        },
      }),
      'populate register photo (mb1)',
    );
    return photo.id as string;
  }

  describe('INS-057 — inspector scope + start/reset', () => {
    it('INSPECTOR lists only own-assigned inspections; QA_MANAGER+ stays org-wide', async () => {
      const other = await createInspection(false);
      const mine = await createInspection(true);

      const res = await client.get('/inspections', { token: inspectorToken });
      expect(res.status).toBe(200);
      const ids = res.body.map((i: { id: string }) => i.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(other.id);
      for (const row of res.body) expect(row.assignedInspectorId).toBe(inspectorId);

      const ownerList = expect2xx(
        await client.get('/inspections', { token: orgA.ownerToken }),
        'owner GET /inspections',
      );
      expect(ownerList.map((i: { id: string }) => i.id)).toContain(other.id);
    });

    it('INSPECTOR opens an assigned inspection; an unassigned one 404s; create stays 403', async () => {
      const other = await createInspection(false);
      const mine = await createInspection(true);

      const ok = await client.get(`/inspections/${mine.id}`, { token: inspectorToken });
      expect(ok.status).toBe(200);

      const foreign = await client.get(`/inspections/${other.id}`, { token: inspectorToken });
      expect(foreign.status).toBe(404);

      const create = await client.post('/inspections', {
        token: inspectorToken,
        body: { poId: ws.poId, loopPresetId: ws.presetId, lotSize: 500 },
      });
      expect(create.status).toBe(403);
    });

    it('start: ASSIGNED -> IN_PROGRESS; reset returns to ASSIGNED; start on SUBMITTED 400', async () => {
      const mine = await createInspection(true);

      const started = expect2xx(
        await client.post(`/inspections/${mine.id}/start`, { token: inspectorToken }),
        'inspector POST /:id/start',
      );
      expect(started.status).toBe('IN_PROGRESS');

      const again = await client.post(`/inspections/${mine.id}/start`, { token: inspectorToken });
      expect(again.status).toBe(400);

      const reset = expect2xx(
        await client.post(`/inspections/${mine.id}/reset`, { token: inspectorToken }),
        'inspector POST /:id/reset',
      );
      expect(reset.status).toBe('ASSIGNED');

      await registerPhoto(mine.id, mine.loopId, `start-${tag}`);
      expect2xx(
        await client.post(`/inspections/${mine.id}/submit`, { token: inspectorToken, body: {} }),
        'inspector submit own inspection',
      );
      const afterSubmit = await client.post(`/inspections/${mine.id}/start`, { token: inspectorToken });
      expect(afterSubmit.status).toBe(400);
    });
  });

  describe('INS-056 — submit completeness gate', () => {
    it('refuses submit while a loop lacks photos, then accepts once uploaded', async () => {
      const insp = await createInspection(false);

      const refused = await client.post(`/inspections/${insp.id}/submit`, {
        token: orgA.ownerToken,
        body: {},
      });
      expect(refused.status).toBe(400);
      expect(String(refused.body.message)).toContain('photo evidence incomplete');

      await registerPhoto(insp.id, insp.loopId, `gate-${tag}`);
      const ok = expect2xx(
        await client.post(`/inspections/${insp.id}/submit`, { token: orgA.ownerToken, body: {} }),
        'submit after required photo',
      );
      expect(ok.aqlResult.systemRecommendation).toBe('PASS');
    });
  });

  describe('INS-061 — archive -> restore round-trip', () => {
    it('restores an archived buyer; cross-org restore 404s', async () => {
      const buyer = expect2xx(
        await client.post('/buyers', { token: orgA.ownerToken, body: { name: `Restore Buyer ${tag}` } }),
        'POST /buyers (restore fixture)',
      );
      expect2xx(await client.delete(`/buyers/${buyer.id}`, { token: orgA.ownerToken }), 'archive buyer');

      const active = expect2xx(await client.get('/buyers', { token: orgA.ownerToken }), 'GET /buyers');
      expect(active.some((b: { id: string }) => b.id === buyer.id)).toBe(false);
      const all = expect2xx(
        await client.get('/buyers?includeArchived=1', { token: orgA.ownerToken }),
        'GET /buyers?includeArchived=1',
      );
      expect(all.some((b: { id: string }) => b.id === buyer.id)).toBe(true);

      const foreign = await client.post(`/buyers/${buyer.id}/restore`, { token: orgB.ownerToken });
      expect(foreign.status).toBe(404);

      const restored = expect2xx(
        await client.post(`/buyers/${buyer.id}/restore`, { token: orgA.ownerToken }),
        'restore buyer',
      );
      expect(restored.archivedAt).toBeNull();
      const back = expect2xx(await client.get('/buyers', { token: orgA.ownerToken }), 'GET /buyers after restore');
      expect(back.some((b: { id: string }) => b.id === buyer.id)).toBe(true);
    });
  });
});
