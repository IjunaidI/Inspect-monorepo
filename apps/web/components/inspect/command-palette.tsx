'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
// NOTE: import tokens directly (not shell's Mono) — shell imports this module,
// so importing shell back would create a circular dependency.
import { mono, ui } from './tokens';

/** Keyboard-hint chip in the house mono style. */
function Kbd({ children, bordered = true }: { children: ReactNode; bordered?: boolean }) {
  return (
    <span
      style={{
        ...mono,
        fontSize: bordered ? 11 : 10.5,
        color: ui.faint,
        ...(bordered ? { border: `1px solid ${ui.line}`, borderRadius: 4, padding: '1px 6px' } : {}),
      }}
    >
      {children}
    </span>
  );
}

/** Matches the API's GET /search hit shape (INS-051). */
export interface SearchHit {
  type: 'buyer' | 'supplier' | 'product' | 'po' | 'inspection';
  id: string;
  label: string;
  sublabel: string | null;
}

const TYPE_META: Record<SearchHit['type'], { label: string; route: (id: string) => string }> = {
  buyer: { label: 'Buyer', route: (id) => `/buyers/${id}` },
  supplier: { label: 'Supplier', route: (id) => `/suppliers/${id}` },
  product: { label: 'Product', route: (id) => `/products/${id}` },
  po: { label: 'PO', route: (id) => `/purchase-orders/${id}` },
  inspection: { label: 'Inspection', route: (id) => `/inspections/${id}/review` },
};
const TYPE_ORDER: SearchHit['type'][] = ['buyer', 'supplier', 'product', 'po', 'inspection'];

/**
 * ⌘K command palette (INS-051): topbar trigger + overlay. Debounced org-scoped
 * search via the /api/search route handler (JWT stays server-side); arrow keys
 * + Enter navigate to the matched entity.
 */
export function CommandPalette({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Group for rendering; keep a flat list (same visual order) for keyboard nav.
  const groups = useMemo(
    () =>
      TYPE_ORDER
        .map((type) => ({ type, items: hits.filter((h) => h.type === type) }))
        .filter((g) => g.items.length > 0),
    [hits],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHits([]);
    setActiveIndex(0);
  }, []);

  // Global Ctrl/⌘-K toggle.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Focus the input whenever the palette opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced fetch (200ms) against the session-authenticated proxy route.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const body = res.ok ? ((await res.json()) as SearchHit[]) : [];
        if (!cancelled) {
          setHits(Array.isArray(body) ? body : []);
          setActiveIndex(0);
        }
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  function navigateTo(hit: SearchHit) {
    close();
    router.push(TYPE_META[hit.type].route(hit.id));
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = flat[activeIndex];
      if (hit) navigateTo(hit);
    }
  }

  return (
    <>
      {/* Topbar trigger — same hairline idiom as the old static search box. */}
      <button
        type="button"
        aria-label="Open search (Ctrl+K)"
        onClick={() => setOpen(true)}
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
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <Search size={15} color={ui.faint} />
        <span style={{ color: ui.faint, fontSize: 13, flex: 1 }}>{placeholder}</span>
        <Kbd>⌘K</Kbd>
      </button>

      {open && (
        <div
          onClick={close}
          style={{ position: 'fixed', inset: 0, background: 'rgba(11,18,32,0.4)', zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '120px 24px 24px' }}
        >
          <div
            role="dialog"
            aria-label="Search"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 560, maxWidth: '100%', background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px rgba(11,18,32,0.18)', fontFamily: ui.font, color: ui.ink }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${ui.line}` }}>
              <Search size={16} color={ui.faint} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search buyers, suppliers, products, POs, inspections…"
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: ui.ink, fontFamily: 'inherit' }}
              />
              <Kbd>Esc</Kbd>
            </div>

            <div style={{ maxHeight: 360, overflow: 'auto' }}>
              {!query.trim() ? (
                <div style={{ padding: '20px 16px', fontSize: 12.5, color: ui.faint }}>
                  Type to search across your workspace.
                </div>
              ) : loading && flat.length === 0 ? (
                <div style={{ padding: '20px 16px', fontSize: 12.5, color: ui.faint }}>Searching…</div>
              ) : flat.length === 0 ? (
                <div style={{ padding: '20px 16px', fontSize: 12.5, color: ui.faint }}>
                  No matches for “{query.trim()}”.
                </div>
              ) : (
                groups.map((group) => (
                  <div key={group.type}>
                    <div style={{ padding: '8px 16px 4px', fontSize: 10.5, fontWeight: 600, color: ui.faint, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {TYPE_META[group.type].label}
                    </div>
                    {group.items.map((hit) => {
                      const index = flat.indexOf(hit);
                      const active = index === activeIndex;
                      return (
                        <div
                          key={`${hit.type}-${hit.id}`}
                          onClick={() => navigateTo(hit)}
                          onMouseEnter={() => setActiveIndex(index)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', cursor: 'pointer', background: active ? ui.accentSoft : 'transparent', borderLeft: active ? `2px solid ${ui.accent}` : '2px solid transparent' }}
                        >
                          <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: ui.lineSoft, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, flexShrink: 0 }}>
                            {TYPE_META[hit.type].label}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hit.label}</span>
                          {hit.sublabel && (
                            <span style={{ marginLeft: 'auto', fontSize: 12, color: ui.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>
                              {hit.sublabel}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderTop: `1px solid ${ui.line}`, fontSize: 11, color: ui.faint }}>
              <span><Kbd bordered={false}>↑↓</Kbd> navigate</span>
              <span><Kbd bordered={false}>↵</Kbd> open</span>
              <span><Kbd bordered={false}>esc</Kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
