import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApiClient } from './client';
import { decodeJwtExp } from './auth';
import { ApiError } from './errors';

/**
 * The login / refresh / me exchange (INS-088).
 *
 * These are the three endpoints a client needs BEFORE it has credentials, so
 * none of them may go through the injected auth provider: `login` and `refresh`
 * are unauthenticated by definition, and `me` is handed the token explicitly
 * because at that moment the session does not exist yet.
 */
const fetchMock = vi.fn();
const BASE = 'https://api.test';

const replyWith = (body: BodyInit | null, init?: ResponseInit) =>
  fetchMock.mockImplementation(() => Promise.resolve(new Response(body, init)));

const headersOf = (call = 0) =>
  (fetchMock.mock.calls[call]?.[1]?.headers ?? {}) as Record<string, string>;
const urlOf = (call = 0) => fetchMock.mock.calls[call]?.[0] as string;
const initOf = (call = 0) => (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit;

/** A JWT with the given payload. Signature is irrelevant — nothing verifies it here. */
function jwt(payload: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('login', () => {
  test('posts the credentials and returns the issued tokens', async () => {
    const api = createApiClient({ baseUrl: BASE });
    replyWith(JSON.stringify({ accessToken: 'a', refreshToken: 'r' }), { status: 200 });

    await expect(api.login('jane@example.com', 'hunter2')).resolves.toEqual({
      accessToken: 'a',
      refreshToken: 'r',
    });
    expect(urlOf()).toBe('https://api.test/auth/login');
    expect(initOf().method).toBe('POST');
    expect(initOf().body).toBe('{"email":"jane@example.com","password":"hunter2"}');
  });

  test('sends no Authorization header even when a provider is configured', async () => {
    // Logging in with a stale bearer attached would be nonsense at best, and at
    // worst would authenticate the wrong principal.
    const api = createApiClient({ baseUrl: BASE, auth: async () => ({ token: 'stale', orgId: 'org_1' }) });
    replyWith(JSON.stringify({ accessToken: 'a', refreshToken: 'r' }), { status: 200 });

    await api.login('jane@example.com', 'hunter2');

    expect(headersOf()).not.toHaveProperty('Authorization');
    expect(headersOf()).not.toHaveProperty('X-Org-Id');
  });

  test('throws ApiError with the status on bad credentials', async () => {
    const api = createApiClient({ baseUrl: BASE });
    replyWith(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 });

    await expect(api.login('jane@example.com', 'wrong')).rejects.toBeInstanceOf(ApiError);
    await expect(api.login('jane@example.com', 'wrong')).rejects.toMatchObject({ status: 401 });
  });
});

describe('me', () => {
  test('sends the token it is given, not the provider’s', async () => {
    // During login there is no session yet, so the provider would return null —
    // the freshly issued token has to be passed in explicitly.
    const api = createApiClient({ baseUrl: BASE, auth: async () => ({ token: 'provider-token' }) });
    replyWith(JSON.stringify({ userId: 'u1', role: 'QA_MANAGER' }), { status: 200 });

    const me = await api.me('fresh-token');

    expect(headersOf().Authorization).toBe('Bearer fresh-token');
    expect(urlOf()).toBe('https://api.test/auth/me');
    expect(me).toMatchObject({ userId: 'u1', role: 'QA_MANAGER' });
  });
});

describe('refresh', () => {
  test('returns null without calling the API when there is no usable token', async () => {
    const api = createApiClient({ baseUrl: BASE });

    await expect(api.refresh(undefined)).resolves.toBeNull();
    await expect(api.refresh('')).resolves.toBeNull();
    await expect(api.refresh(42)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns the new tokens with the expiry decoded from the access token', async () => {
    const api = createApiClient({ baseUrl: BASE });
    const exp = Math.floor(Date.now() / 1000) + 900;
    replyWith(JSON.stringify({ accessToken: jwt({ exp }), refreshToken: 'r2' }), { status: 200 });

    const out = await api.refresh('r1');

    expect(out?.refreshToken).toBe('r2');
    expect(out?.accessTokenExpires).toBe(exp * 1000);
    expect(initOf().body).toBe('{"refreshToken":"r1"}');
  });

  test('keeps the current refresh token when the API does not rotate one', async () => {
    const api = createApiClient({ baseUrl: BASE });
    replyWith(JSON.stringify({ accessToken: jwt({ exp: 1 }) }), { status: 200 });

    await expect(api.refresh('r1')).resolves.toMatchObject({ refreshToken: 'r1' });
  });

  test('returns null rather than throwing when the API rejects the refresh', async () => {
    // The caller's fallback is to send the stale token and let the API answer
    // 401 — a throw here would turn an expired session into a crashed render.
    const api = createApiClient({ baseUrl: BASE });
    replyWith(JSON.stringify({ message: 'expired' }), { status: 401 });

    await expect(api.refresh('r1')).resolves.toBeNull();
  });

  test('returns null rather than throwing when the network fails', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(api.refresh('r1')).resolves.toBeNull();
  });

  test('returns null when the response carries no access token', async () => {
    const api = createApiClient({ baseUrl: BASE });
    replyWith(JSON.stringify({ refreshToken: 'r2' }), { status: 200 });

    await expect(api.refresh('r1')).resolves.toBeNull();
  });

  test('falls back to a 15-minute expiry when the token carries no usable exp', async () => {
    const api = createApiClient({ baseUrl: BASE });
    replyWith(JSON.stringify({ accessToken: 'not-a-jwt' }), { status: 200 });

    const before = Date.now();
    const out = await api.refresh('r1');

    expect(out?.accessTokenExpires).toBeGreaterThanOrEqual(before + 15 * 60 * 1000 - 50);
  });
});

describe('decodeJwtExp', () => {
  test('returns the expiry in milliseconds', () => {
    expect(decodeJwtExp(jwt({ exp: 1893456000 }))).toBe(1893456000 * 1000);
  });

  test('returns null for a malformed token', () => {
    expect(decodeJwtExp('not-a-jwt')).toBeNull();
    expect(decodeJwtExp('')).toBeNull();
    expect(decodeJwtExp('a.b')).toBeNull();
  });

  test('returns null when exp is absent or not a number', () => {
    expect(decodeJwtExp(jwt({ sub: 'u1' }))).toBeNull();
    expect(decodeJwtExp(jwt({ exp: 'soon' }))).toBeNull();
  });

  test('decodes a payload containing non-ASCII characters', () => {
    // A base64url payload is bytes, not Latin-1. Decoding it with a naive
    // atob() and no UTF-8 step corrupts any multi-byte character and can throw
    // inside JSON.parse — which would silently cost the token its expiry.
    expect(decodeJwtExp(jwt({ exp: 1893456000, orgName: 'Tekstil Şirketi — 東京' }))).toBe(
      1893456000 * 1000,
    );
  });

  test('decodes a payload whose base64url length needs padding', () => {
    // Buffer.from tolerates missing '=' padding; atob in some engines does not.
    const token = jwt({ exp: 1893456000, pad: 'a' });
    expect(token.split('.')[1].length % 4).not.toBe(0);
    expect(decodeJwtExp(token)).toBe(1893456000 * 1000);
  });
});
