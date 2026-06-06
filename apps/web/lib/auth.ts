import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

const API_URL = process.env.INSPECT_API_URL ?? 'http://localhost:3000';

/**
 * The NestJS API is the RBAC authority (spec §13). NextAuth uses a Credentials
 * provider that delegates to the API's POST /auth/login, then stores the issued
 * access/refresh JWTs (plus role + orgId) in the session for API calls.
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
          const { accessToken, refreshToken } = await res.json();
          const meRes = await fetch(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const me = meRes.ok ? await meRes.json() : {};
          return {
            id: me.userId ?? email,
            email,
            accessToken,
            refreshToken,
            role: me.role,
            orgId: me.orgId ?? null
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
        token.accessToken = u.accessToken;
        token.refreshToken = u.refreshToken;
        token.role = u.role;
        token.orgId = u.orgId;
      }
      return token;
    },
    session: async ({ session, token }) => {
      const s = session as unknown as Record<string, unknown>;
      s.accessToken = token.accessToken;
      s.role = token.role;
      s.orgId = token.orgId;
      return session;
    }
  }
});
