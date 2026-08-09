'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import {
  Building2,
  ClipboardList,
  FileCheck2,
  FileText,
  LogOut,
  Package,
  Repeat,
  Upload,
  Users,
} from 'lucide-react';
import { mono as monoStyle, roles, severity, ui, type RoleKey, type SeverityKey } from './tokens';
import { initialsFrom } from '@/lib/roles';
import { signOutAction } from '@/app/(console)/actions';
import { exitOrg } from '@/app/(console)/admin/actions';
import { CommandPalette } from './command-palette';

// ─── Primitives ──────────────────────────────────────────────
export function Mono({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ ...monoStyle, ...style }}>{children}</span>;
}

type BtnKind = 'primary' | 'ghost' | 'quiet' | 'dark';
export function Btn({
  kind = 'ghost',
  children,
  icon,
  style,
  small,
  href,
  onClick,
  type = 'button',
}: {
  kind?: BtnKind;
  children?: ReactNode;
  icon?: ReactNode;
  style?: CSSProperties;
  small?: boolean;
  href?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: small ? 30 : 36,
    padding: small ? '0 11px' : '0 14px',
    borderRadius: 8,
    fontWeight: 550,
    fontSize: small ? 12.5 : 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    // Longhand, not `border: '1px solid transparent'`: the `ghost` kind below
    // overrides only borderColor, and mixing the shorthand with a longhand in
    // one merged style object makes React warn and leaves a stale border colour
    // behind when a Btn re-renders as a different kind.
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    textDecoration: 'none',
  };
  const kinds: Record<BtnKind, CSSProperties> = {
    primary: { background: ui.accent, color: '#fff' },
    ghost: { background: '#fff', color: ui.ink, borderColor: ui.line, fontWeight: 500 },
    quiet: { background: 'transparent', color: ui.sub, fontWeight: 500 },
    dark: { background: ui.ink, color: '#fff' },
  };
  const merged = { ...base, ...kinds[kind], ...style };
  if (href) {
    return (
      <Link href={href} style={merged}>
        {icon}
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} style={merged}>
      {icon}
      {children}
    </button>
  );
}

export function SeverityTag({
  sev,
  children,
  dot = true,
  style,
}: {
  sev: SeverityKey;
  children?: ReactNode;
  dot?: boolean;
  style?: CSSProperties;
}) {
  const s = severity[sev];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 22,
        padding: '0 8px',
        borderRadius: 5,
        fontSize: 11,
        fontWeight: 600,
        background: s.bg,
        color: s.fg,
        ...style,
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />}
      {children || s.label}
    </span>
  );
}

export function RoleBadge({ role, style }: { role: RoleKey; style?: CSSProperties }) {
  const r = roles[role];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        padding: '0 8px',
        borderRadius: 5,
        fontSize: 11,
        fontWeight: 600,
        background: r.bg,
        color: r.fg,
        ...style,
      }}
    >
      {r.label}
    </span>
  );
}

export function Avatar({ initials, size = 28, bg = ui.ink }: { initials: string; size?: number; bg?: string }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: bg,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 600,
        flexShrink: 0,
        letterSpacing: 0.2,
      }}
    >
      {initials}
    </div>
  );
}

/** Every MVP photo is an Admin desktop upload — badged unverified (spec §9). */
export function UnverifiedBadge({ style }: { style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 22,
        padding: '0 8px',
        borderRadius: 5,
        fontSize: 11,
        fontWeight: 600,
        background: '#FAF1E2',
        color: '#B5791A',
        ...style,
      }}
    >
      <Upload size={11} />
      Manually uploaded · unverified
    </span>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.3, margin: 0 }}>{title}</h1>
        {sub && <div style={{ fontSize: 13, color: ui.sub, marginTop: 4 }}>{sub}</div>}
      </div>
      {actions && <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{actions}</div>}
    </div>
  );
}

// ─── Shell ───────────────────────────────────────────────────
const ROLE_FLOOR: Record<RoleKey, number> = { inspector: 1, qa: 2, owner: 3, platform: 4 };

const NAV: {
  key: string; label: string; icon: typeof Building2; href: string;
  minRole: RoleKey; scope: 'org' | 'admin';
}[] = [
  { key: 'orgs', label: 'Organizations', icon: Building2, href: '/admin/orgs', minRole: 'platform', scope: 'admin' },
  { key: 'directory', label: 'Buyers & Suppliers', icon: Building2, href: '/dashboard', minRole: 'qa', scope: 'org' },
  { key: 'inspections', label: 'Inspections', icon: ClipboardList, href: '/inspections', minRole: 'inspector', scope: 'org' },
  { key: 'reports', label: 'Reports', icon: FileCheck2, href: '/reports', minRole: 'qa', scope: 'org' },
  { key: 'presets', label: 'Loop Presets', icon: Repeat, href: '/presets', minRole: 'qa', scope: 'org' },
  { key: 'products', label: 'Products', icon: Package, href: '/products', minRole: 'qa', scope: 'org' },
  { key: 'purchase-orders', label: 'Purchase Orders', icon: FileText, href: '/purchase-orders', minRole: 'qa', scope: 'org' },
  { key: 'users', label: 'Users & Roles', icon: Users, href: '/users', minRole: 'owner', scope: 'org' },
];

