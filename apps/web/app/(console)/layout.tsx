import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ConsoleShell } from '@/components/inspect/shell';
import { apiRoleToRoleKey } from '@/lib/roles';
import { getAssumedOrgId } from '@/lib/admin-org';
import { apiGet, type ApiOrganization } from '@/lib/api';

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

  // INS-079: resolve the assumed org's NAME for the banner. Never fail the whole
  // console over it — an unresolvable id still renders the banner (with the id),
  // because hiding the fact that an org is assumed is the dangerous failure.
  let assumedOrgName: string | null = null;
  if (session.role === 'PLATFORM_ADMIN') {
    const assumedId = await getAssumedOrgId();
    if (assumedId) {
      const orgs = await apiGet<ApiOrganization[]>('/admin/orgs').catch(() => [] as ApiOrganization[]);
      assumedOrgName = orgs.find((o) => o.id === assumedId)?.name ?? assumedId;
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
