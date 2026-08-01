import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ConsoleShell } from '@/components/inspect/shell';
import { apiRoleToRoleKey } from '@/lib/roles';
import { getAssumedOrg } from '@/lib/admin-org';
import { apiGet } from '@/lib/api';

/**
 * INS-080 safety net: sessions minted before orgName was carried (and logins
 * where GET /auth/me was unreachable) have no name in the token. Re-resolve it
 * once, server-side, rather than letting the shell fall through to the demo
 * constant. Never fails the console — an unreachable API just means design-demo
 * mode, which is exactly when the fallback name is legitimate.
 */
async function fetchOrgName(): Promise<string | null> {
  try {
    const me = await apiGet<{ orgName?: string | null }>('/auth/me');
    return me.orgName ?? null;
  } catch {
    return null;
  }
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = (await auth()) as unknown as {
    user?: { email?: string | null; name?: string | null };
    role?: string;
    orgName?: string | null;
    error?: string;
  } | null;

  if (!session) redirect('/login');

  // jwt callback sets this when the access token has expired and the refresh token
  // is also invalid. Redirect to /logout so a Client Component can call signOut()
  // (cookie mutation requires client or Server Action context, not a layout render).
  if (session.error === 'RefreshAccessTokenError') {
    redirect('/logout?expired=1');
  }

  // INS-079: resolve the assumed org's NAME for the banner. The name is captured
  // once at enter time (see admin/actions.ts#enterOrg) and stored alongside the id
  // in the cookie, so this is a cookie read, not a fetch, on every console render.
  // Never fail the whole console over it — an unresolvable id still renders the
  // banner (falling back to the raw id), because hiding the fact that an org is
  // assumed is the dangerous failure. Note the stored name is display-only and may
  // go stale if the org is renamed after entry; the id remains the authority.
  const isPlatformAdmin = session.role === 'PLATFORM_ADMIN';

  let assumedOrgName: string | null = null;
  if (isPlatformAdmin) {
    const assumed = await getAssumedOrg();
    if (assumed) {
      assumedOrgName = assumed.name;
    }
  }

  // INS-080: the workspace name in the sidebar/topbar. A Platform Admin has no
  // org of its own, so it shows the assumed org (or the admin label); every other
  // role shows its REAL org name, carried on the session from GET /auth/me at
  // login. `undefined` here is what makes the shell fall back to its design-demo
  // constant, so only leave it undefined when the name is genuinely unresolvable.
  const orgName = isPlatformAdmin
    ? (assumedOrgName ?? 'Platform administration')
    : (session.orgName ?? (await fetchOrgName()));

  const userName = session.user?.name || session.user?.email || 'User';
  return (
    <ConsoleShell
      userName={userName}
      role={apiRoleToRoleKey(session.role)}
      org={orgName ?? undefined}
      assumedOrgName={assumedOrgName}
    >
      {children}
    </ConsoleShell>
  );
}
