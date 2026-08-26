import { ApiError } from './errors';

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
}

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
    opts: { body?: unknown; authenticated: boolean },
  ): Promise<T> {
    const hasBody = opts.body !== undefined;
    const ctx: AuthContext = opts.authenticated && auth ? await auth() : {};
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

  return {
    get: (path) => send('GET', path, { authenticated: true }),
    post: (path, body) => send('POST', path, { body, authenticated: true }),
    put: (path, body) => send('PUT', path, { body, authenticated: true }),
    patch: (path, body) => send('PATCH', path, { body, authenticated: true }),
    del: (path, body) => send('DELETE', path, { body, authenticated: true }),
    getPublic: (path) => send('GET', path, { authenticated: false }),
    postPublic: (path, body) => send('POST', path, { body, authenticated: false }),
  };
}
