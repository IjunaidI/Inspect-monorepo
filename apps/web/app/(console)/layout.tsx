import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ConsoleShell } from '@/components/inspect/shell';
import { apiRoleToRoleKey } from '@/lib/roles';
import { getAssumedOrg } from '@/lib/admin-org';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = (await auth()) as unknown as {
    user?: { email?: string | null; name?: string | null };
    role?: string;
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
  let assumedOrgName: string | null = null;
  if (session.role === 'PLATFORM_ADMIN') {
    const assumed = await getAssumedOrg();
    if (assumed) {
      assumedOrgName = assumed.name;
    }
  }

  const userName = session.user?.name || session.user?.email || 'User';
  return (
    <ConsoleShell
      userName={userName}
      role={apiRoleToRoleKey(session.role)}
      org={assumedOrgName ?? (session.role === 'PLATFORM_ADMIN' ? 'Platform administration' : undefined)}
      assumedOrgName={assumedOrgName}
    >
      {children}
    </ConsoleShell>
  );
}
