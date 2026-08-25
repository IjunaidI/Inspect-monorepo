import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ApiClient,
  OrgFixture,
  WorkspaceFixture,
  apiClient,
  bootApp,
  createOrgWithOwner,
  createWorkspace,
  expect2xx,
  inviteAndActivate,
  loginAdmin,
  runTag,
} from './support';

/**
 * INS-083 — populate is no longer Platform-Admin-only.
 *
 * The mobile app (INS-086) has no PLATFORM_ADMIN mode, so the role that
 * physically performs an inspection has to be able to capture evidence. The
 * risky half is not the widened role floor, it is that the inspection lookup
 * used to be a bare `findUnique(id)` with no tenant filter — safe only while the
 * one allowed caller was cross-tenant by design. These tests prove the
 * replacement scope holds against a real database:
 *
 *   - the ASSIGNED inspector can drive the whole capture path;
 *   - an inspector in the same org who is NOT assigned gets 404, never 403
 *     (a 403 would confirm the row exists — an existence oracle for other
 *     inspectors' work, the rule INS-057 established);
 *   - another org cannot reach it at all;
 *   - the Platform Admin stays cross-tenant, exactly as before.
 */
describe('Populate RBAC re-grade (INS-083)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let adminToken: string;
  let orgA: OrgFixture;
  let orgB: OrgFixture;
  let wsA: WorkspaceFixture;

  let assignedInspectorToken: string;
  let otherInspectorToken: string;
  let qaManagerToken: string;
  let inspectionId: string;
  let firstItemId: string;

  const tag = runTag('pop083');
  const pw = 'Inspector!2345';

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    adminToken = await loginAdmin(client);

    orgA = await createOrgWithOwner(client, adminToken, `${tag}-a`);
    orgB = await createOrgWithOwner(client, adminToken, `${tag}-b`);
    wsA = await createWorkspace(client, orgA.ownerToken, `${tag}-a`);

    const assigned = await inviteAndActivate(client, orgA.ownerToken, {
      email: `assigned+${tag}@e2e.local`,
      role: 'INSPECTOR',
      password: pw,
    });
    const other = await inviteAndActivate(client, orgA.ownerToken, {
      email: `other+${tag}@e2e.local`,
      role: 'INSPECTOR',
      password: pw,
    });
    const qa = await inviteAndActivate(client, orgA.ownerToken, {
      email: `qa+${tag}@e2e.local`,
      role: 'QA_MANAGER',
      password: pw,
    });
    assignedInspectorToken = assigned.token;
    otherInspectorToken = other.token;
    qaManagerToken = qa.token;

    const insp = expect2xx(
      await client.post('/inspections', {
        token: orgA.ownerToken,
        body: {
          poId: wsA.poId,
          loopPresetId: wsA.presetId,
          lotSize: 500,
          assignedInspectorId: assigned.userId,
        },
      }),
      'POST /inspections',
    );
    inspectionId = insp.id;
    firstItemId = insp.items[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('the assigned inspector', () => {
    it('loads the populate workspace', async () => {
      const res = await client.get(`/inspections/${inspectionId}/populate`, {
        token: assignedInspectorToken,
      });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(inspectionId);
    });

    it('drives the full capture path: presign then register a photo', async () => {
      const presigned = expect2xx(
        await client.post(
          `/inspections/${inspectionId}/populate/photos/presign`,
          {
            token: assignedInspectorToken,
            body: { ext: 'jpg' },
          },
        ),
        'POST populate/photos/presign (assigned inspector)',
      );
      expect(presigned.storageKey).toEqual(expect.any(String));

      const photo = expect2xx(
        await client.post(`/inspections/${inspectionId}/populate/photos`, {
          token: assignedInspectorToken,
          body: {
            storageKey: presigned.storageKey,
            contentHash: createHash('sha256')
              .update(`${tag}-assigned`)
              .digest('hex'),
            inspectionLoopItemId: firstItemId,
            cycleIndex: 0,
          },
        }),
        'POST populate/photos (assigned inspector)',
      );
      expect(photo.inspectionLoopItemId).toBe(firstItemId);
      expect(photo.cycleIndex).toBe(0);
    });

    it('reads the defect catalog it has to tag from', async () => {
      const res = await client.get('/defect-catalog', {
        token: assignedInspectorToken,
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('still cannot curate the catalog — writes stay a QA responsibility', async () => {
      const res = await client.post('/defect-catalog', {
        token: assignedInspectorToken,
        body: { name: `Nope ${tag}`, defaultSeverity: 'MINOR' },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('scoping', () => {
    it('hides the inspection from an inspector in the same org who is not assigned', async () => {
      const res = await client.get(`/inspections/${inspectionId}/populate`, {
        token: otherInspectorToken,
      });
      // 404, not 403 — a 403 would confirm the inspection exists.
      expect(res.status).toBe(404);
    });

    it('refuses that inspector the write path too, not just the read', async () => {
      const res = await client.post(
        `/inspections/${inspectionId}/populate/photos/presign`,
        {
          token: otherInspectorToken,
          body: { ext: 'jpg' },
        },
      );
      expect(res.status).toBe(404);
    });

    it('lets a QA_MANAGER in the owning org load it without being the assignee', async () => {
      const res = await client.get(`/inspections/${inspectionId}/populate`, {
        token: qaManagerToken,
      });
      expect(res.status).toBe(200);
    });

    it("refuses another org's owner outright", async () => {
      const res = await client.get(`/inspections/${inspectionId}/populate`, {
        token: orgB.ownerToken,
      });
      expect(res.status).toBe(404);
    });

    it("refuses another org's owner on the write path", async () => {
      const res = await client.post(
        `/inspections/${inspectionId}/populate/photos/presign`,
        {
          token: orgB.ownerToken,
          body: { ext: 'jpg' },
        },
      );
      expect(res.status).toBe(404);
    });

    it('keeps the Platform Admin cross-tenant, exactly as before', async () => {
      const res = await client.get(`/inspections/${inspectionId}/populate`, {
        token: adminToken,
      });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(inspectionId);
    });
  });
});
