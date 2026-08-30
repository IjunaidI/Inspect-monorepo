'use client';

import { useActionState, useTransition, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Copy, Check, Plus, Search, MoreVertical } from 'lucide-react';
import { Avatar, Mono, RoleBadge } from '@/components/inspect/shell';
import { Spinner } from '@/components/inspect/loading';
import { severity, ui, type RoleKey } from '@/components/inspect/tokens';
import type { ApiUser } from '@/lib/api';
import { addMember, deactivateUser, inviteUser, reactivateUser, updateUserRole } from './actions';

type StatusKey = 'active' | 'invited' | 'deactivated' | 'suspended';
const statusStyle: Record<StatusKey, { label: string; fg: string; bg: string; dot: string }> = {
  active: { label: 'Active', fg: '#1F6B43', bg: '#EAF6F0', dot: '#1F8A4C' },
  invited: { label: 'Invited', fg: severity.major.fg, bg: severity.major.bg, dot: severity.major.dot },
  deactivated: { label: 'Deactivated', fg: '#475467', bg: '#EFF2F6', dot: '#8A93A1' },
  suspended: { label: 'Suspended', fg: severity.major.fg, bg: severity.major.bg, dot: severity.major.dot },
};
const BG_PALETTE = ['#0B1220', '#1457A3', '#0B7D6B', '#7C3AED', '#B5791A', '#475467'];
const ROLE_MAP: Partial<Record<ApiUser['role'], RoleKey>> = {
  INSPECTOR: 'inspector', QA_MANAGER: 'qa', ORG_OWNER: 'owner',
};

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '??';
}

interface UserRow { id: string; initials: string; bg: string; name: string; email: string; role: RoleKey; apiRole: ApiUser['role']; status: StatusKey; last: string; you?: boolean }

