/**
 * INS-071 / INS-072 / INS-077 — the workspace-write validation surface, proven
 * against the real DB.
 *
 * All three fields feed a tamper-proof artifact and used to be persisted
 * verbatim:
 *   - Buyer.primaryColor freezes into Report.brandingSnapshot, so "red" or ""
 *     became permanent garbage in a signed report (INS-077).
 *   - Buyer.logoUrl freezes into the same snapshot, so it must hold a DURABLE
 *     object key (or a legacy absolute URL) and never a ~900s presigned URL that
 *     would rot the artifact (INS-072). Rendering re-signs the key at read time,
 *     behind an org-prefix guard so the decoration cannot become a signing oracle
 *     over another tenant's objects.
 *   - Supplier.gps was typed `unknown` and stored as-is, so the console's
 *     hand-typed JSON silently saved junk — or nothing at all (INS-071).
 *
 * The byte-path assertions follow the storage self-skip discipline of
 * storage-bytes.e2e-spec.ts: probe S3_ENDPOINT + bucket first and skip loudly
 * when unreachable, unless REQUIRE_STORAGE=1 (CI sets it) makes it a hard failure.
 * The pure-validation and org-prefix-guard assertions need no object storage and
 * always run.
 */
import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  ApiClient,
  apiClient,
  bootApp,
  createOrgWithOwner,
  expect2xx,
  loginAdmin,
  OrgFixture,
  runTag,
} from './support';

interface StorageProbe {
  usable: boolean;
  reason: string;
}

