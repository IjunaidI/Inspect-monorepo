import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

const API_URL = process.env.INSPECT_API_URL ?? 'http://localhost:3000';

function decodeJwtExp(token: string): number | null {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString()) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export interface RefreshedApiTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpires: number;
}

/**
 * Exchange a refresh token for a fresh API access token. Exported because the
 * server-side API layer performs the same rotation: since INS-045 the bearer
 * token is no longer projected onto the session object, so lib/api.ts reads the
 * encrypted NextAuth JWT directly and must be able to renew an expired token
 * itself rather than relying on this module's `jwt` callback having run.
 * Returns null when the API rejects the refresh (caller decides the fallback).
 * Deliberately free of `next/headers` — middleware.ts imports this module and
 * runs on the edge runtime.
 */
export async function refreshApiAccessToken(refreshToken: unknown): Promise<RefreshedApiTokens | null> {
  if (typeof refreshToken !== 'string' || !refreshToken) return null;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const issued = (await res.json()) as { accessToken?: string; refreshToken?: string };
    if (!issued?.accessToken) return null;
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken ?? refreshToken,
      accessTokenExpires: decodeJwtExp(issued.accessToken) ?? (Date.now() + 15 * 60 * 1000),
    };
  } catch {
    return null;
  }
}

async function refreshAccessToken(token: Record<string, unknown>) {
  const refreshed = await refreshApiAccessToken(token.refreshToken);
  if (!refreshed) return { ...token, error: 'RefreshAccessTokenError' as const };
  return { ...token, ...refreshed, error: undefined };
}

/**
 * The NestJS API is the RBAC authority (spec §13). NextAuth uses a Credentials
 * provider that delegates to the API's POST /auth/login, then keeps the issued
 * access/refresh JWTs inside the *encrypted* NextAuth cookie.
 *
 * INS-045: those API tokens are deliberately NOT copied onto the session object.
 * NextAuth serves the session object to the browser at GET /api/auth/session, so
 * anything placed there is readable by client-side JS — and the bearer token is
 * only ever used server-side (lib/api.ts), which makes exposing it pure downside.
 * The session therefore carries identity only: user, role, orgId, orgName.
 * lib/api.ts reads the token out of the encrypted cookie via `getToken`.
 *
 * The jwt callback tracks token expiry and auto-refreshes; on failure it sets
 * error='RefreshAccessTokenError', which the console layout catches to force sign-out.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;
        try {
          const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password })
          });
          if (!res.ok) return null;
          const { accessToken, refreshToken } = await res.json() as { accessToken: string; refreshToken: string };
          const meRes = await fetch(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const me = meRes.ok ? await meRes.json() as Record<string, unknown> : {};
          return {
            id: (me.userId as string) ?? email,
            email,
            accessToken,
            refreshToken,
            role: me.role,
            orgId: me.orgId ?? null,
            // INS-080: GET /auth/me resolves the real workspace name (null for the
            // cross-tenant Platform Admin). Carried through so the console shell can
            // show it instead of falling through to the design-demo constant.
            orgName: (me.orgName as string | null) ?? null,
            accessTokenExpires: decodeJwtExp(accessToken) ?? (Date.now() + 15 * 60 * 1000),
          } as never;
        } catch {
          return null;
        }
      }
    })
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        const u = user as unknown as Record<string, unknown>;
        return {
          ...token,
          userId: u.id,
          accessToken: u.accessToken,
          refreshToken: u.refreshToken,
          role: u.role,
          orgId: u.orgId,
          orgName: u.orgName ?? null,
          accessTokenExpires: (u.accessTokenExpires as number | undefined) ?? (Date.now() + 15 * 60 * 1000),
          error: undefined,
        };
      }

      // Token still valid (60s buffer to avoid race on page load)
      if (Date.now() < ((token.accessTokenExpires as number | undefined) ?? 0) - 60_000) {
        return token;
      }

      // Access token expired — try to refresh
      return refreshAccessToken(token as Record<string, unknown>);
    },
    session: async ({ session, token }) => {
      const s = session as unknown as Record<string, unknown>;
      // INS-045: NEVER put accessToken/refreshToken here — this object is what
      // GET /api/auth/session hands to the browser. Server code gets the bearer
      // token from the encrypted JWT instead (lib/api.ts#readSessionJwt).
      s.role = token.role;
      s.orgId = token.orgId;
      // INS-080: the caller's real org name, for the console shell.
      s.orgName = token.orgName ?? null;
      // Project the API user id explicitly (RowActions gates the assigned
      // inspector's Start/Reset on it) instead of relying on Auth.js's implicit
      // token.sub -> session.user.id default.
      if (session.user) {
        (session.user as { id?: string }).id =
          (token.userId as string | undefined) ?? (token.sub as string | undefined);
      }
      if (token.error) s.error = token.error;
      return session;
    }
  }
});