// Pinned locale (same as the dashboard's DATE_FMT): a bare toLocaleDateString()
// differs between the server's locale and the browser's, which is a hydration
// mismatch — the whole tree re-renders on the client.
const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function mapUser(u: ApiUser, i: number): UserRow {
  return {
    id: u.id,
    initials: initialsOf(u.name || u.email),
    bg: BG_PALETTE[i % BG_PALETTE.length],
    name: u.name || u.email,
    email: u.email,
    role: ROLE_MAP[u.role] ?? 'inspector',
    apiRole: u.role,
    status:
      u.status === 'ACTIVE' ? 'active'
      : u.status === 'INVITED' ? 'invited'
      : u.status === 'SUSPENDED' ? 'suspended'
      : 'deactivated',
    last: u.lastLoginAt ? DATE_FMT.format(new Date(u.lastLoginAt)) : '—',
  };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px', border: `1px solid ${ui.line}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: copied ? '#16A34A' : ui.sub, fontFamily: 'inherit' }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

function RoleRow({ row, currentUserRole }: { row: UserRow; currentUserRole: RoleKey }) {
  const [pending, start] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deactivating, startDeactivate] = useTransition();
  // Controlled so a server-rejected role change (e.g. INS-058's last-active-owner
  // 400) can be visibly reverted instead of leaving the rejected role displayed.
  const [role, setRole] = useState<string>(row.apiRole);
  const ss = statusStyle[row.status];

  const th = { fontSize: 11, fontWeight: 550, color: ui.sub, textTransform: 'uppercase' as const, letterSpacing: 0.4, padding: '13px 20px', textAlign: 'left' as const, borderBottom: `1px solid ${ui.line}`, background: ui.fill };
  const td = { padding: '14px 20px', fontSize: 13, color: ui.ink, borderBottom: `1px solid ${ui.lineSoft}`, verticalAlign: 'middle' as const };

  return (
    <tr key={row.email}>
      <td style={td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <Avatar initials={row.initials} size={34} bg={row.bg} />
          <div>
            <div style={{ fontWeight: 550, display: 'flex', alignItems: 'center', gap: 7 }}>
              {row.name}
              {row.you && <span style={{ fontSize: 10.5, color: ui.faint, fontWeight: 500, border: `1px solid ${ui.line}`, borderRadius: 4, padding: '0 5px' }}>You</span>}
            </div>
            <Mono style={{ color: ui.faint, fontSize: 12, marginTop: 2 }}>{row.email}</Mono>
          </div>
        </div>
      </td>
      <td style={td}>
        <select
          value={role}
          disabled={pending || row.you || row.status === 'deactivated'}
          onChange={(e) => {
            const next = e.target.value;
            setRole(next);
            start(async () => {
              const r = await updateUserRole(row.id, next);
              if (r.error) {
                alert(r.error);
                setRole(row.apiRole);
              }
            });
          }}
          style={{ height: 32, padding: '0 8px', fontSize: 12.5, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, background: '#fff', cursor: (row.you || row.status === 'deactivated') ? 'default' : 'pointer', opacity: pending ? 0.6 : row.status === 'deactivated' ? 0.55 : 1 }}
        >
          <option value="INSPECTOR">Inspector</option>
          <option value="QA_MANAGER">QA Manager</option>
          <option value="ORG_OWNER">Org Owner</option>
        </select>
      </td>
      <td style={td}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: ss.fg, fontWeight: 500 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: ss.dot }} /> {ss.label}
        </span>
      </td>
      <td style={{ ...td, color: ui.sub }}>{row.last}</td>
      <td style={{ ...td, textAlign: 'right' }}>
        {!row.you && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ui.faint, background: 'transparent', borderWidth: 0, cursor: 'pointer' }}
            >
              <MoreVertical size={16} />
            </button>
            {menuOpen && (
              <div style={{ position: 'absolute', right: 0, top: 32, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 50, minWidth: 160, overflow: 'hidden' }}>
                {row.status === 'deactivated' ? (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      startDeactivate(async () => {
                        const r = await reactivateUser(row.id);
                        if (r.error) alert(r.error);
                      });
                    }}
                    disabled={deactivating}
                    style={{ display: 'block', width: '100%', padding: '10px 14px', fontSize: 13, color: ui.accent, background: 'transparent', borderWidth: 0, fontFamily: 'inherit', textAlign: 'left', cursor: deactivating ? 'default' : 'pointer', opacity: deactivating ? 0.6 : 1 }}
                  >
                    Reactivate
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      startDeactivate(async () => {
                        const r = await deactivateUser(row.id);
                        if (r.error) alert(r.error);
                      });
                    }}
                    disabled={deactivating}
                    style={{ display: 'block', width: '100%', padding: '10px 14px', fontSize: 13, color: ui.danger, background: 'transparent', borderWidth: 0, fontFamily: 'inherit', textAlign: 'left', cursor: deactivating ? 'default' : 'pointer', opacity: deactivating ? 0.6 : 1 }}
                  >
                    Deactivate
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function UsersClient({ users, live, currentUserId }: { users: ApiUser[]; live: boolean; currentUserId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const serverQuery = searchParams.get('q') ?? '';
  const [search, setSearch] = useState(serverQuery);
  const [showInvite, setShowInvite] = useState(false);
  const [state, action, pending] = useActionState(inviteUser, {});
  const [mode, setMode] = useState<'direct' | 'invite'>('direct');
  const [addState, addAction, addPending] = useActionState(addMember, {} as { error?: string; data?: { email: string } });
  const addFormRef = useRef<HTMLFormElement>(null);
  const [addedEmail, setAddedEmail] = useState<string | null>(null);

  // Clear the inputs after a successful add so the SAME form can be reused.
  // Previously the form was unmounted and replaced by the success message, and
  // useActionState keeps `data` set until the next action — with no form left to
  // submit, a second add was impossible without a full page reload. The member
  // list itself is refetched by the revalidatePath('/users') in addMember.
  useEffect(() => {
    if (!addState.data) return;
    setAddedEmail(addState.data.email);
    addFormRef.current?.reset();
  }, [addState.data]);

  const rows = users.map((u, i) => ({ ...mapUser(u, i), you: u.id === currentUserId }));
  const filtered = rows.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.email.toLowerCase().includes(search.toLowerCase()),
  );

  const th = { fontSize: 11, fontWeight: 550, color: ui.sub, textTransform: 'uppercase' as const, letterSpacing: 0.4, padding: '13px 20px', textAlign: 'left' as const, borderBottom: `1px solid ${ui.line}`, background: ui.fill };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0 14px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={15} color={ui.faint} style={{ position: 'absolute', left: 12, top: 10.5 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Enter pushes the term server-side (INS-050); typing keeps the instant filter.
              if (e.key === 'Enter') {
                const q = search.trim();
                router.push(q ? `/users?q=${encodeURIComponent(q)}` : '/users');
              }
            }}
            style={{ width: 320, height: 36, padding: '0 12px 0 36px', fontSize: 13, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none' }}
            placeholder="Search by name or email…"
          />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11.5, color: ui.faint }}>{live ? 'Live · from API' : 'Demo data · API offline'}</span>
          <button
            onClick={() => setShowInvite(!showInvite)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', borderRadius: 8, fontWeight: 550, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', background: ui.accent, color: '#fff', borderWidth: 0 }}
          >
            <Plus size={15} /> Add member
          </button>
        </div>
      </div>

      {/* Inline add-member panel */}
      {showInvite && (
        <div style={{ background: ui.accentSoft, border: `1px solid #CFE5FD`, borderRadius: 10, padding: '18px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Add a team member</div>
            <button onClick={() => setShowInvite(false)} style={{ marginLeft: 'auto', background: 'transparent', borderWidth: 0, cursor: 'pointer', fontSize: 18, color: ui.sub, lineHeight: 1 }}>×</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {(['direct', 'invite'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{ height: 30, padding: '0 14px', borderRadius: 999, fontSize: 12.5, fontWeight: mode === m ? 600 : 500, fontFamily: 'inherit', cursor: 'pointer', background: mode === m ? '#fff' : 'transparent', color: mode === m ? ui.accent : ui.sub, border: `1px solid ${mode === m ? ui.accent : ui.line}` }}
              >
                {m === 'direct' ? 'Add directly' : 'Invite by email'}
              </button>
            ))}
          </div>

          {mode === 'invite' ? (
            <>
              {state.error && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: ui.danger }}>
                  {state.error}
                </div>
              )}

              {state.data ? (
                <div style={{ padding: '12px 16px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#16A34A', marginBottom: 8 }}>
                    {state.data.emailSent
                      ? `Invitation emailed to ${state.data.email} — link below as backup.`
                      : `Invitation created for ${state.data.email}`}
                  </div>
                  <div style={{ fontSize: 12, color: ui.sub, marginBottom: 10 }}>
                    {state.data.emailSent
                      ? 'Share the link below only if the email doesn’t arrive:'
                      : 'Email could not be sent — share this link manually:'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, padding: '8px 12px' }}>
                    <Mono style={{ fontSize: 11.5, flex: 1, wordBreak: 'break-all', color: ui.ink }}>
                      {typeof window !== 'undefined' ? window.location.origin : ''}/invite?token={state.data.token}&email={encodeURIComponent(state.data.email)}&role={state.data.role}
                    </Mono>
                    <CopyButton text={`${typeof window !== 'undefined' ? window.location.origin : ''}/invite?token=${state.data.token}&email=${encodeURIComponent(state.data.email)}&role=${state.data.role}`} />
                  </div>
                </div>
              ) : (
                <form action={action}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'flex-end' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 }}>Email *</label>
                      <input name="email" type="email" required style={{ width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const }} placeholder="colleague@example.com" />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 }}>Role</label>
                      <select name="role" defaultValue="INSPECTOR" style={{ height: 36, padding: '0 8px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8 }}>
                        <option value="INSPECTOR">Inspector</option>
                        <option value="QA_MANAGER">QA Manager</option>
                        <option value="ORG_OWNER">Org Owner</option>
                      </select>
                    </div>
                    <button type="submit" disabled={pending} aria-busy={pending || undefined}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 36, padding: '0 16px', borderRadius: 8, fontSize: 13, fontWeight: 550, fontFamily: 'inherit', background: ui.accent, color: '#fff', borderWidth: 0, cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.65 : 1, marginBottom: 1 }}>
                      {pending && <Spinner size={13} />}
                      {pending ? 'Sending…' : 'Send invite'}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
              <form action={addAction} ref={addFormRef}>
                {addedEmail && !addState.error && (
                  <div style={{ marginBottom: 12, padding: '12px 16px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, fontSize: 13, color: '#16A34A' }}>
                    {addedEmail} was added and can sign in now with the password you set. Add another below.
                  </div>
                )}
                {addState.error && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: ui.danger }}>
                    {addState.error}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 }}>Name</label>
                    <input name="name" style={{ width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const }} placeholder="Full name" />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 }}>Email *</label>
                    <input name="email" type="email" required style={{ width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const }} placeholder="colleague@example.com" />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 }}>Password * (min 8)</label>
                    <input name="password" type="password" required minLength={8} style={{ width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 }}>Role</label>
                    <select name="role" defaultValue="INSPECTOR" style={{ width: '100%', height: 36, padding: '0 8px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8 }}>
                      <option value="INSPECTOR">Inspector</option>
                      <option value="QA_MANAGER">QA Manager</option>
                      <option value="ORG_OWNER">Org Owner</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button type="submit" disabled={addPending} aria-busy={addPending || undefined}
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 36, padding: '0 16px', borderRadius: 8, fontSize: 13, fontWeight: 550, fontFamily: 'inherit', background: ui.accent, color: '#fff', borderWidth: 0, cursor: addPending ? 'default' : 'pointer', opacity: addPending ? 0.65 : 1 }}>
                    {addPending && <Spinner size={13} />}
                    {addPending ? 'Adding…' : 'Add member'}
                  </button>
                </div>
              </form>
          )}
        </div>
      )}

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
            {filtered.map((row) => (
              <RoleRow key={row.email} row={row} currentUserRole={row.role} />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: '32px 0', textAlign: 'center', color: ui.faint, fontSize: 13 }}>
            {rows.length === 0 ? 'No users yet.' : 'No users match your search.'}
          </div>
        )}
      </div>
    </>
  );
}
