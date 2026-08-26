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
    ({ token: inspectorToken, userId: inspectorId } = await inviteAndActivate(
      client,
      orgA.ownerToken,
      {
        email: `mb1-inspector+${tag}@e2e.local`,
        role: 'INSPECTOR',
        password: `E2eInspector!${tag}`,
      },
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  /** Org-A inspection from the shared PO/preset; returns its id + first loop id. */
  async function createInspection(
    assign: boolean,
  ): Promise<{ id: string; loopId: string }> {
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
    return { id: created.id, loopId: created.items[0].id };
  }

  /** Register a fabricated photo directly onto a loop (Platform-Admin populate route). */
  async function registerPhoto(
    inspectionId: string,
    loopId: string,
    seed: string,
  ): Promise<string> {
    const contentHash = createHash('sha256').update(seed).digest('hex');
    const photo = expect2xx(
      await client.post(`/inspections/${inspectionId}/populate/photos`, {
        token: adminToken,
        body: {
          storageKey: `e2e/${seed}.jpg`,
          contentHash,
          inspectionLoopItemId: loopId,
          cycleIndex: 0,
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
      for (const row of res.body)
        expect(row.assignedInspectorId).toBe(inspectorId);

      const ownerList = expect2xx(
        await client.get('/inspections', { token: orgA.ownerToken }),
        'owner GET /inspections',
      );
      expect(ownerList.map((i: { id: string }) => i.id)).toContain(other.id);
    });

    it('INSPECTOR opens an assigned inspection; an unassigned one 404s; create stays 403', async () => {
      const other = await createInspection(false);
      const mine = await createInspection(true);

      const ok = await client.get(`/inspections/${mine.id}`, {
        token: inspectorToken,
      });
      expect(ok.status).toBe(200);

      const foreign = await client.get(`/inspections/${other.id}`, {
        token: inspectorToken,
      });
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
        await client.post(`/inspections/${mine.id}/start`, {
          token: inspectorToken,
        }),
        'inspector POST /:id/start',
      );
      expect(started.status).toBe('IN_PROGRESS');

      const again = await client.post(`/inspections/${mine.id}/start`, {
        token: inspectorToken,
      });
      expect(again.status).toBe(400);

      const reset = expect2xx(
        await client.post(`/inspections/${mine.id}/reset`, {
          token: inspectorToken,
        }),
        'inspector POST /:id/reset',
      );
      expect(reset.status).toBe('ASSIGNED');

      await registerPhoto(mine.id, mine.loopId, `start-${tag}`);
      expect2xx(
        await client.post(`/inspections/${mine.id}/submit`, {
          token: inspectorToken,
          body: {},
        }),
        'inspector submit own inspection',
      );
      const afterSubmit = await client.post(`/inspections/${mine.id}/start`, {
        token: inspectorToken,
      });
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
      // INS-081 reshaped the gate: it is cycle-complete, not shot-count-based.
      expect(String(refused.body.message)).toContain(
        'no complete unit has been photographed',
      );

      await registerPhoto(insp.id, insp.loopId, `gate-${tag}`);
      const ok = expect2xx(
        await client.post(`/inspections/${insp.id}/submit`, {
          token: orgA.ownerToken,
          body: {},
        }),
        'submit after required photo',
      );
      expect(ok.aqlResult.systemRecommendation).toBe('PASS');
    });
  });

  describe('INS-061 — archive -> restore round-trip', () => {
    it('restores an archived buyer; cross-org restore 404s', async () => {
      const buyer = expect2xx(
        await client.post('/companies', {
          token: orgA.ownerToken,
          body: { name: `Restore Buyer ${tag}` },
        }),
        'POST /buyers (restore fixture)',
      );
      expect2xx(
        await client.delete(`/companies/${buyer.id}`, {
          token: orgA.ownerToken,
        }),
        'archive buyer',
      );

      const active = expect2xx(
        await client.get('/companies', { token: orgA.ownerToken }),
        'GET /companies',
      );
      expect(active.some((b: { id: string }) => b.id === buyer.id)).toBe(false);
      const all = expect2xx(
        await client.get('/companies?includeArchived=1', {
          token: orgA.ownerToken,
        }),
        'GET /companies?includeArchived=1',
      );
      expect(all.some((b: { id: string }) => b.id === buyer.id)).toBe(true);

      const foreign = await client.post(`/companies/${buyer.id}/restore`, {
        token: orgB.ownerToken,
      });
      expect(foreign.status).toBe(404);

      const restored = expect2xx(
        await client.post(`/companies/${buyer.id}/restore`, {
          token: orgA.ownerToken,
        }),
        'restore buyer',
      );
      expect(restored.archivedAt).toBeNull();
      const back = expect2xx(
        await client.get('/companies', { token: orgA.ownerToken }),
        'GET /companies after restore',
      );
      expect(back.some((b: { id: string }) => b.id === buyer.id)).toBe(true);
    });
  });

  describe('INS-066 — PATCH /inspections/:id', () => {
    it('reassigns pre-submission; SUBMITTED is frozen; foreign inspector 400', async () => {
      const insp = await createInspection(false);

      const bogus = await client.patch(`/inspections/${insp.id}`, {
        token: orgA.ownerToken,
        body: { assignedInspectorId: 'not-a-real-user' },
      });
      expect(bogus.status).toBe(400);

      const updated = expect2xx(
        await client.patch(`/inspections/${insp.id}`, {
          token: orgA.ownerToken,
          body: { assignedInspectorId: inspectorId },
        }),
        'PATCH reassign',
      );
      expect(updated.assignedInspectorId).toBe(inspectorId);
      expect(updated.status).toBe('ASSIGNED');

      // Verified band boundary (aql.engine.spec.ts): 1200 -> J, 1201 -> K.
      const resized = expect2xx(
        await client.patch(`/inspections/${insp.id}`, {
          token: orgA.ownerToken,
          body: { lotSize: 1201 },
        }),
        'PATCH lotSize',
      );
      expect(resized.lotSize).toBe(1201);
      expect(resized.computedSampling.sampleSizeCodeLetter).toBe('K');

      await registerPhoto(insp.id, insp.loopId, `patch-${tag}`);
      expect2xx(
        await client.post(`/inspections/${insp.id}/submit`, {
          token: orgA.ownerToken,
          body: {},
        }),
        'submit',
      );
      const frozen = await client.patch(`/inspections/${insp.id}`, {
        token: orgA.ownerToken,
        body: { lotSize: 800 },
      });
      expect(frozen.status).toBe(400);
    });

    it('INSPECTOR is refused PATCH even on their own assigned inspection (class QA floor)', async () => {
      const mine = await createInspection(true);
      const res = await client.patch(`/inspections/${mine.id}`, {
        token: inspectorToken,
        body: { lotSize: 800 },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('INS-062 — org-scoped reports list', () => {
    it('lists org A reports (no snapshot); org B sees none; INSPECTOR 403', async () => {
      const insp = await createInspection(false);
      await registerPhoto(insp.id, insp.loopId, `report-${tag}`);
      expect2xx(
        await client.post(`/inspections/${insp.id}/submit`, {
          token: orgA.ownerToken,
          body: {},
        }),
        'submit',
      );
      expect2xx(
        await client.post(`/inspections/${insp.id}/decision`, {
          token: orgA.ownerToken,
          body: { decision: 'PASS', remarks: 'mb1 report fixture' },
        }),
        'decision',
      );
      const report = expect2xx(
        await client.post(`/inspections/${insp.id}/report`, {
          token: orgA.ownerToken,
        }),
        'generate report',
      );

      const listA = expect2xx(
        await client.get('/reports', { token: orgA.ownerToken }),
        'GET /reports (A)',
      );
      const row = listA.find((r: { id: string }) => r.id === report.id);
      expect(row).toBeTruthy();
      expect(row.canonicalSnapshot).toBeUndefined();
      expect(row.inspection.purchaseOrder.poNumber).toBe(`PO-${tag}`);
      expect(row.buyer.name).toBe(`E2E Buyer ${tag}`);

      const listB = expect2xx(
        await client.get('/reports', { token: orgB.ownerToken }),
        'GET /reports (B)',
      );
      expect(listB.some((r: { id: string }) => r.id === report.id)).toBe(false);

      const inspRes = await client.get('/reports', { token: inspectorToken });
      expect(inspRes.status).toBe(403);
    });
  });

  describe('INS-058 — self-guards, last-owner, reactivate', () => {
    it('owner cannot change own role or deactivate self', async () => {
      const selfRole = await client.patch(`/users/${orgA.ownerId}/role`, {
        token: orgA.ownerToken,
        body: { role: 'QA_MANAGER' },
      });
      expect(selfRole.status).toBe(403);
      const selfOff = await client.delete(`/users/${orgA.ownerId}`, {
        token: orgA.ownerToken,
      });
      expect(selfOff.status).toBe(403);
    });

    it('last active owner is protected; reactivate restores login', async () => {
      const email = `second-owner+${tag}@e2e.local`;
      const password = `E2eOwner2!${tag}`;
      const { token: secondToken, userId: secondId } = await inviteAndActivate(
        client,
        orgA.ownerToken,
        {
          email,
          role: 'ORG_OWNER',
          password,
        },
      );

      const off = expect2xx(
        await client.delete(`/users/${secondId}`, { token: orgA.ownerToken }),
        'deactivate second owner',
      );
      expect(off.status).toBe('DEACTIVATED');

      // Stateless-guard caveat: the deactivated owner's access token stays valid
      // until expiry — the last-owner guard is what stops the org lockout here.
      const lockout = await client.delete(`/users/${orgA.ownerId}`, {
        token: secondToken,
      });
      expect(lockout.status).toBe(400);

      const back = expect2xx(
        await client.patch(`/users/${secondId}/reactivate`, {
          token: orgA.ownerToken,
        }),
        'reactivate',
      );
      expect(back.status).toBe('ACTIVE');
      expect2xx(
        await client.post('/auth/login', { body: { email, password } }),
        'second owner login after reactivate',
      );
    });
  });

  describe('INS-059 — direct add-member', () => {
    it('creates an ACTIVE member who logs in immediately; guards hold', async () => {
      const email = `direct+${tag}@e2e.local`;
      const password = `E2eDirect!${tag}`;
      const created = expect2xx(
        await client.post('/users', {
          token: orgA.ownerToken,
          body: { name: 'Direct Member', email, password, role: 'QA_MANAGER' },
        }),
        'POST /users (direct add)',
      );
      expect(created.status).toBe('ACTIVE');
      expect(created.passwordHash).toBeUndefined();
      expect2xx(
        await client.post('/auth/login', { body: { email, password } }),
        'direct member login',
      );

      const foreign = await client.post('/users', {
        token: orgB.ownerToken,
        body: { email, password: 'Whatever123!' },
      });
      expect(foreign.status).toBe(403);

      const admin = await client.post('/users', {
        token: orgA.ownerToken,
        body: {
          email: `x+${tag}@e2e.local`,
          password: 'Whatever123!',
          role: 'PLATFORM_ADMIN',
        },
      });
      expect(admin.status).toBe(403);
    });
  });

  describe('INS-065 — QA_MANAGER reads the users list', () => {
    it('QA lists users (inspector assignment needs it); INSPECTOR still 403', async () => {
      const { token: qaToken } = await inviteAndActivate(
        client,
        orgA.ownerToken,
        {
          email: `mb1-qa+${tag}@e2e.local`,
          role: 'QA_MANAGER',
          password: `E2eQa!${tag}`,
        },
      );
      const res = await client.get('/users', { token: qaToken });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const insp = await client.get('/users', { token: inspectorToken });
      expect(insp.status).toBe(403);
    });
  });

  describe('final-review fixes', () => {
    it('C1: Platform Admin loads the populate read for an org inspection; ORG_OWNER is refused', async () => {
      const insp = await createInspection(false);
      const photoId = await registerPhoto(
        insp.id,
        insp.loopId,
        `populate-read-${tag}`,
      );

      const admin = expect2xx(
        await client.get(`/inspections/${insp.id}/populate`, {
          token: adminToken,
        }),
        'admin GET /inspections/:id/populate',
      );
      expect(Array.isArray(admin.items)).toBe(true);
      expect(admin.items.length).toBeGreaterThan(0);
      const loop = admin.items.find(
        (l: { id: string }) => l.id === insp.loopId,
      );
      expect(loop.itemName).toBeTruthy();
      // The regression this guards: the loop's `include` dropping photos/defects/
      // measurements would still leave `loops` non-empty — assert the registered
      // photo actually rides along on its loop.
      expect(loop.photos.length).toBe(1);
      expect(loop.photos[0].id).toBe(photoId);

      // INS-083 deliberately supersedes the original assertion here (403). While
      // populate carried a PLATFORM_ADMIN floor, org A's own owner was refused
      // the read of org A's own inspection — a consequence of the floor, not a
      // boundary anyone wanted. The floor is now INSPECTOR with a row-level
      // scope, so the owner of the owning org gets 200 and the real boundary
      // (other orgs, unassigned inspectors) is asserted in populate-rbac.e2e-spec.ts.
      const owner = await client.get(`/inspections/${insp.id}/populate`, {
        token: orgA.ownerToken,
      });
      expect(owner.status).toBe(200);
    });

    it('I3: assigning a DEACTIVATED user via PATCH /inspections/:id is refused (400)', async () => {
      const insp = await createInspection(false);
      const { userId: throwawayId } = await inviteAndActivate(
        client,
        orgA.ownerToken,
        {
          email: `mb1-throwaway+${tag}@e2e.local`,
          role: 'INSPECTOR',
          password: `E2eThrowaway!${tag}`,
        },
      );
      expect2xx(
        await client.delete(`/users/${throwawayId}`, {
          token: orgA.ownerToken,
        }),
        'deactivate throwaway inspector',
      );

      const res = await client.patch(`/inspections/${insp.id}`, {
        token: orgA.ownerToken,
        body: { assignedInspectorId: throwawayId },
      });
      expect(res.status).toBe(400);
    });

    it('I5: unassigning an IN_PROGRESS inspection 400s; unassigning ASSIGNED succeeds -> DRAFT', async () => {
      const inProgress = await createInspection(true);
      expect2xx(
        await client.post(`/inspections/${inProgress.id}/start`, {
          token: inspectorToken,
        }),
        'start inspection',
      );
      const refused = await client.patch(`/inspections/${inProgress.id}`, {
        token: orgA.ownerToken,
        body: { assignedInspectorId: null },
      });
      expect(refused.status).toBe(400);

      const assigned = await createInspection(true);
      const unassigned = expect2xx(
        await client.patch(`/inspections/${assigned.id}`, {
          token: orgA.ownerToken,
          body: { assignedInspectorId: null },
        }),
        'unassign ASSIGNED inspection',
      );
      expect(unassigned.assignedInspectorId).toBeNull();
      expect(unassigned.status).toBe('DRAFT');
    });
  });
});
