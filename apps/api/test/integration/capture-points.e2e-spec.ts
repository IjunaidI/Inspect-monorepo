/**
 * INS-097 — the capture-point library, live against a real Postgres+Redis.
 *
 * Covers the tenant boundary and the two promises the loop builder relies on:
 *   - the GLOBAL seeded library is visible to every org; an ORG row is visible
 *     only to its org (list, and as a preset-item lineage);
 *   - POST is find-or-create by folded name (a duplicate returns the same row;
 *     a global name returns the global row) — what makes "custom becomes
 *     library" idempotent from the builder;
 *   - archive refuses global and foreign rows;
 *   - a preset item's `capturePointId` is persisted and joined back, but NEVER
 *     reaches the inspection's frozen snapshot or its materialised items.
 */
import { INestApplication } from '@nestjs/common';
import {
  ApiClient,
  apiClient,
  bootApp,
  createOrgWithOwner,
  expect2xx,
  inviteAndActivate,
  loginAdmin,
  OrgFixture,
  runTag,
} from './support';

describe('Capture-point library (integration)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let orgA: OrgFixture;
  let orgB: OrgFixture;
  let inspectorAToken: string;
  const tag = runTag('cp');

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    const adminToken = await loginAdmin(client);
    orgA = await createOrgWithOwner(client, adminToken, `${tag}-a`);
    orgB = await createOrgWithOwner(client, adminToken, `${tag}-b`);
    ({ token: inspectorAToken } = await inviteAndActivate(
      client,
      orgA.ownerToken,
      {
        email: `inspector+${tag}@e2e.local`,
        role: 'INSPECTOR',
        password: `E2eInspector!${tag}`,
      },
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the seeded GLOBAL library to any org, grouped by category', async () => {
    const rows = expect2xx(
      await client.get('/capture-points', { token: orgA.ownerToken }),
      'GET /capture-points (org A)',
    ) as Array<{
      name: string;
      scope: string;
      orgId: string | null;
      category: string;
    }>;
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Collar & neckline',
        'Fly / zipper top',
        'Polybag',
      ]),
    );
    expect(
      rows.every((r) => r.scope === 'GLOBAL' || r.orgId === orgA.orgId),
    ).toBe(true);

    const tops = expect2xx(
      await client.get('/capture-points?category=TOP', {
        token: orgB.ownerToken,
      }),
      'GET /capture-points?category=TOP (org B)',
    ) as Array<{ category: string }>;
    expect(tops.length).toBeGreaterThan(5);
    expect(tops.every((r) => r.category === 'TOP')).toBe(true);
  });

  it('rejects an unknown category and refuses an INSPECTOR', async () => {
    expect(
      (
        await client.get('/capture-points?category=SHOES', {
          token: orgA.ownerToken,
        })
      ).status,
    ).toBe(400);
    expect(
      (await client.get('/capture-points', { token: inspectorAToken })).status,
    ).toBe(403);
  });

  it('find-or-create: a custom point becomes an ORG row, a folded duplicate returns the same row, a global name returns the global row', async () => {
    const created = expect2xx(
      await client.post('/capture-points', {
        token: orgA.ownerToken,
        body: {
          name: `Hem tape close-up ${tag}`,
          category: 'TOP',
          description: 'Close-up of the hem tape stitching',
        },
      }),
      'POST /capture-points (custom)',
    );
    expect(created).toMatchObject({
      scope: 'ORG',
      orgId: orgA.orgId,
      category: 'TOP',
      isArchived: false,
    });

    const dup = expect2xx(
      await client.post('/capture-points', {
        token: orgA.ownerToken,
        body: { name: `  hem tape   CLOSE-UP ${tag} `, category: 'OTHER' },
      }),
      'POST /capture-points (folded duplicate)',
    );
    expect(dup.id).toBe(created.id);

    const global = expect2xx(
      await client.post('/capture-points', {
        token: orgA.ownerToken,
        body: { name: 'Hem', category: 'TOP' },
      }),
      'POST /capture-points (global name)',
    );
    expect(global.scope).toBe('GLOBAL');
    expect(global.orgId).toBeNull();

    // Blank name is a 400, not a row.
    expect(
      (
        await client.post('/capture-points', {
          token: orgA.ownerToken,
          body: { name: '   ', category: 'TOP' },
        })
      ).status,
    ).toBe(400);
  });

  it('keeps an ORG row inside its org: invisible to org B, unarchivable by org B, and never a lineage for org B', async () => {
    const mine = expect2xx(
      await client.post('/capture-points', {
        token: orgA.ownerToken,
        body: { name: `Private point ${tag}`, category: 'OTHER' },
      }),
      'POST /capture-points (org A private)',
    );

    const seenByB = expect2xx(
      await client.get('/capture-points', { token: orgB.ownerToken }),
      'GET /capture-points (org B)',
    ) as Array<{ id: string }>;
    expect(seenByB.some((r) => r.id === mine.id)).toBe(false);

    expect(
      (
        await client.delete(`/capture-points/${mine.id}`, {
          token: orgB.ownerToken,
        })
      ).status,
    ).toBe(403);

    const bPreset = await client.post('/loop-presets', {
      token: orgB.ownerToken,
      body: {
        name: `Leak ${tag}`,
        items: [{ itemName: 'Private point', capturePointId: mine.id }],
      },
    });
    expect(bPreset.status).toBe(400);
  });

  it('refuses to archive a GLOBAL row, archives an own row, and hides it from the default list', async () => {
    const all = expect2xx(
      await client.get('/capture-points', { token: orgA.ownerToken }),
      'GET /capture-points',
    ) as Array<{ id: string; scope: string; name: string }>;
    const global = all.find((r) => r.scope === 'GLOBAL')!;
    expect(
      (
        await client.delete(`/capture-points/${global.id}`, {
          token: orgA.ownerToken,
        })
      ).status,
    ).toBe(403);

    const own = expect2xx(
      await client.post('/capture-points', {
        token: orgA.ownerToken,
        body: { name: `Archive me ${tag}`, category: 'OTHER' },
      }),
      'POST /capture-points (archive me)',
    );
    expect2xx(
      await client.delete(`/capture-points/${own.id}`, {
        token: orgA.ownerToken,
      }),
      'DELETE /capture-points/:id',
    );
    const after = expect2xx(
      await client.get('/capture-points', { token: orgA.ownerToken }),
      'GET /capture-points (after archive)',
    ) as Array<{ id: string }>;
    expect(after.some((r) => r.id === own.id)).toBe(false);
    const withArchived = expect2xx(
      await client.get('/capture-points?includeArchived=1', {
        token: orgA.ownerToken,
      }),
      'GET /capture-points?includeArchived=1',
    ) as Array<{ id: string; isArchived: boolean }>;
    expect(withArchived.find((r) => r.id === own.id)?.isArchived).toBe(true);
  });

  it('persists a preset item lineage, joins it back on GET, and keeps it OUT of the inspection snapshot', async () => {
    const lib = expect2xx(
      await client.get('/capture-points?category=TOP', {
        token: orgA.ownerToken,
      }),
      'GET /capture-points?category=TOP',
    ) as Array<{
      id: string;
      name: string;
      description: string;
      category: string;
      iconKey: string | null;
    }>;
    const sleeve = lib.find((r) => r.name === 'Right sleeve')!;
    expect(sleeve).toBeDefined();

    const preset = expect2xx(
      await client.post('/loop-presets', {
        token: orgA.ownerToken,
        body: {
          name: `Lineage ${tag}`,
          aqlLevel: 'II',
          items: [
            {
              itemName: sleeve.name,
              description: sleeve.description,
              capturePointId: sleeve.id,
            },
            { itemName: 'Free-text extra' },
          ],
        },
      }),
      'POST /loop-presets',
    );

    const detail = expect2xx(
      await client.get(`/loop-presets/${preset.id}`, {
        token: orgA.ownerToken,
      }),
      'GET /loop-presets/:id',
    );
    expect(detail.items[0]).toMatchObject({
      itemName: 'Right sleeve',
      capturePointId: sleeve.id,
      capturePoint: { id: sleeve.id, category: 'TOP' },
    });
    expect(detail.items[1].capturePointId).toBeNull();
    expect(detail.items[1].capturePoint).toBeNull();

    // An inspection built from it freezes names, never the lineage.
    const client1 = expect2xx(
      await client.post('/companies', {
        token: orgA.ownerToken,
        body: { name: `Client ${tag}` },
      }),
      'POST /companies (client)',
    );
    const factory = expect2xx(
      await client.post('/companies', {
        token: orgA.ownerToken,
        body: { name: `Factory ${tag}` },
      }),
      'POST /companies (factory)',
    );
    const product = expect2xx(
      await client.post('/products', {
        token: orgA.ownerToken,
        body: { styleNumber: `STY-${tag}` },
      }),
      'POST /products',
    );
    const po = expect2xx(
      await client.post('/purchase-orders', {
        token: orgA.ownerToken,
        body: {
          poNumber: `PO-${tag}`,
          clientCompanyId: client1.id,
          factoryCompanyId: factory.id,
          productId: product.id,
          quantity: 1200,
        },
      }),
      'POST /purchase-orders',
    );
    const inspection = expect2xx(
      await client.post('/inspections', {
        token: orgA.ownerToken,
        body: {
          poId: po.id,
          loopPresetId: preset.id,
          lotSize: 1200,
        },
      }),
      'POST /inspections',
    );
    const got = expect2xx(
      await client.get(`/inspections/${inspection.id}`, {
        token: orgA.ownerToken,
      }),
      'GET /inspections/:id',
    );
    const snapshotItems = (got.loopPresetSnapshot?.items ?? []) as Array<
      Record<string, unknown>
    >;
    expect(snapshotItems.length).toBe(2);
    for (const it of snapshotItems) {
      expect(it).not.toHaveProperty('capturePointId');
      expect(it).not.toHaveProperty('capturePoint');
    }
    expect(JSON.stringify(got)).not.toContain(sleeve.id);
  });
});