// Design-demo identities ONLY. They render when the shell is used without a
// session — i.e. the offline/API-unreachable preview mode. A signed-in operator
// must never see these: ConsoleLayout resolves the real org name for every role
// (INS-080), and passing `org` undefined from a live session would be a bug.
const DEFAULT_USER = { name: 'Riya Saraf', initials: 'RS', role: 'owner' as RoleKey };
const DEFAULT_ORG = 'Asha Inspection Services';

function Sidebar({ org, user, isAssuming }: { org: string; user: typeof DEFAULT_USER; isAssuming: boolean }) {
  const pathname = usePathname();
  return (
    <aside
      style={{
        width: 240,
        background: ui.panel,
        borderRight: `1px solid ${ui.line}`,
        padding: '18px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px',
          borderRadius: 8,
          border: `1px solid ${ui.line}`,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: ui.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          I
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {org}
          </div>
          <div style={{ fontSize: 10.5, color: ui.faint }}>Inspect workspace</div>
        </div>
      </div>

      {NAV.filter((n) => {
        const isPlatform = user.role === 'platform';
        // Org screens all run through requireOrgId, so an un-assumed admin must
        // not see links that would 403. Admin screens are admin-only, and stay
        // visible while assuming so the admin can switch orgs without exiting.
        if (n.scope === 'admin') return isPlatform;
        const canSeeOrgNav = !isPlatform || isAssuming;
        return canSeeOrgNav && ROLE_FLOOR[user.role] >= ROLE_FLOOR[n.minRole];
      }).map((n) => {
        const on = pathname === n.href || (n.href !== '/dashboard' && pathname.startsWith(n.href));
        const NavIcon = n.icon;
        return (
          <Link
            key={n.key}
            href={n.href}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 6,
              color: on ? ui.ink : ui.sub,
              background: on ? '#F0F4F9' : 'transparent',
              fontWeight: on ? 550 : 450,
              fontSize: 13,
              position: 'relative',
              cursor: 'pointer',
              textDecoration: 'none',
            }}
          >
            {on && (
              <span style={{ position: 'absolute', left: -14, top: 6, bottom: 6, width: 2, background: ui.accent, borderRadius: 2 }} />
            )}
            <NavIcon size={16} />
            <span>{n.label}</span>
          </Link>
        );
      })}

      <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: `1px solid ${ui.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar initials={user.initials} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 550, lineHeight: 1.3 }}>{user.name}</div>
          <div style={{ marginTop: 2 }}>
            <RoleBadge role={user.role} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ org, search, user }: { org: string; search: string; user: typeof DEFAULT_USER }) {
  return (
    <header
      style={{
        height: 56,
        borderBottom: `1px solid ${ui.line}`,
        background: ui.panel,
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: 16,
        flexShrink: 0,
      }}
    >
      {/* Real ⌘K command palette (INS-051) — org-scoped global search. */}
      <CommandPalette placeholder={search} />
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Avatar initials={user.initials} size={30} />
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{user.name}</div>
            <div style={{ fontSize: 10.5, color: ui.faint, marginTop: 1 }}>
              {roles[user.role].label} · {org.split(' ')[0]}
            </div>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              title="Sign out"
              style={{ display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: ui.sub }}
            >
              <LogOut size={16} />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

/**
 * Non-dismissible reminder that a Platform Admin is acting inside someone else's
 * tenant (INS-079). Binding QA decisions are possible from here — the operator
 * must never be unsure whose data they are looking at.
 */
function AssumptionBanner({ orgName }: { orgName: string }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 16px', background: ui.assumeBg, color: '#fff', fontSize: 12.5,
      }}
    >
      <span style={{ fontWeight: 600 }}>Platform Admin</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        You are operating inside <strong>{orgName}</strong>. Actions are recorded against your admin account.
      </span>
      <form action={exitOrg}>
        <button
          type="submit"
          style={{
            padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.45)',
            background: 'transparent', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Exit
        </button>
      </form>
    </div>
  );
}

/** Full-height responsive console shell: sidebar + topbar + scrollable content. */
export function ConsoleShell({
  children,
  org = DEFAULT_ORG,
  search = 'Search inspections, buyers, suppliers, POs…',
  userName,
  role,
  assumedOrgName = null,
}: {
  children: ReactNode;
  org?: string;
  search?: string;
  userName?: string;
  role?: RoleKey;
  assumedOrgName?: string | null;
}) {
  const user = userName
    ? { name: userName, initials: initialsFrom(userName), role: role ?? 'inspector' as RoleKey }
    : DEFAULT_USER;
  const isAssuming = Boolean(assumedOrgName);
  return (
    <div
      style={{
        height: '100vh',
        background: ui.bg,
        fontFamily: ui.font,
        fontSize: 13,
        color: ui.ink,
        display: 'flex',
        flexDirection: 'column',
        fontFeatureSettings: '"cv11", "ss01"',
      }}
    >
      {isAssuming && <AssumptionBanner orgName={assumedOrgName as string} />}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar org={org} user={user} isAssuming={isAssuming} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Topbar org={org} search={search} user={user} />
          <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
        </div>
      </div>
    </div>
  );
}
