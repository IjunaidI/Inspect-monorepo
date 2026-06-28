import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ConsoleShell } from '@/components/inspect/shell';
import { apiRoleToRoleKey } from '@/lib/roles';

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

  const userName = session.user?.name || session.user?.email || 'User';
  return (
    <ConsoleShell userName={userName} role={apiRoleToRoleKey(session.role)}>
      {children}
    </ConsoleShell>
  );
}
