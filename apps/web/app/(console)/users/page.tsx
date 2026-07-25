import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { apiRoleAtLeast } from '@/lib/roles';
import { loadOrFallback, type ApiUser } from '@/lib/api';
import { PageHead, RoleBadge } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { UsersClient } from './users-client';

export const dynamic = 'force-dynamic';

const DEMO_USERS: ApiUser[] = [
  { id: 'demo-u1', name: 'Riya Saraf', email: 'riya@asha-inspect.com', role: 'ORG_OWNER', status: 'ACTIVE', lastLoginAt: new Date(Date.now() - 720000).toISOString() },
  { id: 'demo-u2', name: 'Aisha Khan', email: 'aisha@asha-inspect.com', role: 'QA_MANAGER', status: 'ACTIVE', lastLoginAt: new Date(Date.now() - 3600000).toISOString() },
  { id: 'demo-u3', name: 'Deepak Menon', email: 'deepak@asha-inspect.com', role: 'INSPECTOR', status: 'ACTIVE', lastLoginAt: new Date(Date.now() - 14400000).toISOString() },
  { id: 'demo-u4', name: 'Meera Nair', email: 'meera@asha-inspect.com', role: 'INSPECTOR', status: 'INVITED', lastLoginAt: null },
];

type RoleKey = 'inspector' | 'qa' | 'owner';
const ROLE_KEY: Record<string, RoleKey> = {
  INSPECTOR: 'inspector', QA_MANAGER: 'qa', ORG_OWNER: 'owner',
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = (await auth()) as unknown as { user?: { id?: string }; role?: string } | null;
  // Web-side UX gate only (INS-065 relaxed GET /users to QA_MANAGER for the
  // create-inspection dropdown) — every management route here still floors at
  // ORG_OWNER, so anything below that role gets redirected before it can load
  // a screen full of controls that would 403.
  if (!apiRoleAtLeast(session?.role, 'ORG_OWNER')) redirect('/dashboard');
  const currentUserId = session?.user?.id;

  // Server-side search (INS-050) — the client keeps its instant filter for the loaded page.
  const path = q ? `/users?q=${encodeURIComponent(q)}` : '/users';
  const { data: users, live } = await loadOrFallback<ApiUser[]>(path, DEMO_USERS);

  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title="Users & roles"
        sub="Roles are additive — Org Owner includes QA Manager, which includes Inspector."
      />

      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {([
          ['inspector', 'Populate & view their inspections'],
          ['qa', 'Inspector + make binding Pass / Fail / Hold'],
          ['owner', 'QA + manage users, buyers, suppliers'],
        ] as [RoleKey, string][]).map(([r, desc]) => (
          <div key={r} style={{ flex: '1 1 240px', display: 'flex', gap: 10, alignItems: 'flex-start', padding: 14, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10 }}>
            <RoleBadge role={r} />
            <span style={{ fontSize: 12, color: ui.sub, lineHeight: 1.45 }}>{desc}</span>
          </div>
        ))}
      </div>

      <UsersClient users={users} live={live} currentUserId={currentUserId} />
    </div>
  );
}
