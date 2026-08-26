import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Characterization tests for the console's API layer (INS-082).
 *
 * These pin down the behaviours that Phase 1 of the RN migration moves into
 * `@inspect/api-client`, where `tsc` cannot help: the types are identical on
 * both sides of that extraction while the behaviour can silently change.
 *
 * The volume of mocking below is a finding, not an accident — `lib/api.ts`
 * reaches directly into `next/headers`, `next-auth/jwt` and `next/navigation`.
 * That coupling is exactly why the extracted client takes an *injected* token
 * provider instead.
 */

const getToken = vi.fn();
const headersGet = vi.fn();
const getAssumedOrgId = vi.fn();
const refreshApiAccessToken = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock('next/headers', () => ({
  headers: async () => ({ get: headersGet }),
}));
vi.mock('next-auth/jwt', () => ({ getToken: (...a: unknown[]) => getToken(...a) }));
vi.mock('next/navigation', () => ({ redirect: (p: string) => redirect(p) }));
vi.mock('./auth', () => ({
  refreshApiAccessToken: (...a: unknown[]) => refreshApiAccessToken(...a),
}));
vi.mock('./admin-org', () => ({ getAssumedOrgId: () => getAssumedOrgId() }));

const fetchMock = vi.fn();

/** A live session JWT, far from expiry so the refresh path stays out of the way. */
function activeSession(role: string) {
  return {
    accessToken: 'access-token-abc',
    refreshToken: 'refresh-token-xyz',
    accessTokenExpires: Date.now() + 10 * 60 * 1000,
    role,
  };
}

/** Headers the module passed to fetch on its Nth call. */
function sentHeaders(call = 0): Record<string, string> {
  return (fetchMock.mock.calls[call]?.[1]?.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('AUTH_SECRET', 'test-secret');
  headersGet.mockReturnValue('authjs.session-token=cookie-value');
  getToken.mockResolvedValue(activeSession('ORG_OWNER'));
  getAssumedOrgId.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('apiGetPublic', () => {
  test('returns the parsed body on success', async () => {
    const { apiGetPublic } = await import('./api');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));

    await expect(apiGetPublic('/invitations/abc')).resolves.toEqual({ ok: 1 });
  });

  test('throws ApiError carrying the HTTP status so callers can branch on it', async () => {
    const { apiGetPublic, ApiError } = await import('./api');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'Gone' }), { status: 410 }));

    // 404 (unknown invite) vs 410 (consumed/expired) drive different UI — the
    // status must survive, not collapse into a generic Error.
    await expect(apiGetPublic('/invitations/abc')).rejects.toBeInstanceOf(ApiError);
    await expect(apiGetPublic('/invitations/abc')).rejects.toMatchObject({ status: 410 });
  });

  test('surfaces the API message, including a validation array', async () => {
    const { apiGetPublic } = await import('./api');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: ['name required', 'email invalid'] }), { status: 400 }),
    );

    await expect(apiGetPublic('/x')).rejects.toThrow('name required, email invalid');
  });

  test('survives a non-JSON error body', async () => {
    const { apiGetPublic } = await import('./api');
    fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    // A proxy's HTML error page must not surface as a JSON parse failure.
    await expect(apiGetPublic('/x')).rejects.toMatchObject({ status: 502 });
  });

  test('sends no Authorization header — it is unauthenticated by contract', async () => {
    const { apiGetPublic } = await import('./api');
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiGetPublic('/guest/reports?token=t');

    expect(sentHeaders()).not.toHaveProperty('Authorization');
    expect(sentHeaders()).not.toHaveProperty('X-Org-Id');
  });
});

describe('apiGet authentication headers', () => {
  test('attaches the session bearer token', async () => {
    const { apiGet } = await import('./api');
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiGet('/companies');

    expect(sentHeaders().Authorization).toBe('Bearer access-token-abc');
  });

  test('attaches X-Org-Id for a PLATFORM_ADMIN operating inside an assumed org', async () => {
    const { apiGet } = await import('./api');
    getToken.mockResolvedValue(activeSession('PLATFORM_ADMIN'));
    getAssumedOrgId.mockResolvedValue('org_123');
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiGet('/companies');

    expect(sentHeaders()['X-Org-Id']).toBe('org_123');
  });

  test('never attaches X-Org-Id for a non-admin role, even with an assumed-org cookie present', async () => {
    const { apiGet } = await import('./api');
    // A stale inspect_admin_org cookie surviving into a different session on a
    // shared browser must not leak another org's scope onto an org user.
    getToken.mockResolvedValue(activeSession('ORG_OWNER'));
    getAssumedOrgId.mockResolvedValue('org_123');
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiGet('/companies');

    expect(sentHeaders()).not.toHaveProperty('X-Org-Id');
  });

  test('detects the __Secure- cookie name rather than assuming it', async () => {
    const { apiGet } = await import('./api');
    // Auth.js derives the JWE salt from the cookie NAME; guessing wrong makes
    // the decrypt yield null silently instead of erroring.
    headersGet.mockReturnValue('__Secure-authjs.session-token=cookie-value');
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiGet('/companies');

    expect(getToken).toHaveBeenCalledWith(
      expect.objectContaining({
        cookieName: '__Secure-authjs.session-token',
        salt: '__Secure-authjs.session-token',
        secureCookie: true,
      }),
    );
  });

  test('throws ApiError with the status on a non-2xx response', async () => {
    const { apiGet } = await import('./api');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'nope' }), { status: 403 }));

    await expect(apiGet('/companies')).rejects.toMatchObject({ status: 403, path: '/companies' });
  });
});