/** Same probe as storage-bytes.e2e-spec.ts — see its notes on managed 403s vs MinIO 404s. */
async function probeStorage(endpoint: string, bucket: string): Promise<StorageProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/${bucket}`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (res.status === 404) {
      return { usable: false, reason: `bucket "${bucket}" not found at ${endpoint}` };
    }
    return { usable: true, reason: 'ok' };
  } catch {
    return { usable: false, reason: `object storage unreachable at ${endpoint}` };
  } finally {
    clearTimeout(timer);
  }
}

describe('Workspace write validation (integration)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let org: OrgFixture;
  /** A SECOND tenant, purely so a genuinely foreign org id exists to craft a key from. */
  let foreignOrg: OrgFixture;
  let storageUp = false;
  const tag = runTag('validation');

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    const adminToken = await loginAdmin(client);
    org = await createOrgWithOwner(client, adminToken, tag);
    foreignOrg = await createOrgWithOwner(client, adminToken, `${tag}-foreign`);

    const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
    const bucket = process.env.S3_BUCKET ?? 'inspect-photos';
    const probe = await probeStorage(endpoint, bucket);
    storageUp = probe.usable;
    if (!storageUp) {
      if (process.env.REQUIRE_STORAGE === '1') {
        throw new Error(`REQUIRE_STORAGE=1 but the buyer-logo byte path cannot run: ${probe.reason}`);
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[workspace-validation] logo BYTE assertions SKIPPED — ${probe.reason}. ` +
          'Validation and org-prefix-guard assertions still ran.',
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // ── INS-077: buyer primaryColor ─────────────────────────────────────────
  describe('buyer primaryColor', () => {
    it('rejects a non-hex colour on create', async () => {
      const res = await client.post('/buyers', {
        token: org.ownerToken,
        body: { name: `Colour reject ${tag}`, primaryColor: 'red' },
      });
      expect(res.status).toBe(400);
      expect(String(res.body?.message)).toMatch(/primaryColor/i);
    });

    it('accepts #1457A3 on create and normalises its case', async () => {
      const buyer = expect2xx(
        await client.post('/buyers', {
          token: org.ownerToken,
          body: { name: `Colour ok ${tag}`, primaryColor: '#1457A3' },
        }),
        'POST /buyers (valid colour)',
      );
      // Case is normalised so #1457A3 and #1457a3 cannot produce two different
      // brandingSnapshots for what is the same colour.
      expect(buyer.primaryColor).toBe('#1457a3');
      const fetched = expect2xx(
        await client.get(`/buyers/${buyer.id}`, { token: org.ownerToken }),
        'GET /buyers/:id',
      );
      expect(fetched.primaryColor).toBe('#1457a3');
    });

    it('rejects a non-hex colour on update and leaves the stored value untouched', async () => {
      const buyer = expect2xx(
        await client.post('/buyers', {
          token: org.ownerToken,
          body: { name: `Colour patch ${tag}`, primaryColor: '#1457A3' },
        }),
        'POST /buyers (patch fixture)',
      );
      const res = await client.patch(`/buyers/${buyer.id}`, {
        token: org.ownerToken,
        body: { primaryColor: 'red' },
      });
      expect(res.status).toBe(400);
      // The service validates BEFORE touching the DB, so nothing was written.
      const after = expect2xx(
        await client.get(`/buyers/${buyer.id}`, { token: org.ownerToken }),
        'GET /buyers/:id (after rejected patch)',
      );
      expect(after.primaryColor).toBe('#1457a3');

      const ok = expect2xx(
        await client.patch(`/buyers/${buyer.id}`, {
          token: org.ownerToken,
          body: { primaryColor: '#0B7D6B' },
        }),
        'PATCH /buyers/:id (valid colour)',
      );
      expect(ok.primaryColor).toBe('#0b7d6b');
    });
  });

  // ── INS-071: supplier gps ───────────────────────────────────────────────
  describe('supplier gps', () => {
    it('rejects a structurally wrong gps object', async () => {
      const res = await client.post('/suppliers', {
        token: org.ownerToken,
        body: { name: `Gps shape ${tag}`, gps: { foo: 1 } },
      });
      expect(res.status).toBe(400);
      expect(String(res.body?.message)).toMatch(/lat/i);
    });

    it('rejects an out-of-range latitude', async () => {
      const res = await client.post('/suppliers', {
        token: org.ownerToken,
        body: { name: `Gps range ${tag}`, gps: { lat: 999, lng: 90.4125 } },
      });
      expect(res.status).toBe(400);
      expect(String(res.body?.message)).toMatch(/-90/);
    });

    it('rejects a non-object gps', async () => {
      const res = await client.post('/suppliers', {
        token: org.ownerToken,
        body: { name: `Gps scalar ${tag}`, gps: '23.8103,90.4125' },
      });
      expect(res.status).toBe(400);
    });

    it('round-trips a valid pair as exactly { lat, lng }', async () => {
      const created = expect2xx(
        await client.post('/suppliers', {
          token: org.ownerToken,
          // The extra key must be stripped: the column is canonical { lat, lng }.
          body: { name: `Gps ok ${tag}`, gps: { lat: 23.8103, lng: 90.4125, altitude: 5 } },
        }),
        'POST /suppliers (valid gps)',
      );
      expect(created.gps).toEqual({ lat: 23.8103, lng: 90.4125 });

      const fetched = expect2xx(
        await client.get(`/suppliers/${created.id}`, { token: org.ownerToken }),
        'GET /suppliers/:id',
      );
      expect(fetched.gps).toEqual({ lat: 23.8103, lng: 90.4125 });
      expect(Object.keys(fetched.gps).sort()).toEqual(['lat', 'lng']);
    });

    it('rejects a bad gps on update and leaves the stored pair intact', async () => {
      const created = expect2xx(
        await client.post('/suppliers', {
          token: org.ownerToken,
          body: { name: `Gps patch ${tag}`, gps: { lat: 11.1085, lng: 77.3411 } },
        }),
        'POST /suppliers (patch fixture)',
      );
      const res = await client.patch(`/suppliers/${created.id}`, {
        token: org.ownerToken,
        body: { gps: { lat: 'north', lng: 77.3411 } },
      });
      expect(res.status).toBe(400);
      const after = expect2xx(
        await client.get(`/suppliers/${created.id}`, { token: org.ownerToken }),
        'GET /suppliers/:id (after rejected patch)',
      );
      expect(after.gps).toEqual({ lat: 11.1085, lng: 77.3411 });
    });

    it('clears the pin when gps is explicitly null', async () => {
      const created = expect2xx(
        await client.post('/suppliers', {
          token: org.ownerToken,
          body: { name: `Gps clear ${tag}`, gps: { lat: 21.0285, lng: 105.8542 } },
        }),
        'POST /suppliers (clear fixture)',
      );
      expect2xx(
        await client.patch(`/suppliers/${created.id}`, { token: org.ownerToken, body: { gps: null } }),
        'PATCH /suppliers/:id (clear gps)',
      );
      const after = expect2xx(
        await client.get(`/suppliers/${created.id}`, { token: org.ownerToken }),
        'GET /suppliers/:id (after clear)',
      );
      expect(after.gps).toBeNull();
    });
  });

  // ── INS-072: buyer logo key + view-URL decoration ───────────────────────
  describe('buyer logo', () => {
    it('echoes a legacy absolute URL but nulls a crafted foreign-org key', async () => {
      const buyer = expect2xx(
        await client.post('/buyers', { token: org.ownerToken, body: { name: `Logo guard ${tag}` } }),
        'POST /buyers (logo guard fixture)',
      );

      // Control, and the no-migration guarantee: a pre-INS-072 absolute URL is
      // echoed verbatim. This also proves the decoration is live, so the null
      // asserted below is the org-prefix guard talking — not a blanket null.
      const legacy = `https://legacy.example.com/${tag}/logo.png`;
      expect2xx(
        await client.patch(`/buyers/${buyer.id}`, { token: org.ownerToken, body: { logoUrl: legacy } }),
        'PATCH /buyers/:id (legacy URL)',
      );
      const legacyRead = expect2xx(
        await client.get(`/buyers/${buyer.id}`, { token: org.ownerToken }),
        'GET /buyers/:id (legacy URL)',
      );
      expect(legacyRead.logoUrl).toBe(legacy);
      expect(legacyRead.logoViewUrl).toBe(legacy);

      // A key inside ANOTHER tenant's namespace must never be signed — otherwise
      // this endpoint is a signing oracle over that tenant's objects.
      const foreignKey = `orgs/${foreignOrg.orgId}/buyers/${randomUUID()}.png`;
      expect(foreignOrg.orgId).not.toBe(org.orgId);
      expect2xx(
        await client.patch(`/buyers/${buyer.id}`, { token: org.ownerToken, body: { logoUrl: foreignKey } }),
        'PATCH /buyers/:id (foreign key)',
      );
      const foreignRead = expect2xx(
        await client.get(`/buyers/${buyer.id}`, { token: org.ownerToken }),
        'GET /buyers/:id (foreign key)',
      );
      // The durable column still holds what was written — the null below comes
      // from the read-time guard, not from a rejected write.
      expect(foreignRead.logoUrl).toBe(foreignKey);
      expect(foreignRead.logoViewUrl).toBeNull();
    });

    it('presigns, uploads and re-signs a logo without ever persisting a presigned URL', async () => {
      if (!storageUp) return; // skipped — see beforeAll warning

      const buyer = expect2xx(
        await client.post('/buyers', { token: org.ownerToken, body: { name: `Logo bytes ${tag}` } }),
        'POST /buyers (logo bytes fixture)',
      );

      const presign = expect2xx(
        await client.post('/buyers/presign', { token: org.ownerToken, body: { ext: 'png' } }),
        'POST /buyers/presign',
      );
      // The key is namespaced to THIS org — that prefix is exactly what the
      // read-time guard re-checks.
      expect(presign.storageKey).toMatch(new RegExp(`^orgs/${org.orgId}/buyers/`));
      expect(presign.method).toBe('PUT');
      expect(presign.uploadUrl).toContain('X-Amz-Signature');

      const bytes = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG magic
        Buffer.from(`e2e buyer logo ${tag}`, 'utf8'),
      ]);
      const put = await fetch(presign.uploadUrl, { method: 'PUT', body: bytes });
      expect(put.status).toBeGreaterThanOrEqual(200);
      expect(put.status).toBeLessThan(300);

      expect2xx(
        await client.patch(`/buyers/${buyer.id}`, {
          token: org.ownerToken,
          body: { logoUrl: presign.storageKey },
        }),
        'PATCH /buyers/:id (store durable key)',
      );

      const detail = expect2xx(
        await client.get(`/buyers/${buyer.id}`, { token: org.ownerToken }),
        'GET /buyers/:id (logo view url)',
      );
      // THE contract: the column holds the durable key, and the presigned URL is
      // a separate render-time field. A presigned URL in `logoUrl` would freeze
      // into brandingSnapshot and 403 forever after ~900s.
      expect(detail.logoUrl).toBe(presign.storageKey);
      expect(detail.logoUrl).not.toMatch(/^https?:\/\//i);
      expect(detail.logoViewUrl).toBeTruthy();
      expect(detail.logoViewUrl).toContain('X-Amz-Signature');
      expect(detail.logoViewUrl).not.toBe(detail.logoUrl);

      // The list endpoint decorates too (the console renders logos from it).
      const list = expect2xx(
        await client.get(`/buyers?q=${encodeURIComponent(`Logo bytes ${tag}`)}`, {
          token: org.ownerToken,
        }),
        'GET /buyers (logo view url)',
      );
      const row = (list as Array<{ id: string; logoUrl: string; logoViewUrl: string | null }>).find(
        (b) => b.id === buyer.id,
      );
      expect(row?.logoUrl).toBe(presign.storageKey);
      expect(row?.logoViewUrl).toBeTruthy();

      // And the signed GET actually returns the exact bytes that were uploaded.
      const download = await fetch(detail.logoViewUrl);
      expect(download.status).toBe(200);
      const downloaded = Buffer.from(await download.arrayBuffer());
      expect(createHash('sha256').update(downloaded).digest('hex')).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );

      // Storage is demonstrably signable here, so the null a foreign-org key
      // yields is unambiguously the org-prefix guard.
      const foreignKey = `orgs/${foreignOrg.orgId}/buyers/${randomUUID()}.png`;
      expect2xx(
        await client.patch(`/buyers/${buyer.id}`, { token: org.ownerToken, body: { logoUrl: foreignKey } }),
        'PATCH /buyers/:id (foreign key, storage up)',
      );
      const guarded = expect2xx(
        await client.get(`/buyers/${buyer.id}`, { token: org.ownerToken }),
        'GET /buyers/:id (foreign key, storage up)',
      );
      expect(guarded.logoViewUrl).toBeNull();
    });
  });
});
