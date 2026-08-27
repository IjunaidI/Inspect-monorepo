import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import {
  createApiClient,
  decodeJwtExp,
  DEFAULT_ACCESS_TTL_MS,
  type MeResult,
  type RefreshedTokens,
} from '@inspect/api-client';

const API_URL = process.env.INSPECT_API_URL ?? 'http://localhost:3000';

/**
 * A BARE client — no auth provider (INS-088).
 *
 * This is deliberately a second instance rather than the one in `lib/api.ts`.
 * That one injects a provider built on `next/headers`, and **this module is
 * pulled into the edge runtime by `middleware.ts`**, where `next/headers` is
 * unavailable. A provider would also be useless here: login and refresh are
 * what produce the credentials a provider would read.
 */
const client = createApiClient({ baseUrl: API_URL });

/** Kept as an alias so existing imports of this name are untouched. */
export type RefreshedApiTokens = RefreshedTokens;

/**
 * Exchange a refresh token for a fresh API access token. Exported because the
 * server-side API layer performs the same rotation: since INS-045 the bearer
 * token is no longer projected onto the session object, so lib/api.ts reads the
 * encrypted NextAuth JWT directly and must be able to renew an expired token
 * itself rather than relying on this module's `jwt` callback having run.
 * Returns null when the API rejects the refresh (caller decides the fallback).
 *
 * INS-088: the exchange itself now lives in `@inspect/api-client`, so mobile
 * uses the same one. This wrapper keeps the console's name for it.
 */
export function refreshApiAccessToken(refreshToken: unknown): Promise<RefreshedApiTokens | null> {
  return client.refresh(refreshToken);
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
          const { accessToken, refreshToken } = await client.login(email, password);
          // A failing /auth/me must NOT fail the login — the session still has
          // a valid token pair, it just lands without role/org decoration.
          const me: MeResult = await client.me(accessToken).catch(() => ({}));
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
            accessTokenExpires: decodeJwtExp(accessToken) ?? (Date.now() + DEFAULT_ACCESS_TTL_MS),
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
          accessTokenExpires: (u.accessTokenExpires as number | undefined) ?? (Date.now() + DEFAULT_ACCESS_TTL_MS),
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