describe('loadOrFallback', () => {
  const FALLBACK = [{ id: 'demo' }];

  test('returns live data when the API answers', async () => {
    const { loadOrFallback } = await import('./api');
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ id: 'real' }]), { status: 200 }));

    await expect(loadOrFallback('/companies', FALLBACK)).resolves.toEqual({
      data: [{ id: 'real' }],
      live: true,
    });
  });

  test('falls back to demo data when the API is unreachable', async () => {
    const { loadOrFallback } = await import('./api');
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(loadOrFallback('/companies', FALLBACK)).resolves.toEqual({
      data: FALLBACK,
      live: false,
    });
  });

  test('falls back on a non-auth API error such as 404', async () => {
    const { loadOrFallback } = await import('./api');
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));

    await expect(loadOrFallback('/companies', FALLBACK)).resolves.toEqual({
      data: FALLBACK,
      live: false,
    });
  });

  test('re-throws 401 instead of masking it as offline', async () => {
    const { loadOrFallback } = await import('./api');
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));

    // Silently showing demo data to an unauthenticated user would hide the
    // session expiry instead of sending them to log in.
    await expect(loadOrFallback('/companies', FALLBACK)).rejects.toMatchObject({ status: 401 });
  });

  test('re-throws an ordinary 403', async () => {
    const { loadOrFallback } = await import('./api');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }));

    await expect(loadOrFallback('/companies', FALLBACK)).rejects.toMatchObject({ status: 403 });
  });

  test('redirects an un-assumed Platform Admin on the no-org-context 403', async () => {
    const { loadOrFallback } = await import('./api');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'No organization context' }), { status: 403 }),
    );

    // Next redacts Server Component error messages in production, so a client
    // error boundary cannot pattern-match this — it has to be handled here.
    await expect(loadOrFallback('/dashboard/summary', FALLBACK)).rejects.toThrow('NEXT_REDIRECT:/admin/orgs');
    expect(redirect).toHaveBeenCalledWith('/admin/orgs');
  });
});

describe('token refresh', () => {
  test('renews an expired access token and sends the new one', async () => {
    const { apiGet } = await import('./api');
    getToken.mockResolvedValue({ ...activeSession('ORG_OWNER'), accessTokenExpires: Date.now() - 1000 });
    refreshApiAccessToken.mockResolvedValue({ accessToken: 'fresh-token' });
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiGet('/companies');

    expect(refreshApiAccessToken).toHaveBeenCalledWith('refresh-token-xyz');
    expect(sentHeaders().Authorization).toBe('Bearer fresh-token');
  });

  test('falls back to the stale token when refresh fails, letting the API answer 401', async () => {
    const { apiGet } = await import('./api');
    getToken.mockResolvedValue({ ...activeSession('ORG_OWNER'), accessTokenExpires: Date.now() - 1000 });
    refreshApiAccessToken.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiGet('/companies');

    expect(sentHeaders().Authorization).toBe('Bearer access-token-abc');
  });

  test('renews within the 60s clock-skew buffer, so a call landing at expiry still authenticates', async () => {
    const { apiGet } = await import('./api');
    getToken.mockResolvedValue({ ...activeSession('ORG_OWNER'), accessTokenExpires: Date.now() + 30_000 });
    refreshApiAccessToken.mockResolvedValue({ accessToken: 'fresh-token' });
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiGet('/companies');

    expect(sentHeaders().Authorization).toBe('Bearer fresh-token');
  });

  test('sends no Authorization header when there is no session', async () => {
    const { apiGet } = await import('./api');
    getToken.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiGet('/companies');

    expect(sentHeaders()).not.toHaveProperty('Authorization');
  });
});
