/**
 * INS-009 — the negative auth/RBAC matrix, live against a real Postgres+Redis.
 *
 * Covers what the unit suites and the happy-path smoke loop deliberately do not:
 *   - 401s: missing/garbage/forged/expired tokens, refresh-as-access
 *   - the token refresh round-trip (phase-2 plan item, previously unverified live)
 *   - 403s: additive role floors + the no-org Platform-Admin tenant guard
 *   - cross-org isolation (owner A can never see or mutate org B's rows)
 *   - INS-035/036 regressions (cross-tenant invite refusal; old dev-secret forgery)
 *   - @Public routes stay public
 */
import { INestApplication } from '@nestjs/common';
import { signJwt } from '../../src/auth/jwt';
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

describe('Auth & RBAC negative matrix (integration)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let adminToken: string;
  let orgA: OrgFixture;
  let orgB: OrgFixture;
  let inspectorToken: string;
  let buyerAId: string;
  let buyerBId: string;
  const tag = runTag('rbac');

  beforeAll(async () => {
    app = await bootApp();
    client = apiClient(app);
    adminToken = await loginAdmin(client);
    orgA = await createOrgWithOwner(client, adminToken, `${tag}-a`);
    orgB = await createOrgWithOwner(client, adminToken, `${tag}-b`);
    ({ token: inspectorToken } = await inviteAndActivate(client, orgA.ownerToken, {
      email: `inspector+${tag}@e2e.local`,
      role: 'INSPECTOR',
      password: `E2eInspector!${tag}`,
    }));
    buyerAId = expect2xx(
      await client.post('/buyers', { token: orgA.ownerToken, body: { name: `Buyer A ${tag}` } }),
      'POST /buyers (org A)',
    ).id;
    buyerBId = expect2xx(
      await client.post('/buyers', { token: orgB.ownerToken, body: { name: `Buyer B ${tag}` } }),
      'POST /buyers (org B)',
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('401 — unauthenticated / bad tokens', () => {
    it('rejects a protected route with no token', async () => {
      const res = await client.get('/buyers');
      expect(res.status).toBe(401);
    });

    it('rejects a garbage token', async () => {
      const res = await client.get('/buyers', { token: 'not-a-jwt' });
      expect(res.status).toBe(401);
    });

    it('rejects a PLATFORM_ADMIN token forged with the removed dev-default secret (INS-036)', async () => {
      const forged = signJwt(
        { sub: 'attacker', orgId: null, role: 'PLATFORM_ADMIN', type: 'access' },
        'dev-access-secret',
        3600,
      );
      const res = await client.get('/auth/me', { token: forged });
      expect(res.status).toBe(401);
    });

    it('rejects an expired token signed with the real secret', async () => {
      const secret = process.env.JWT_ACCESS_SECRET as string;
      expect(secret).toBeTruthy();
      const past = Math.floor(Date.now() / 1000) - 3600;
      const expired = signJwt(
        { sub: 'someone', orgId: orgA.orgId, role: 'ORG_OWNER', type: 'access' },
        secret,
        60,
        past,
      );
      const res = await client.get('/auth/me', { token: expired });
      expect(res.status).toBe(401);
    });

    it('rejects a refresh token presented as an access token', async () => {
      const res = await client.get('/auth/me', { token: orgA.ownerRefreshToken });
      expect(res.status).toBe(401);
    });
  });

  describe('token refresh round-trip (live)', () => {
    it('exchanges a valid refresh token for a working new pair', async () => {
      const res = await client.post('/auth/refresh', {
        body: { refreshToken: orgA.ownerRefreshToken },
      });
      const pair = expect2xx(res, 'POST /auth/refresh');
      expect(pair.accessToken).toBeTruthy();
      expect(pair.refreshToken).toBeTruthy();

      const me = await client.get('/auth/me', { token: pair.accessToken });
      expect(me.status).toBe(200);
      expect(me.body.orgId).toBe(orgA.orgId);
      expect(me.body.role).toBe('ORG_OWNER');
    });

    it('rejects an access token presented as a refresh token', async () => {
      const res = await client.post('/auth/refresh', {
        body: { refreshToken: orgA.ownerToken },
      });
      expect(res.status).toBe(401);
    });

    it('rejects a garbage refresh token', async () => {
      const res = await client.post('/auth/refresh', { body: { refreshToken: 'garbage' } });
      expect(res.status).toBe(401);
    });

    it('rejects a missing refresh token with 400', async () => {
      const res = await client.post('/auth/refresh', { body: {} });
      expect(res.status).toBe(400);
    });
  });

  describe('403 — additive role floors', () => {
    it('INSPECTOR cannot write a QA_MANAGER resource', async () => {
      const res = await client.post('/buyers', {
        token: inspectorToken,
        body: { name: 'nope' },
      });
      expect(res.status).toBe(403);
    });

    it('INSPECTOR cannot list users (ORG_OWNER floor)', async () => {
      const res = await client.get('/users', { token: inspectorToken });
      expect(res.status).toBe(403);
    });

    it('INSPECTOR still passes routes with no role floor (/auth/me)', async () => {
      const res = await client.get('/auth/me', { token: inspectorToken });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('INSPECTOR');
    });

    it('ORG_OWNER cannot create orgs (PLATFORM_ADMIN floor)', async () => {
      const res = await client.post('/admin/orgs', {
        token: orgA.ownerToken,
        body: { name: 'nope', type: 'INSPECTION_COMPANY', ownerEmail: `x+${tag}@e2e.local` },
      });
      expect(res.status).toBe(403);
    });

    it('ORG_OWNER cannot use the populate console (PLATFORM_ADMIN floor)', async () => {
      const res = await client.post('/inspections/any-id/populate/photos/presign', {
        token: orgA.ownerToken,
        body: { ext: 'jpg' },
      });
      expect(res.status).toBe(403);
    });

    it('the no-org PLATFORM_ADMIN is refused on org-scoped routes (tenant guard)', async () => {
      const res = await client.get('/buyers', { token: adminToken });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain('organization context');
    });
  });

  describe('cross-org isolation', () => {
    it("owner A cannot read org B's buyer by id", async () => {
      const res = await client.get(`/buyers/${buyerBId}`, { token: orgA.ownerToken });
      expect(res.status).toBe(404);
    });

    it("owner A cannot mutate org B's buyer", async () => {
      const res = await client.patch(`/buyers/${buyerBId}`, {
        token: orgA.ownerToken,
        body: { name: 'hijacked' },
      });
      expect(res.status).toBe(404);
      const intact = expect2xx(
        await client.get(`/buyers/${buyerBId}`, { token: orgB.ownerToken }),
        'GET /buyers/:id (org B, after attempted hijack)',
      );
      expect(intact.name).toBe(`Buyer B ${tag}`);
    });

    it("owner A's buyer list never contains org B's rows", async () => {
      const list = expect2xx(
        await client.get('/buyers', { token: orgA.ownerToken }),
        'GET /buyers (org A)',
      );
      const ids = (list as any[]).map((b) => b.id);
      expect(ids).toContain(buyerAId);
      expect(ids).not.toContain(buyerBId);
    });

    it('org B cannot invite an email already registered in org A (INS-035)', async () => {
      const res = await client.post('/users/invite', {
        token: orgB.ownerToken,
        body: { email: orgA.ownerEmail, role: 'INSPECTOR' },
      });
      expect(res.status).toBe(403);

      // The foreign account is untouched: owner A still logs in and belongs to org A.
      const login = expect2xx(
        await client.post('/auth/login', {
          body: { email: orgA.ownerEmail, password: orgA.ownerPassword },
        }),
        'owner A re-login after cross-org invite attempt',
      );
      const me = await client.get('/auth/me', { token: login.accessToken });
      expect(me.body.orgId).toBe(orgA.orgId);
    });
  });

  describe('@Public routes stay public', () => {
    it('GET / responds without auth', async () => {
      const res = await client.get('/');
      expect(res.status).toBe(200);
    });

    it('GET /health responds without auth', async () => {
      const res = await client.get('/health');
      expect(res.status).toBe(200);
    });

    it('report verification is public and fails closed on an unknown token', async () => {
      const res = await client.get('/reports/verify/definitely-not-a-token');
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
    });

    it('invitation accept is public (bad token is a 4xx, not a 401 guard rejection)', async () => {
      const res = await client.post('/invitations/accept', {
        body: { token: 'definitely-not-a-token', password: 'Whatever!123', name: 'X' },
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.status).not.toBe(401);
    });
  });
});
