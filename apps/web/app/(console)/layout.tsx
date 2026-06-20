import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ConsoleShell } from '@/components/inspect/shell';
import { apiRoleToRoleKey } from '@/lib/roles';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = (await auth()) as unknown as {
    user?: { email?: string | null; name?: string | null };
    role?: string;
  } | null;
  if (!session) redirect('/login');
  const userName = session.user?.name || session.user?.email || 'User';
  return (
    <ConsoleShell userName={userName} role={apiRoleToRoleKey(session.role)}>
      {children}
    </ConsoleShell>
  );
}
