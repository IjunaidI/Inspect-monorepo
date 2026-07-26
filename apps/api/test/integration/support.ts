/**
 * Shared plumbing for the DB-backed integration suite (INS-009).
 *
 * The suite boots the real AppModule in-process (supertest, no separate server)
 * against whatever DATABASE_URL/REDIS_URL the environment provides:
 *   - locally: the repo-root .env (loaded by ConfigModule at boot)
 *   - CI: service containers (see .github/workflows/ci.yml)
 *
 * It REQUIRES a migrated + seeded database (global defect library + the
 * BOOTSTRAP_ADMIN_* Platform Admin from prisma/seed.ts).
 */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { AppModule } from '../../src/app.module';

export interface ApiResult {
  status: number;
  body: any;
}

export interface ApiClient {
  get(path: string, opts?: CallOpts): Promise<ApiResult>;
  post(path: string, opts?: CallOpts): Promise<ApiResult>;
  patch(path: string, opts?: CallOpts): Promise<ApiResult>;
  put(path: string, opts?: CallOpts): Promise<ApiResult>;
  delete(path: string, opts?: CallOpts): Promise<ApiResult>;
}

interface CallOpts {
  token?: string;
  body?: unknown;
  /** INS-079: assume an org as a Platform Admin (sets X-Org-Id). */
  orgId?: string;
}

export async function bootApp(): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication();
  await app.init();
  return app;
}

export function apiClient(app: INestApplication): ApiClient {
  const call = async (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    opts: CallOpts = {},
  ): Promise<ApiResult> => {
    let req = request(app.getHttpServer())[method](path);
    if (opts.token) req = req.set('authorization', `Bearer ${opts.token}`);
    if (opts.orgId) req = req.set('x-org-id', opts.orgId);
    if (opts.body !== undefined) req = req.send(opts.body as object);
    const res = await req;
    return { status: res.status, body: res.body };
  };
  return {
    get: (p, o) => call('get', p, o),
    post: (p, o) => call('post', p, o),
    patch: (p, o) => call('patch', p, o),
    put: (p, o) => call('put', p, o),
    delete: (p, o) => call('delete', p, o),
  };
}

export function expect2xx(res: ApiResult, what: string): any {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${what} -> ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/**
 * Bootstrap-admin credentials. Read AFTER bootApp(): ConfigModule assigns the
 * repo-root .env into process.env during boot, so a local run is zero-config.
 * CI sets these directly.
 */
export function adminCreds(): { email: string; password: string } {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD not set (env or repo-root .env) — run prisma db seed first',
    );
  }
  return { email, password };
}

export async function loginAdmin(client: ApiClient): Promise<string> {
  const { email, password } = adminCreds();
  const res = await client.post('/auth/login', { body: { email, password } });
  const body = expect2xx(res, 'admin POST /auth/login');
  return body.accessToken as string;
}

export interface OrgFixture {
  orgId: string;
  ownerToken: string;
  ownerRefreshToken: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerId: string;
}

/** Platform Admin creates an org; the invited Org Owner accepts + logs in. */
export async function createOrgWithOwner(
  client: ApiClient,
  adminToken: string,
  tag: string,
): Promise<OrgFixture> {
  const ownerEmail = `owner+${tag}@e2e.local`;
  const ownerPassword = `E2eOwner!${tag}`;
  const created = expect2xx(
    await client.post('/admin/orgs', {
      token: adminToken,
      body: { name: `E2E Org ${tag}`, type: 'INSPECTION_COMPANY', ownerEmail },
    }),
    'POST /admin/orgs',
  );
  const accepted = expect2xx(
    await client.post('/invitations/accept', {
      body: { token: created.invitation.token, password: ownerPassword, name: `E2E Owner ${tag}` },
    }),
    'POST /invitations/accept',
  );
  const login = expect2xx(
    await client.post('/auth/login', { body: { email: ownerEmail, password: ownerPassword } }),
    'owner POST /auth/login',
  );
  return {
    orgId: created.org.id,
    ownerToken: login.accessToken,
    ownerRefreshToken: login.refreshToken,
    ownerEmail,
    ownerPassword,
    ownerId: accepted.id,
  };
}

/** Org Owner invites a user with the given role; the invitee accepts + logs in. */
export async function inviteAndActivate(
  client: ApiClient,
  ownerToken: string,
  opts: { email: string; role: string; password: string; name?: string },
): Promise<{ token: string; userId: string }> {
  const invitation = expect2xx(
    await client.post('/users/invite', {
      token: ownerToken,
      body: { email: opts.email, role: opts.role },
    }),
    'POST /users/invite',
  );
  const accepted = expect2xx(
    await client.post('/invitations/accept', {
      body: { token: invitation.token, password: opts.password, name: opts.name ?? opts.email },
    }),
    'POST /invitations/accept (invitee)',
  );
  const login = expect2xx(
    await client.post('/auth/login', { body: { email: opts.email, password: opts.password } }),
    'invitee POST /auth/login',
  );
  return { token: login.accessToken, userId: accepted.id };
}

export interface WorkspaceFixture {
  buyerId: string;
  supplierId: string;
  productId: string;
  poId: string;
  presetId: string;
  minorDefectId: string | null;
}

/** Buyer + supplier + product + PO + a one-zone loop preset (MINOR defect allowed). */
export async function createWorkspace(
  client: ApiClient,
  ownerToken: string,
  tag: string,
): Promise<WorkspaceFixture> {
  const buyer = expect2xx(
    await client.post('/buyers', { token: ownerToken, body: { name: `E2E Buyer ${tag}` } }),
    'POST /buyers',
  );
  const supplier = expect2xx(
    await client.post('/suppliers', { token: ownerToken, body: { name: `E2E Supplier ${tag}` } }),
    'POST /suppliers',
  );
  const product = expect2xx(
    await client.post('/products', { token: ownerToken, body: { styleNumber: `STYLE-${tag}` } }),
    'POST /products',
  );
  const po = expect2xx(
    await client.post('/purchase-orders', {
      token: ownerToken,
      body: {
        poNumber: `PO-${tag}`,
        buyerId: buyer.id,
        supplierId: supplier.id,
        productId: product.id,
        totalQuantity: 1000,
      },
    }),
    'POST /purchase-orders',
  );
  const catalog = expect2xx(
    await client.get('/defect-catalog', { token: ownerToken }),
    'GET /defect-catalog',
  );
  const minor = Array.isArray(catalog)
    ? catalog.find((d: any) => d.defaultSeverity === 'MINOR')
    : null;
  const preset = expect2xx(
    await client.post('/loop-presets', {
      token: ownerToken,
      body: {
        name: `E2E Loop ${tag}`,
        aqlLevel: 'II',
        steps: [
          {
            zoneName: 'Front',
            requiredShotCount: 1,
            measurementFields: [{ label: 'Length', unit: 'cm' }],
            allowedDefectCatalogIds: minor ? [minor.id] : [],
          },
        ],
      },
    }),
    'POST /loop-presets',
  );
  return {
    buyerId: buyer.id,
    supplierId: supplier.id,
    productId: product.id,
    poId: po.id,
    presetId: preset.id,
    minorDefectId: minor ? minor.id : null,
  };
}

/** Unique-enough per-run tag so reruns never collide on unique columns. */
export function runTag(suffix: string): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}-${suffix}`;
}
