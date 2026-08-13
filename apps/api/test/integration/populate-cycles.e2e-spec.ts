/**
 * INS-081 — the loop-cycle invariants, proven against the real DB.
 *
 * A loop is an ordered list of single-image items, walked repeatedly: one cycle
 * per inspected unit. The product rules under test here are the ones the UI
 * cannot be trusted to keep on its own:
 *
 *   - a loop may only be ENDED on a cycle boundary — submitting with a partial
 *     unit is a 400 that names the unit and its missing items;
 *   - discarding the partial unit unblocks the submit;
 *   - one image per (item, cycle) is a DATABASE constraint, surfaced as a 409
 *     pointing at retake — distinct from the clientRequestId replay contract;
 *   - retake replaces the bytes in place, keeping the slot;
 *   - retake and discard are populate writes, so the LOCKED guard covers them.
 *
 * Uses its own TWO-item preset: a one-item loop cannot express a partial cycle.
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
  loginAdmin,
  OrgFixture,
  runTag,
  WorkspaceFixture,
} from './support';

jest.setTimeout(180_000);

describe('populate cycles: the end-of-loop rule (INS-081)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let adminToken: string;
  let org: OrgFixture;
  let ws: WorkspaceFixture;
  let presetId: string;
  const tag = runTag('cycles');

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    adminToken = await loginAdmin(client);
    org = await createOrgWithOwner(client, adminToken, tag);
    ws = await createWorkspace(client, org.ownerToken, tag);

    // A two-item loop: "Front" then "Back". One item cannot be half-finished.
    const preset = expect2xx(
      await client.post('/loop-presets', {
        token: org.ownerToken,
        body: {
          name: `E2E Cycles ${tag}`,
          aqlLevel: 'II',
          items: [{ itemName: 'Front' }, { itemName: 'Back' }],
          measurementFields: [{ label: 'Chest', unit: 'cm' }],
          allowedDefectCatalogIds: ws.minorDefectId ? [ws.minorDefectId] : [],
        },
      }),
      'POST /loop-presets (two items)',
    );
    presetId = preset.id;
    expect(preset.items).toHaveLength(2);
  });

  afterAll(async () => {
    await app.close();
  });

  async function newInspection(): Promise<{ id: string; items: Array<{ id: string }> }> {
    const created = expect2xx(
      await client.post('/inspections', {
        token: org.ownerToken,
        body: { poId: ws.poId, loopPresetId: presetId, lotSize: 1000 },
      }),
      'POST /inspections',
    );
    expect(created.items).toHaveLength(2);
    return { id: created.id, items: created.items };
  }

  /** Register a photo into the (item, cycle) slot. Returns the raw response. */
  function upload(inspectionId: string, itemId: string, cycleIndex: number, seed: string) {
    return client.post(`/inspections/${inspectionId}/populate/photos`, {
      token: adminToken,
      body: {
        storageKey: `e2e/${tag}/${seed}.jpg`,
        contentHash: createHash('sha256').update(`${tag}-${seed}`).digest('hex'),
        inspectionLoopItemId: itemId,
        cycleIndex,
      },
    });
  }

  it('blocks submit mid-cycle, naming the unit and the missing item', async () => {
    const insp = await newInspection();
    // Unit 1: both items — a complete cycle.
    expect2xx(await upload(insp.id, insp.items[0].id, 0, 'u1-front'), 'unit 1 front');
    expect2xx(await upload(insp.id, insp.items[1].id, 0, 'u1-back'), 'unit 1 back');
    // Unit 2: only the first item — partial.
    expect2xx(await upload(insp.id, insp.items[0].id, 1, 'u2-front'), 'unit 2 front');

    const blocked = await client.post(`/inspections/${insp.id}/submit`, {
      token: org.ownerToken,
      body: {},
    });
    expect(blocked.status).toBe(400);
    expect(String(blocked.body.message)).toMatch(/unit 2 \(missing Back\)/);
  });

  it('accepts the submit once the partial unit is discarded', async () => {
    const insp = await newInspection();
    expect2xx(await upload(insp.id, insp.items[0].id, 0, 'd-u1-front'), 'unit 1 front');
    expect2xx(await upload(insp.id, insp.items[1].id, 0, 'd-u1-back'), 'unit 1 back');
    expect2xx(await upload(insp.id, insp.items[0].id, 1, 'd-u2-front'), 'unit 2 front');

    const discarded = expect2xx(
      await client.delete(`/inspections/${insp.id}/populate/cycles/1`, { token: adminToken }),
      'DELETE populate/cycles/1',
    );
    expect(discarded.deleted.photos).toBe(1);

    const submitted = expect2xx(
      await client.post(`/inspections/${insp.id}/submit`, { token: org.ownerToken, body: {} }),
      'POST /inspections/:id/submit',
    );
    expect(submitted.status).toBe('SUBMITTED');
  });

  it('accepts the submit once the partial unit is finished instead', async () => {
    const insp = await newInspection();
    expect2xx(await upload(insp.id, insp.items[0].id, 0, 'f-u1-front'), 'unit 1 front');
    expect2xx(await upload(insp.id, insp.items[1].id, 0, 'f-u1-back'), 'unit 1 back');
    expect2xx(await upload(insp.id, insp.items[0].id, 1, 'f-u2-front'), 'unit 2 front');
    // Finish the unit rather than discarding it — the other half of the rule.
    expect2xx(await upload(insp.id, insp.items[1].id, 1, 'f-u2-back'), 'unit 2 back');

    const submitted = expect2xx(
      await client.post(`/inspections/${insp.id}/submit`, { token: org.ownerToken, body: {} }),
      'POST /inspections/:id/submit',
    );
    expect(submitted.status).toBe('SUBMITTED');
  });

  it('refuses to submit an inspection with no complete unit at all', async () => {
    const insp = await newInspection();
    const res = await client.post(`/inspections/${insp.id}/submit`, {
      token: org.ownerToken,
      body: {},
    });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/no complete unit has been photographed/i);
  });

  it('409s a second photo aimed at a filled slot and points at retake', async () => {
    const insp = await newInspection();
    expect2xx(await upload(insp.id, insp.items[0].id, 0, 'dup-first'), 'first photo');
    const dup = await upload(insp.id, insp.items[0].id, 0, 'dup-second');
    expect(dup.status).toBe(409);
    expect(String(dup.body.message)).toMatch(/unit 1 already has a photo/i);
    expect(String(dup.body.message)).toMatch(/retake/i);
  });

  it('retake replaces the bytes in place, keeping the photo id and its slot', async () => {
    const insp = await newInspection();
    const photo = expect2xx(await upload(insp.id, insp.items[0].id, 0, 'rt-orig'), 'original');
    const newHash = 'b'.repeat(64);

    const retaken = expect2xx(
      await client.post(`/inspections/${insp.id}/populate/photos/${photo.id}/retake`, {
        token: adminToken,
        body: { storageKey: `e2e/${tag}/rt-replacement.jpg`, contentHash: newHash },
      }),
      'POST populate/photos/:id/retake',
    );
    expect(retaken.id).toBe(photo.id);
    expect(retaken.cycleIndex).toBe(0);
    expect(retaken.inspectionLoopItemId).toBe(insp.items[0].id);
    expect(retaken.contentHash).toBe(newHash);
  });

  it('records the per-unit measurement sheet and is idempotent on (unit, label)', async () => {
    const insp = await newInspection();
    expect2xx(await upload(insp.id, insp.items[0].id, 0, 'm-front'), 'front');

    const first = expect2xx(
      await client.post(`/inspections/${insp.id}/populate/measurements`, {
        token: adminToken,
        body: { cycleIndex: 0, label: 'Chest', recordedValue: '52.0', unit: 'cm' },
      }),
      'measurement unit 1',
    );
    const corrected = expect2xx(
      await client.post(`/inspections/${insp.id}/populate/measurements`, {
        token: adminToken,
        body: { cycleIndex: 0, label: 'Chest', recordedValue: '52.4', unit: 'cm' },
      }),
      'measurement unit 1 (corrected)',
    );
    // Same row, updated value — not a second point on the sheet.
    expect(corrected.id).toBe(first.id);
    expect(corrected.recordedValue).toBe('52.4');
  });

  it('refuses a defect on a slot that holds no photo yet', async () => {
    const insp = await newInspection();
    const res = await client.post(`/inspections/${insp.id}/populate/defects`, {
      token: adminToken,
      body: {
        inspectionLoopItemId: insp.items[0].id,
        cycleIndex: 3,
        customText: `Phantom (${tag})`,
        severity: 'MINOR',
      },
    });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/no photo has been uploaded for unit 4/i);
  });

  it('refuses retake and cycle-discard once the inspection is submitted', async () => {
    const insp = await newInspection();
    const photo = expect2xx(await upload(insp.id, insp.items[0].id, 0, 'lock-front'), 'front');
    expect2xx(await upload(insp.id, insp.items[1].id, 0, 'lock-back'), 'back');
    expect2xx(
      await client.post(`/inspections/${insp.id}/submit`, { token: org.ownerToken, body: {} }),
      'submit',
    );

    const retake = await client.post(
      `/inspections/${insp.id}/populate/photos/${photo.id}/retake`,
      {
        token: adminToken,
        body: { storageKey: `e2e/${tag}/nope.jpg`, contentHash: 'c'.repeat(64) },
      },
    );
    expect(retake.status).toBe(400);
    expect(String(retake.body.message)).toMatch(/locked/i);

    const discard = await client.delete(`/inspections/${insp.id}/populate/cycles/0`, {
      token: adminToken,
    });
    expect(discard.status).toBe(400);
    expect(String(discard.body.message)).toMatch(/locked/i);
  });
});
