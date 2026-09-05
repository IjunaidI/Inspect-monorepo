import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { mono, ui } from './tokens';

// Not `Mono` from ./shell: that module imports the sign-out server action and
// with it next-auth, which this hook-free component must not drag into a
// Server Component tree — or into the Vitest suite.
const monoCurrent: CSSProperties = { ...mono, color: ui.ink, fontWeight: 600 };

export interface BreadcrumbItem {
  label: ReactNode;
  /** Intermediate crumbs link back; the last crumb is the current page and never links. */
  href?: string;
  /** Render in JetBrains Mono — for a PO number or an id, not for words. */
  mono?: boolean;
}

/**
 * The console's breadcrumb (INS-092). Replaces three hand-rolled copies
 * (new inspection, review, populate) that agreed on the look — 13px, `ui.sub`,
 * 14px chevrons — and disagreed on whether the parent was a link. Now it is:
 * every crumb but the last is a Link when it carries an href.
 *
 * No hooks, so Server Components and the populate workspace both render it.
 */
export function Breadcrumb({
  items,
  icon,
  style,
}: {
  items: BreadcrumbItem[];
  icon?: ReactNode;
  style?: CSSProperties;
}) {
  const last = items.length - 1;
  return (
    <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', color: ui.sub, fontSize: 13, ...style }}>
      <ol style={{ display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
        {icon && <li aria-hidden="true" style={{ display: 'flex', alignItems: 'center' }}>{icon}</li>}
        {items.map((item, i) => {
          const current = i === last;
          const text = item.mono ? (
            <span style={monoCurrent}>{item.label}</span>
          ) : current ? (
            <span style={{ color: ui.ink, fontWeight: 550 }}>{item.label}</span>
          ) : (
            <span>{item.label}</span>
          );
          return (
            <li key={i} aria-current={current ? 'page' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!current && item.href ? (
                <Link href={item.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                  {text}
                </Link>
              ) : (
                text
              )}
              {!current && <ChevronRight size={14} color={ui.faint} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
