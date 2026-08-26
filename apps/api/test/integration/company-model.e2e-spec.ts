/**
 * INS-055 — the unified Company model, proven against the real DB.
 *
 * Three things this file exists to guarantee, in ascending order of how badly a
 * regression would hurt:
 *
 *   1. A purchase order is a TWO-PARTY trade document. Both parties must belong
 *      to the caller's org, and a company cannot trade with itself.
 *   2. A report signed in the v1 shape (buyer/supplier keys, no version marker)
 *      still publicly verifies as valid:true, forever. The fixture is built HERE
 *      rather than relying on rows that survived a migration, so the guarantee
 *      is repeatable and survives `prisma migrate reset`.
 *   3. THE SECURITY BOUNDARY (spec §4.2): guest report visibility keys on
 *      clientCompanyId AND orgId. A guest of the FACTORY sees nothing. Now that
 *      one model plays both roles, the tempting "generalization" to
 *      OR:[{clientCompanyId},{factoryCompanyId}] would hand a factory's guest
 *      the client's signed report — a leak that does not exist today.
 */
import { INestApplication } from '@nestjs/common';
import {
  ApiClient,
  apiClient,
  bootApp,
  createOrgWithOwner,
  createWorkspace,
  expect2xx,
  insertLegacyV1Report,
  loginAdmin,
  OrgFixture,
  runTag,
} from './support';

