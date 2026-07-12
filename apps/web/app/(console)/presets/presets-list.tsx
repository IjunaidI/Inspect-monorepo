'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { ArrowRight, MoreVertical, Search } from 'lucide-react';
import { Mono } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { archivePreset } from './actions';
import type { PresetRow } from './page';

const card = { background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column' as const, gap: 12 };
const monoChip = { fontSize: 11.5 };

export function PresetsList({ presets: initial, live }: { presets: PresetRow[]; live: boolean }) {
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'edited'>('edited');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetRow[]>(initial);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Close menu on Escape
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(null);
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [menuOpen]);

  const filtered = presets
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort(
      sort === 'name'
        ? (a, b) => a.name.localeCompare(b.name)
        : (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );

  function handleArchive(id: string) {
    startTransition(async () => {
      const result = await archivePreset(id);
      if (result.error) {
        alert(result.error);
      } else {
        setPresets((prev) => prev.filter((p) => p.id !== id));
      }
      setMenuOpen(null);
    });
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24, marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <Search size={15} color={ui.faint} style={{ position: 'absolute', left: 12, top: 10.5 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 320, height: 36, padding: '0 12px 0 36px', fontSize: 13, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none' }}
            placeholder="Search presets…"
          />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11.5, color: ui.faint }}>{live ? 'Live · from API' : 'Demo data · API offline'}</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'name' | 'edited')}
            style={{ height: 30, padding: '0 10px', border: `1px solid ${ui.line}`, borderRadius: 8, background: '#fff', color: ui.sub, fontSize: 12.5, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <option value="edited">Last edited</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {filtered.map((p) => (
          <div key={p.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 11.5, color: ui.faint }}>{p.desc}</span>
                </div>
              </div>
              <div style={{ position: 'relative' }} ref={menuOpen === p.id ? menuRef : undefined}>
                <button
                  onClick={() => setMenuOpen(menuOpen === p.id ? null : p.id)}
                  style={{ width: 28, height: 28, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ui.faint, background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  <MoreVertical size={15} />
                </button>
                {menuOpen === p.id && (
                  <div style={{ position: 'absolute', right: 0, top: 32, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 50, minWidth: 180, overflow: 'hidden' }}>
                    <a
                      href={`/presets/new?from=${p.id}`}
                      style={{ display: 'block', padding: '10px 14px', fontSize: 13, color: ui.ink, textDecoration: 'none' }}
                    >
                      Duplicate (new version)
                    </a>
                    <button
                      onClick={() => handleArchive(p.id)}
                      disabled={pending}
                      style={{ display: 'block', width: '100%', padding: '10px 14px', fontSize: 13, color: '#DC2626', background: 'transparent', borderWidth: '1px 0 0 0', borderStyle: 'solid', borderColor: ui.lineSoft, fontFamily: 'inherit', textAlign: 'left', cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1 }}
                    >
                      Archive
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${ui.lineSoft}`, paddingTop: 10, minHeight: 40 }}>
              {p.loops.length > 0 ? (
                <>
                  {p.loops.map(([name, shots], j) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', padding: '6px 0' }}>
                      <span style={{ ...monoChip, color: ui.faint, minWidth: 22 }}>{String(j + 1).padStart(2, '0')}</span>
                      <span style={{ flex: 1, fontSize: 12.5, color: ui.ink }}>{name}</span>
                      <span style={{ ...monoChip, fontSize: 10.5, padding: '2px 6px', background: ui.lineSoft, color: ui.sub, borderRadius: 4 }}>{shots} shots</span>
                    </div>
                  ))}
                  {p.loopCount > p.loops.length && <div style={{ fontSize: 11.5, color: ui.faint, padding: '4px 0 0', marginLeft: 22 }}>+{p.loopCount - p.loops.length} more</div>}
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: ui.sub, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: ui.ink }}>{p.loopCount}</span> loops in this preset
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', borderTop: `1px solid ${ui.lineSoft}`, paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 11, color: ui.sub }}>Used by <span style={{ fontSize: 11.5, fontWeight: 600, color: ui.ink }}>{p.used}</span> inspection{p.used === 1 ? '' : 's'}</div>
                <div style={{ fontSize: 11, color: ui.faint }}>Edited {p.edited}</div>
              </div>
              <a
                href={`/presets/${p.id}`}
                style={{ marginLeft: 'auto', fontSize: 12.5, color: ui.accent, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
              >
                View <ArrowRight size={13} color={ui.accent} />
              </a>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: '48px 0', textAlign: 'center', color: ui.faint, fontSize: 13 }}>
          {search ? `No presets match "${search}"` : 'No presets yet. Create your first one.'}
        </div>
      )}
    </>
  );
}
