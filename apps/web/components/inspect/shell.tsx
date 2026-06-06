'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import {
  Bell,
  Building2,
  ChevronDown,
  ClipboardList,
  Repeat,
  Search,
  Settings,
  Upload,
  Users,
} from 'lucide-react';
import { mono as monoStyle, roles, severity, ui, type RoleKey, type SeverityKey } from './tokens';

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
    border: '1px solid transparent',
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
const NAV = [
  { key: 'directory', label: 'Buyers & Suppliers', icon: Building2, href: '/dashboard' },
  { key: 'inspections', label: 'Inspections', icon: ClipboardList, href: '/inspections/new' },
  { key: 'presets', label: 'Loop Presets', icon: Repeat, href: '/presets' },
  { key: 'users', label: 'Users & Roles', icon: Users, href: '/users' },
  { key: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
] as const;

const DEFAULT_USER = { name: 'Riya Saraf', initials: 'RS', role: 'owner' as RoleKey };
const DEFAULT_ORG = 'Asha Inspection Services';

function Sidebar({ org }: { org: string }) {
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
        <ChevronDown size={14} color={ui.faint} />
      </div>

      {NAV.map((n) => {
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
        <Avatar initials={DEFAULT_USER.initials} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 550, lineHeight: 1.3 }}>{DEFAULT_USER.name}</div>
          <div style={{ marginTop: 2 }}>
            <RoleBadge role={DEFAULT_USER.role} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ org, search }: { org: string; search: string }) {
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
      <div
        style={{
          flex: 1,
          maxWidth: 420,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          background: ui.bg,
          borderRadius: 8,
          border: `1px solid ${ui.line}`,
        }}
      >
        <Search size={15} color={ui.faint} />
        <span style={{ color: ui.faint, fontSize: 13, flex: 1 }}>{search}</span>
        <Mono style={{ fontSize: 11, color: ui.faint, border: `1px solid ${ui.line}`, borderRadius: 4, padding: '1px 6px' }}>⌘K</Mono>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ position: 'relative', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Bell size={17} color={ui.sub} />
          <span style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 999, background: '#D14343', border: '1.5px solid #fff' }} />
        </div>
        <div style={{ width: 1, height: 22, background: ui.line }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Avatar initials={DEFAULT_USER.initials} size={30} />
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{DEFAULT_USER.name}</div>
            <div style={{ fontSize: 10.5, color: ui.faint, marginTop: 1 }}>
              {roles[DEFAULT_USER.role].label} · {org.split(' ')[0]}
            </div>
          </div>
          <ChevronDown size={14} color={ui.faint} />
        </div>
      </div>
    </header>
  );
}

/** Full-height responsive console shell: sidebar + topbar + scrollable content. */
export function ConsoleShell({
  children,
  org = DEFAULT_ORG,
  search = 'Search inspections, buyers, suppliers, POs…',
}: {
  children: ReactNode;
  org?: string;
  search?: string;
}) {
  return (
    <div
      style={{
        height: '100vh',
        background: ui.bg,
        fontFamily: ui.font,
        fontSize: 13,
        color: ui.ink,
        display: 'flex',
        fontFeatureSettings: '"cv11", "ss01"',
      }}
    >
      <Sidebar org={org} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar org={org} search={search} />
        <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}