describe('Company model (integration)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let org: OrgFixture;
  let adminToken: string;

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    adminToken = await loginAdmin(client);
    org = await createOrgWithOwner(client, adminToken, runTag('company'));
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  describe('purchase order parties (spec §2)', () => {
    it('rejects a PO whose client and factory are the same company (self-dealing)', async () => {
      const tag = runTag('self');
      const co = expect2xx(
        await client.post('/companies', {
          token: org.ownerToken,
          body: { name: `Self ${tag}` },
        }),
        'POST /companies',
      );
      const product = expect2xx(
        await client.post('/products', {
          token: org.ownerToken,
          body: { styleNumber: `STYLE-${tag}` },
        }),
        'POST /products',
      );

      const res = await client.post('/purchase-orders', {
        token: org.ownerToken,
        body: {
          poNumber: `PO-${tag}`,
          clientCompanyId: co.id,
          factoryCompanyId: co.id,
          productId: product.id,
        },
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(
        /client and factory must differ/i,
      );
    }, 120_000);

    it('rejects a factory company that belongs to another organization', async () => {
      const tag = runTag('xorg');
      const other = await createOrgWithOwner(
        client,
        adminToken,
        `${tag}-other`,
      );
      const foreign = expect2xx(
        await client.post('/companies', {
          token: other.ownerToken,
          body: { name: `Foreign ${tag}` },
        }),
        'POST /companies (other org)',
      );
      const mine = expect2xx(
        await client.post('/companies', {
          token: org.ownerToken,
          body: { name: `Mine ${tag}` },
        }),
        'POST /companies',
      );
      const product = expect2xx(
        await client.post('/products', {
          token: org.ownerToken,
          body: { styleNumber: `STYLE-${tag}` },
        }),
        'POST /products',
      );

      const res = await client.post('/purchase-orders', {
        token: org.ownerToken,
        body: {
          poNumber: `PO-${tag}`,
          clientCompanyId: mine.id,
          factoryCompanyId: foreign.id,
          productId: product.id,
        },
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(
        /factory company not found in organization/i,
      );
    }, 180_000);

    it('reads a PO back through both company relations', async () => {
      const tag = runTag('read');
      const ws = await createWorkspace(client, org.ownerToken, tag);
      const po = expect2xx(
        await client.get(`/purchase-orders/${ws.poId}`, {
          token: org.ownerToken,
        }),
        'GET /purchase-orders/:id',
      );
      expect(po.clientCompany?.id).toBe(ws.clientCompanyId);
      expect(po.factoryCompany?.id).toBe(ws.factoryCompanyId);
      // Role lives on the edge, so the two parties are distinguishable by which
      // FK they sit on — never by a flag on the row.
      expect(po.clientCompany?.id).not.toBe(po.factoryCompany?.id);
    }, 180_000);
  });

  describe('guest visibility boundary (spec §4.2)', () => {
    /**
     * Runs the full loop to a signed report so the guest queries have something
     * real to (not) see. Returns the report id and the workspace it came from.
     */
    async function reportFor(
      fixtureOrg: OrgFixture,
      tag: string,
    ): Promise<{
      reportId: string;
      ws: Awaited<ReturnType<typeof createWorkspace>>;
    }> {
      const ws = await createWorkspace(client, fixtureOrg.ownerToken, tag);
      const inspection = expect2xx(
        await client.post('/inspections', {
          token: fixtureOrg.ownerToken,
          body: { poId: ws.poId, loopPresetId: ws.presetId, lotSize: 1000 },
        }),
        'POST /inspections',
      );
      const itemId = inspection.items?.[0]?.id;
      const presign = expect2xx(
        await client.post(
          `/inspections/${inspection.id}/populate/photos/presign`,
          { token: adminToken, body: { ext: 'jpg' } },
        ),
        'populate presign',
      );
      expect2xx(
        await client.post(`/inspections/${inspection.id}/populate/photos`, {
          token: adminToken,
          body: {
            storageKey: presign.storageKey,
            contentHash: `hash-${tag}`,
            inspectionLoopItemId: itemId,
            cycleIndex: 0,
          },
        }),
        'populate register photo',
      );
      expect2xx(
        await client.post(`/inspections/${inspection.id}/submit`, {
          token: fixtureOrg.ownerToken,
          body: { deviceId: 'e2e' },
        }),
        'POST /inspections/:id/submit',
      );
      expect2xx(
        await client.post(`/inspections/${inspection.id}/decision`, {
          token: fixtureOrg.ownerToken,
          body: { decision: 'PASS' },
        }),
        'POST /inspections/:id/decision',
      );
      const report = expect2xx(
        await client.post(`/inspections/${inspection.id}/report`, {
          token: fixtureOrg.ownerToken,
        }),
        'POST /inspections/:id/report',
      );
      return { reportId: report.id, ws };
    }

    /**
     * THE test spec §9 names explicitly. Once one model plays both trade roles,
     * "the company appears on this report" becomes a tempting predicate — and it
     * is a cross-counterparty leak. A factory's guest must see NOTHING.
     */
    it('a factory-role guest sees no reports', async () => {
      const tag = runTag('factory-guest');
      const { reportId, ws } = await reportFor(org, tag);

      // Invite a guest of the FACTORY — the party that made the goods.
      const invited = expect2xx(
        await client.post(`/companies/${ws.factoryCompanyId}/guests`, {
          token: org.ownerToken,
          body: { email: `factory-${tag}@example.com` },
        }),
        'POST /companies/:id/guests (factory)',
      );

      const list = await client.get(
        `/guest/reports?token=${encodeURIComponent(invited.token)}`,
      );
      expect(list.status).toBe(200);
      // Zero — NOT "the client's report".
      expect(list.body).toEqual([]);

      // And naming the report id directly must not reach it either.
      const direct = await client.get(
        `/guest/reports/${reportId}?token=${encodeURIComponent(invited.token)}`,
      );
      expect(direct.status).toBe(404);
    }, 300_000);

    it("a client-role guest sees exactly that company's reports", async () => {
      const tag = runTag('client-guest');
      const { reportId, ws } = await reportFor(org, tag);
      const invited = expect2xx(
        await client.post(`/companies/${ws.clientCompanyId}/guests`, {
          token: org.ownerToken,
          body: { email: `client-${tag}@example.com` },
        }),
        'POST /companies/:id/guests (client)',
      );

      const list = expect2xx(
        await client.get(
          `/guest/reports?token=${encodeURIComponent(invited.token)}`,
        ),
        'GET /guest/reports',
      ) as Array<{ id: string }>;
      expect(list.map((r) => r.id)).toEqual([reportId]);
    }, 300_000);

    it("a guest of one org sees none of another org's reports", async () => {
      const tag = runTag('xorg-guest');
      const other = await createOrgWithOwner(
        client,
        adminToken,
        `${tag}-other`,
      );
      await reportFor(other, `${tag}-o`);

      // A brand-new company in OUR org, with a guest but no reports of its own.
      const mine = expect2xx(
        await client.post('/companies', {
          token: org.ownerToken,
          body: { name: `Isolated ${tag}` },
        }),
        'POST /companies',
      );
      const invited = expect2xx(
        await client.post(`/companies/${mine.id}/guests`, {
          token: org.ownerToken,
          body: { email: `xorg-${tag}@example.com` },
        }),
        'POST /companies/:id/guests',
      );

      const list = expect2xx(
        await client.get(
          `/guest/reports?token=${encodeURIComponent(invited.token)}`,
        ),
        'GET /guest/reports',
      );
      expect(list).toEqual([]);
    }, 300_000);
  });

  describe('canonical payload versioning (spec §5)', () => {
    /**
     * The guarantee the original plan gated on "a PRE-MIGRATION report still
     * verifies". The dev rows that would have proved that are gone by policy, so
     * the v1 payload is built here with the same signing key and helpers the
     * service uses — which is a better test: repeatable, and it survives
     * `prisma migrate reset`. The requirement was always about the FORMAT.
     */
    it('verifies a v1 report — the shape signed before INS-055 — as valid:true', async () => {
      const tag = runTag('v1');
      const ws = await createWorkspace(client, org.ownerToken, tag);
      const inspection = expect2xx(
        await client.post('/inspections', {
          token: org.ownerToken,
          body: { poId: ws.poId, loopPresetId: ws.presetId, lotSize: 1000 },
        }),
        'POST /inspections',
      );

      const { verificationToken } = await insertLegacyV1Report(app, {
        orgId: org.orgId,
        inspectionId: inspection.id,
        clientCompanyId: ws.clientCompanyId,
        buyerName: `Legacy Client ${tag}`,
        supplierName: `Legacy Factory ${tag}`,
      });

      const verified = expect2xx(
        await client.get(`/reports/verify/${verificationToken}`),
        'GET /reports/verify/:token (v1)',
      );
      expect(verified.valid).toBe(true);
      expect(verified.hashMatches).toBe(true);
      expect(verified.signatureValid).toBe(true);
      // Absent marker ⇒ v1. The mirrored column agrees here, but the PAYLOAD is
      // the authority — canonicalVersionOf() never reads the column.
      expect(verified.canonicalVersion).toBe(1);
    }, 300_000);

    it('signs new reports as v2 and verifies them as valid:true', async () => {
      const tag = runTag('v2');
      const ws = await createWorkspace(client, org.ownerToken, tag);
      const inspection = expect2xx(
        await client.post('/inspections', {
          token: org.ownerToken,
          body: { poId: ws.poId, loopPresetId: ws.presetId, lotSize: 1000 },
        }),
        'POST /inspections',
      );
      const itemId = inspection.items?.[0]?.id;
      const presign = expect2xx(
        await client.post(
          `/inspections/${inspection.id}/populate/photos/presign`,
          { token: adminToken, body: { ext: 'jpg' } },
        ),
        'populate presign',
      );
      expect2xx(
        await client.post(`/inspections/${inspection.id}/populate/photos`, {
          token: adminToken,
          body: {
            storageKey: presign.storageKey,
            contentHash: `hash-${tag}`,
            inspectionLoopItemId: itemId,
            cycleIndex: 0,
          },
        }),
        'populate register photo',
      );
      expect2xx(
        await client.post(`/inspections/${inspection.id}/submit`, {
          token: org.ownerToken,
          body: { deviceId: 'e2e' },
        }),
        'POST /inspections/:id/submit',
      );
      expect2xx(
        await client.post(`/inspections/${inspection.id}/decision`, {
          token: org.ownerToken,
          body: { decision: 'PASS' },
        }),
        'POST /inspections/:id/decision',
      );
      const report = expect2xx(
        await client.post(`/inspections/${inspection.id}/report`, {
          token: org.ownerToken,
        }),
        'POST /inspections/:id/report',
      );

      const verified = expect2xx(
        await client.get(`/reports/verify/${report.verificationToken}`),
        'GET /reports/verify/:token',
      );
      expect(verified.valid).toBe(true);
      expect(verified.hashMatches).toBe(true);
      expect(verified.signatureValid).toBe(true);
      expect(verified.canonicalVersion).toBe(2);

      const snap = report.canonicalSnapshot as Record<string, any>;
      expect(snap.canonicalVersion).toBe(2);
      expect(snap.client.companyId).toBe(ws.clientCompanyId);
      expect(snap.factory.companyId).toBe(ws.factoryCompanyId);
      // No aliases inside a signed envelope (spec §5.3): two keys carrying the
      // same fact double the surface where a later edit desynchronizes them.
      expect(snap.buyer).toBeUndefined();
      expect(snap.supplier).toBeUndefined();
      // The verifier's ONLY shape dependency must not have moved.
      expect(Array.isArray(snap.photoHashes)).toBe(true);
    }, 300_000);
  });
});
