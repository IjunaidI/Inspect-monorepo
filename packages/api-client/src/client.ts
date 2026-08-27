import { ApiError } from './errors';
import {
  DEFAULT_ACCESS_TTL_MS,
  decodeJwtExp,
  type LoginResult,
  type MeResult,
  type RefreshedTokens,
} from './auth';

/**
 * What the host application knows about the caller at request time.
 *
 * Both values are resolved TOGETHER by one provider call on purpose: on web
 * they come from a single decryption of the NextAuth JWE cookie, and splitting
 * them into two hooks would double that work on every request.
 */
export interface AuthContext {
  token?: string | null;
  /** Platform-Admin org assumption (INS-079). Omitted for every other caller. */
  orgId?: string | null;
}

export type AuthProvider = () => Promise<AuthContext>;

export interface ApiClientOptions {
  /** Origin of the Inspect API, with no trailing slash. */
  baseUrl: string;
  /**
   * Resolves the caller's credentials. Injected, never read from the
   * environment: web supplies a NextAuth-cookie reader that keeps the token
   * server-side (INS-045), mobile a SecureStore-backed one. The client itself
   * must never touch a cookie, `next/headers` or `expo-secure-store`.
   */
  auth?: AuthProvider;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string, body?: unknown): Promise<T>;
  /** Unauthenticated GET — guest portal, public verify, invitation lookup. */
  getPublic<T>(path: string): Promise<T>;
  /** Unauthenticated POST — accept invitation. */
  postPublic<T>(path: string, body?: unknown): Promise<T>;

  // ── The credential exchange (INS-088) ──────────────────────────────────────
  // Outside the auth provider by nature: these are what produce credentials.

  /** Exchange credentials for a token pair. Throws `ApiError` 401 when refused. */
  login(email: string, password: string): Promise<LoginResult>;
  /**
   * Identity for `token`. Takes the token EXPLICITLY rather than reading the
   * provider, because the only caller runs mid-login, before a session exists.
   */
  me(token: string): Promise<MeResult>;
  /**
   * Exchange a refresh token for a fresh pair, with the expiry decoded from the
   * new access token.
   *
   * Returns null instead of throwing — the deliberate exception to this
   * package's throw-`ApiError` rule. Every caller's fallback is to carry on
   * with the stale token and let the next request answer 401; turning an
   * expired session into a thrown error would crash a render instead. Accepts
   * `unknown` because the value comes off a decoded session blob.
   */
  refresh(refreshToken: unknown): Promise<RefreshedTokens | null>;
}

/**
 * Which credentials a request carries. `'provider'` asks the injected provider,
 * `'none'` sends none (public endpoints, and login), and an explicit `token`
 * covers the mid-login `me` call where no session exists yet.
 */
type AuthMode = 'provider' | 'none' | { token: string };

/** The API's error message: a string, a validation array, or '' when absent. */
function messageFrom(body: unknown): string {
  const m = (body as { message?: unknown } | null)?.message;
  return Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : '';
}

/**
 * Tolerant body decode. A 204 and an empty 200 both mean "no content" — the
 * write paths have always relied on this, and reads get it too so a no-content
 * response is a value rather than a JSON parse crash.
 */
async function decode<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

export function createApiClient({ baseUrl, auth }: ApiClientOptions): ApiClient {
  async function send<T>(
    method: string,
    path: string,
    opts: { body?: unknown; auth: AuthMode },
  ): Promise<T> {
    const hasBody = opts.body !== undefined;
    const ctx: AuthContext =
      opts.auth === 'none'
        ? {}
        : opts.auth === 'provider'
          ? auth
            ? await auth()
            : {}
          : { token: opts.auth.token };
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
        ...(ctx.orgId ? { 'X-Org-Id': ctx.orgId } : {}),
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      // Live data always. Next honours this; React Native ignores it harmlessly.
      cache: 'no-store',
    });

    if (!res.ok) {
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        /* non-JSON error body — a proxy's HTML page, or nothing at all */
      }
      throw new ApiError(
        res.status,
        path,
        messageFrom(parsed) || `API ${method} ${path} failed: ${res.status}`,
        parsed,
      );
    }
    return decode<T>(res);
  }

  async function refresh(refreshToken: unknown): Promise<RefreshedTokens | null> {
    if (typeof refreshToken !== 'string' || !refreshToken) return null;
    try {
      const issued = await send<{ accessToken?: string; refreshToken?: string }>(
        'POST',
        '/auth/refresh',
        { body: { refreshToken }, auth: 'none' },
      );
      if (!issued?.accessToken) return null;
      return {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken ?? refreshToken,
        accessTokenExpires:
          decodeJwtExp(issued.accessToken) ?? Date.now() + DEFAULT_ACCESS_TTL_MS,
      };
    } catch {
      // Both an ApiError (the API refused) and a network TypeError land here.
      // The caller carries on with the stale token; see the interface doc.
      return null;
    }
  }

  return {
    get: (path) => send('GET', path, { auth: 'provider' }),
    post: (path, body) => send('POST', path, { body, auth: 'provider' }),
    put: (path, body) => send('PUT', path, { body, auth: 'provider' }),
    patch: (path, body) => send('PATCH', path, { body, auth: 'provider' }),
    del: (path, body) => send('DELETE', path, { body, auth: 'provider' }),
    getPublic: (path) => send('GET', path, { auth: 'none' }),
    postPublic: (path, body) => send('POST', path, { body, auth: 'none' }),
    login: (email, password) =>
      send('POST', '/auth/login', { body: { email, password }, auth: 'none' }),
    me: (token) => send('GET', '/auth/me', { auth: { token } }),
    refresh,
  };
}
