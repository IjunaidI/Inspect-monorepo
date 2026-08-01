/**
 * INS-047 — per-IP rate limiting on the PUBLIC (unauthenticated) routes.
 *
 * The backlog item's acceptance criterion is literally "rapid repeated hits to
 * /auth/login and /invitations/accept are throttled (429)", so this spec proves
 * exactly that against the real AppModule.
 *
 * It deliberately runs with a LOW limit (2/window) set via env BEFORE bootApp():
 * proving the throttle with the production default (30/min) would mean firing 31
 * live logins per bucket, which is slow and pointless. The limits are read from
 * process.env per request (see src/common/throttler.config.ts), so this spec is
 * also the live proof that the env knobs actually take effect.
 *
 * The overrides are restored in afterAll — `pnpm api test:integration` runs
 * --runInBand, so every spec file shares one process and one process.env.
 */
import { INestApplication } from '@nestjs/common';
import { adminCreds, ApiClient, apiClient, bootApp, loginAdmin } from './support';

const OVERRIDES: Record<string, string> = {
  RATE_LIMIT_AUTH_LIMIT: '2',
  RATE_LIMIT_AUTH_TTL_MS: '60000',
  RATE_LIMIT_INVITE_LIMIT: '2',
  RATE_LIMIT_INVITE_TTL_MS: '60000',
  RATE_LIMIT_GUEST_LIMIT: '2',
  RATE_LIMIT_GUEST_TTL_MS: '60000',
};

describe('Public-route rate limiting (INS-047)', () => {
  let app: INestApplication;
  let client: ApiClient;
  let adminToken: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [key, value] of Object.entries(OVERRIDES)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    saved.RATE_LIMIT_DISABLED = process.env.RATE_LIMIT_DISABLED;
    // ConfigModule assigns the repo-root .env during boot; the overrides above
    // are already in process.env, and dotenv never clobbers an existing value.
    app = await bootApp();
    client = apiClient(app);

    // Get a working admin token WITHOUT spending the 2-request login budget the
    // tests below assert on: the kill switch makes the guard skip before it
    // increments the counter (which is itself worth proving).
    process.env.RATE_LIMIT_DISABLED = '1';
    adminToken = await loginAdmin(client);
    delete process.env.RATE_LIMIT_DISABLED;
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await app.close();
  });

  it('RATE_LIMIT_DISABLED skips the guard without consuming budget', async () => {
    expect(adminToken).toBeTruthy(); // the beforeAll login ran with the switch on

    process.env.RATE_LIMIT_DISABLED = '1';
    try {
      // Five hits at limit=2: every one must get its normal 400, never a 429.
      for (let i = 0; i < 5; i += 1) {
        const res = await client.post('/invitations/accept', {
          body: { token: 'definitely-not-a-token', password: 'Whatever!123', name: 'X' },
        });
        expect(res.status).toBe(400);
      }
    } finally {
      delete process.env.RATE_LIMIT_DISABLED;
    }
    // The accept budget is asserted intact further down — the skip must not have
    // incremented the counter, or that test would 429 on its FIRST request.
  });

  it('throttles rapid POST /auth/login — 3rd hit is 429 (limit=2)', async () => {
    const { email, password } = adminCreds();

    // 1st: a genuine login still succeeds.
    const first = await client.post('/auth/login', { body: { email, password } });
    expect(first.status).toBeLessThan(400);
    expect(first.body.accessToken).toBeTruthy();

    // 2nd: a WRONG password gets its normal 401 — failed attempts are counted
    // too, which is the whole point for credential stuffing.
    const second = await client.post('/auth/login', {
      body: { email, password: `${password}-definitely-wrong` },
    });
    expect(second.status).toBe(401);

    // 3rd: over budget — refused before the handler (and before any DB work).
    const third = await client.post('/auth/login', { body: { email, password } });
    expect(third.status).toBe(429);
    expect(third.body.accessToken).toBeUndefined();

    // Still blocked on a subsequent attempt within the window.
    const fourth = await client.post('/auth/login', { body: { email, password } });
    expect(fourth.status).toBe(429);
  });

  it('gives POST /auth/refresh its own budget (per-handler keys)', async () => {
    // /auth/login is exhausted by the previous test; refresh must be unaffected.
    const first = await client.post('/auth/refresh', { body: { refreshToken: 'garbage' } });
    expect(first.status).toBe(401);
    const second = await client.post('/auth/refresh', { body: { refreshToken: 'garbage' } });
    expect(second.status).toBe(401);
    const third = await client.post('/auth/refresh', { body: { refreshToken: 'garbage' } });
    expect(third.status).toBe(429);
  });

  it('throttles rapid POST /invitations/accept — 3rd hit is 429 (INS-037)', async () => {
    const body = { token: 'definitely-not-a-token', password: 'Whatever!123', name: 'X' };
    const first = await client.post('/invitations/accept', { body });
    expect(first.status).toBe(400);
    const second = await client.post('/invitations/accept', { body });
    expect(second.status).toBe(400);
    const third = await client.post('/invitations/accept', { body });
    expect(third.status).toBe(429);
  });

  it('throttles the public invitation lookup on its own budget (INS-042)', async () => {
    // Separate handler => separate counter, unaffected by the accept flood above.
    const first = await client.get('/invitations/definitely-not-a-token');
    expect(first.status).toBe(404);
    const second = await client.get('/invitations/definitely-not-a-token');
    expect(second.status).toBe(404);
    const third = await client.get('/invitations/definitely-not-a-token');
    expect(third.status).toBe(429);
  });

  it('throttles the guest portal reads', async () => {
    const first = await client.get('/guest/reports?token=definitely-not-a-token');
    expect(first.status).toBe(401);
    const second = await client.get('/guest/reports?token=definitely-not-a-token');
    expect(second.status).toBe(401);
    const third = await client.get('/guest/reports?token=definitely-not-a-token');
    expect(third.status).toBe(429);
  });

  it('leaves AUTHENTICATED routes un-throttled (ThrottlerGuard is not an APP_GUARD)', async () => {
    // Well past the limit=2 budget the public routes are running under. If the
    // guard had been registered globally, this would 429 on the 3rd call — and
    // the existing 68-test integration suite would collapse.
    for (let i = 0; i < 8; i += 1) {
      const res = await client.get('/auth/me', { token: adminToken });
      expect(res.status).toBe(200);
    }
    const list = await client.get('/buyers', { token: adminToken });
    // 403 = the no-org Platform Admin tenant guard; the point is it is NOT 429.
    expect(list.status).not.toBe(429);
  });

  it('leaves un-throttled @Public routes alone (only the attack surface opted in)', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await client.get('/health')).status).toBe(200);
      expect((await client.get('/reports/verify/definitely-not-a-token')).status).toBe(200);
    }
  });
});
