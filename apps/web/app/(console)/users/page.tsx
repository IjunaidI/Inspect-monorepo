import type { CSSProperties } from 'react';
import { ChevronDown, Lock, MoreVertical, Plus, Search } from 'lucide-react';
import { Avatar, Btn, Mono, PageHead, RoleBadge } from '@/components/inspect/shell';
import { severity, ui, type RoleKey } from '@/components/inspect/tokens';
import { loadOrFallback, type ApiUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

type StatusKey = 'active' | 'invited' | 'crosstenant';
interface UserRow { initials: string; bg: string; name: string; email: string; role: RoleKey; status: StatusKey; last: string; you?: boolean }

const DEMO_USERS: UserRow[] = [
  { initials: 'RS', bg: '#0B1220', name: 'Riya Saraf', email: 'riya@asha-inspect.com', role: 'owner', status: 'active', last: '12 min ago', you: true },
  { initials: 'AK', bg: '#1457A3', name: 'Aisha Khan', email: 'aisha@asha-inspect.com', role: 'qa', status: 'active', last: '1 hour ago' },
  { initials: 'DM', bg: '#0B7D6B', name: 'Deepak Menon', email: 'deepak@asha-inspect.com', role: 'inspector', status: 'active', last: '4 hours ago' },
  { initials: 'TA', bg: '#7C3AED', name: 'Tomás Alvarez', email: 'tomas@asha-inspect.com', role: 'qa', status: 'active', last: 'Yesterday' },
  { initials: 'MN', bg: '#B5791A', name: 'Meera Nair', email: 'meera@asha-inspect.com', role: 'inspector', status: 'invited', last: 'Invite sent 2d ago' },
  { initials: 'IP', bg: '#475467', name: 'Inspect Support', email: 'support@inspect.io', role: 'platform', status: 'crosstenant', last: '—' },
];

const statusStyle: Record<StatusKey, { label: string; fg: string; bg: string; dot: string }> = {
  active: { label: 'Active', fg: '#1F6B43', bg: '#EAF6F0', dot: '#1F8A4C' },
  invited: { label: 'Invited', fg: severity.major.fg, bg: severity.major.bg, dot: severity.major.dot },
  crosstenant: { label: 'Cross-tenant', fg: '#475467', bg: '#EFF2F6', dot: '#8A93A1' },
};
const BG_PALETTE = ['#0B1220', '#1457A3', '#0B7D6B', '#7C3AED', '#B5791A', '#475467'];
const ROLE_MAP: Record<ApiUser['role'], RoleKey> = { INSPECTOR: 'inspector', QA_MANAGER: 'qa', ORG_OWNER: 'owner', PLATFORM_ADMIN: 'platform' };

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '??';
}
function mapUser(u: ApiUser, i: number): UserRow {
  return {
    initials: initialsOf(u.name || u.email),
    bg: BG_PALETTE[i % BG_PALETTE.length],
    name: u.name || u.email,
    email: u.email,
    role: ROLE_MAP[u.role] ?? 'inspector',
    status: u.status === 'ACTIVE' ? 'active' : u.status === 'INVITED' ? 'invited' : 'crosstenant',
    last: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—',
  };
}

const th: CSSProperties = { fontSize: 11, fontWeight: 550, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, padding: '13px 20px', textAlign: 'left', borderBottom: `1px solid ${ui.line}`, background: ui.fill };
const td: CSSProperties = { padding: '14px 20px', fontSize: 13, color: ui.ink, borderBottom: `1px solid ${ui.lineSoft}`, verticalAlign: 'middle' };

export default async function UsersPage() {
  const { data, live } = await loadOrFallback<ApiUser[]>('/users', []);
  const rows: UserRow[] = live ? data.map(mapUser) : DEMO_USERS;

  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title="Users & roles"
        sub="Roles are additive — Org Owner includes QA Manager, which includes Inspector. Onboarding is invite-only."
        actions={<Btn kind="primary" icon={<Plus size={15} />}>Invite user</Btn>}
      />

      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {([
          ['inspector', 'Populate & view their inspections'],
          ['qa', 'Inspector + make binding Pass / Fail / Hold'],
          ['owner', 'QA + manage users, buyers, suppliers'],
          ['platform', 'Cross-tenant · the only role that can upload photos'],
        ] as [RoleKey, string][]).map(([r, desc]) => (
          <div key={r} style={{ flex: '1 1 240px', display: 'flex', gap: 10, alignItems: 'flex-start', padding: 14, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10 }}>
            <RoleBadge role={r} />
            <span style={{ fontSize: 12, color: ui.sub, lineHeight: 1.45 }}>{desc}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0 14px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={15} color={ui.faint} style={{ position: 'absolute', left: 12, top: 10.5 }} />
          <input style={{ width: 320, height: 36, padding: '0 12px 0 36px', fontSize: 13, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none' }} placeholder="Search by name or email…" />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11.5, color: ui.faint }}>{live ? 'Live · from API' : 'Demo data · API offline'}</div>
      </div>

      <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>User</th>
              <th style={th}>Role</th>
              <th style={th}>Status</th>
              <th style={th}>Last active</th>
              <th style={{ ...th, width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const ss = statusStyle[u.status];
              const locked = u.role === 'platform';
              return (
                <tr key={u.email}>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <Avatar initials={u.initials} size={34} bg={u.bg} />
                      <div>
                        <div style={{ fontWeight: 550, display: 'flex', alignItems: 'center', gap: 7 }}>
                          {u.name}
                          {u.you && <span style={{ fontSize: 10.5, color: ui.faint, fontWeight: 500, border: `1px solid ${ui.line}`, borderRadius: 4, padding: '0 5px' }}>You</span>}
                        </div>
                        <Mono style={{ color: ui.faint, fontSize: 12, marginTop: 2 }}>{u.email}</Mono>
                      </div>
                    </div>
                  </td>
                  <td style={td}>
                    {locked ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <RoleBadge role={u.role} />
                        <Lock size={13} color={ui.faint} />
                      </div>
                    ) : (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px', border: `1px solid ${ui.line}`, borderRadius: 8, background: '#fff', cursor: 'pointer' }}>
                        <RoleBadge role={u.role} />
                        <ChevronDown size={14} color={ui.faint} />
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: ss.fg, fontWeight: 500 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: ss.dot }} /> {ss.label}
                    </span>
                  </td>
                  <td style={{ ...td, color: ui.sub }}>{u.last}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {!u.you && (
                      <div style={{ display: 'inline-flex', width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center', color: ui.faint }}>
                        <MoreVertical size={16} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
