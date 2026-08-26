import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError } from './errors';

/**
 * Unit tests for the shared API client (INS-086 Phase 1).
 *
 * The whole point of this suite is what it does NOT mock: there is no
 * `next/headers`, no `next-auth/jwt`, no cookie. The client takes an injected
 * auth provider, so it is testable — and usable — with no framework at all.
 * Compare `apps/web/lib/api.test.ts`, whose mock preamble is the coupling this
 * package exists to remove.
 */
const fetchMock = vi.fn();
const BASE = 'https://api.test';

/**
 * A FRESH Response per call. `mockResolvedValue(new Response(...))` hands the
 * same object to every call and a Response body can only be read once, so any
 * test making two requests fails with "Body has already been read".
 */
const replyWith = (body: BodyInit | null, init?: ResponseInit) =>
  fetchMock.mockImplementation(() => Promise.resolve(new Response(body, init)));

const headersOf = (call = 0) =>
  (fetchMock.mock.calls[call]?.[1]?.headers ?? {}) as Record<string, string>;
const urlOf = (call = 0) => fetchMock.mock.calls[call]?.[0] as string;
const initOf = (call = 0) => (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('request shape', () => {
  test('prefixes the base URL and sends no auth headers without a provider', async () => {
    const api = createApiClient({ baseUrl: BASE });
    replyWith('{}', { status: 200 });

    await api.get('/companies');

    expect(urlOf()).toBe('https://api.test/companies');
    expect(headersOf()).not.toHaveProperty('Authorization');
  });

  test('attaches the injected bearer token', async () => {
    const api = createApiClient({ baseUrl: BASE, auth: async () => ({ token: 'tok-1' }) });
    replyWith('{}', { status: 200 });

    await api.get('/companies');

    expect(headersOf().Authorization).toBe('Bearer tok-1');
  });

  test('attaches X-Org-Id only when the provider supplies one', async () => {
    const withOrg = createApiClient({ baseUrl: BASE, auth: async () => ({ token: 't', orgId: 'org_1' }) });
    const withoutOrg = createApiClient({ baseUrl: BASE, auth: async () => ({ token: 't', orgId: null }) });
    replyWith('{}', { status: 200 });

    await withOrg.get('/companies');
    await withoutOrg.get('/companies');

    expect(headersOf(0)['X-Org-Id']).toBe('org_1');
    expect(headersOf(1)).not.toHaveProperty('X-Org-Id');
  });

  test('never sends auth headers on the public helpers, even with a provider configured', async () => {
    // The guest portal and the public verify page are unauthenticated BY
    // CONTRACT. Leaking a bearer token onto them would widen what an
    // unauthenticated URL can reach.
    const api = createApiClient({ baseUrl: BASE, auth: async () => ({ token: 't', orgId: 'org_1' }) });
    replyWith('{}', { status: 200 });

    await api.getPublic('/guest/reports?token=t');
    await api.postPublic('/invitations/accept', { token: 't' });

    expect(headersOf(0)).not.toHaveProperty('Authorization');
    expect(headersOf(0)).not.toHaveProperty('X-Org-Id');
    expect(headersOf(1)).not.toHaveProperty('Authorization');
    expect(headersOf(1)).not.toHaveProperty('X-Org-Id');
  });

  test('sends Content-Type and a JSON body only when there is a body', async () => {
    const api = createApiClient({ baseUrl: BASE });
    replyWith('{}', { status: 200 });

    await api.post('/companies', { name: 'Acme' });
    await api.del('/companies/1');

    expect(headersOf(0)['Content-Type']).toBe('application/json');
    expect(initOf(0).body).toBe('{"name":"Acme"}');
    expect(headersOf(1)).not.toHaveProperty('Content-Type');
    expect(initOf(1).body).toBeUndefined();
  });

  test('uses the HTTP method the helper names', async () => {
    const api = createApiClient({ baseUrl: BASE });
    replyWith('{}', { status: 200 });

    await api.post('/x');
    await api.put('/x');
    await api.patch('/x');
    await api.del('/x');

    expect([initOf(0).method, initOf(1).method, initOf(2).method, initOf(3).method])
      .toEqual(['POST', 'PUT', 'PATCH', 'DELETE']);
  });
});

describe('responses', () => {
  test('returns the parsed body', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'c1' }), { status: 200 }));

    await expect(api.get('/companies/c1')).resolves.toEqual({ id: 'c1' });
  });

  test('returns undefined on 204 and on an empty body', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await expect(api.del('/companies/c1')).resolves.toBeUndefined();
    await expect(api.get('/companies/c1')).resolves.toBeUndefined();
  });
});

describe('errors', () => {
  test('throws ApiError carrying the status, the path and the parsed body', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Gone', code: 'CONSUMED' }), { status: 410 }),
    );

    // 404 (unknown invite) vs 410 (consumed) drive different UI — the status
    // must survive, not collapse into a generic Error.
    const err = await api.getPublic('/invitations/abc').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 410,
      path: '/invitations/abc',
      message: 'Gone',
      body: { message: 'Gone', code: 'CONSUMED' },
    });
  });

  test('joins a validation-array message', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: ['name required', 'email invalid'] }), { status: 400 }),
    );

    await expect(api.post('/companies', {})).rejects.toThrow('name required, email invalid');
  });

  test('falls back to a generated message on a non-JSON error body', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    // A proxy's HTML error page must not surface as a JSON parse failure.
    const err = await api.get('/companies').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('API GET /companies failed: 502');
    expect(err.status).toBe(502);
  });

  test('names the method in the fallback message', async () => {
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));

    await expect(api.patch('/companies/c1', {})).rejects.toThrow('API PATCH /companies/c1 failed: 500');
  });

  test('a public POST throws ApiError too, not a bare Error', async () => {
    // wire-contract.md: the client throws ApiError, never a bare Error, so
    // every caller can branch on status.
    const api = createApiClient({ baseUrl: BASE });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'Expired' }), { status: 410 }));

    await expect(api.postPublic('/invitations/accept', {})).rejects.toBeInstanceOf(ApiError);
  });
});
