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

async function refreshAccessToken(token: Record<string, unknown>) {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token.refreshToken }),
    });
    if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
    const { accessToken, refreshToken } = (await res.json()) as { accessToken: string; refreshToken?: string };
    return {
      ...token,
      accessToken,
      refreshToken: refreshToken ?? token.refreshToken,
      accessTokenExpires: decodeJwtExp(accessToken) ?? (Date.now() + 15 * 60 * 1000),
      error: undefined,
    };
  } catch {
    return { ...token, error: 'RefreshAccessTokenError' as const };
  }
}

/**
 * The NestJS API is the RBAC authority (spec §13). NextAuth uses a Credentials
 * provider that delegates to the API's POST /auth/login, then stores the issued
 * access/refresh JWTs (plus role + orgId) in the session for API calls.
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
          accessToken: u.accessToken,
          refreshToken: u.refreshToken,
          role: u.role,
          orgId: u.orgId,
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
      s.accessToken = token.accessToken;
      s.role = token.role;
      s.orgId = token.orgId;
      if (token.error) s.error = token.error;
      return session;
    }
  }
});
