'use client';

import { useState, useTransition, useActionState, useRef, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  MoreVertical,
  Plus,
} from 'lucide-react';
import { Avatar, Btn, Mono } from '@/components/inspect/shell';
import { ConfirmDialog } from '@/components/inspect/confirm-dialog';
import { mono as monoStyle, ui } from '@/components/inspect/tokens';
import type { ApiBuyer, ApiLoopPreset, ApiSupplier } from '@/lib/api';
import { archiveBuyer, archiveSupplier, createBuyer, createSupplier, restoreBuyer, restoreSupplier } from './actions';

const th = {
  fontSize: 11,
  fontWeight: 550,
  color: ui.sub,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.4,
  padding: '13px 20px',
  textAlign: 'left' as const,
  borderBottom: `1px solid ${ui.line}`,
  background: ui.fill,
};
const td = {
  padding: '14px 20px',
  fontSize: 13,
  color: ui.ink,
  borderBottom: `1px solid ${ui.lineSoft}`,
  verticalAlign: 'middle' as const,
};
const chip = (active: boolean) => ({
  height: 30,
  padding: '0 14px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: `1px solid ${active ? ui.ink : ui.line}`,
  background: active ? ui.ink : '#fff',
  color: active ? '#fff' : ui.sub,
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
});

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDate = (iso?: string) => (iso ? DATE_FMT.format(new Date(iso)) : '—');

function ArchivedBadge() {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: '#EFF2F6', color: '#475467', textTransform: 'uppercase', letterSpacing: 0.4 }}>
      Archived
    </span>
  );
}

/** Real Prev/Next pagination controls (INS-050). */
function Pager({ page, hasPrev, hasNext, onPage }: { page: number; hasPrev: boolean; hasNext: boolean; onPage: (n: number) => void }) {
  const btn = (disabled: boolean) => ({
    width: 28,
    height: 28,
    borderRadius: 6,
    border: `1px solid ${ui.line}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: ui.faint,
    opacity: disabled ? 0.5 : 1,
    background: '#fff',
    cursor: disabled ? 'default' : 'pointer',
    padding: 0,
  } as const);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {page > 1 && <Mono style={{ fontSize: 11.5, color: ui.faint, marginRight: 4 }}>page {page}</Mono>}
      <button aria-label="Previous page" disabled={!hasPrev} style={btn(!hasPrev)} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={14} />
      </button>
      <button aria-label="Next page" disabled={!hasNext} style={btn(!hasNext)} onClick={() => onPage(page + 1)}>
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

const BRANDS = ['#1457A3', '#0B7D6B', '#C2410C', '#7C3AED', '#B5791A', '#0B1220'];
const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '??';

function InputRow({ label, name, placeholder, type = 'text', defaultValue }: { label: string; name: string; placeholder?: string; type?: string; defaultValue?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</label>
      <input name={name} type={type} defaultValue={defaultValue} placeholder={placeholder}
        style={{ width: '100%', height: 34, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const }} />
    </div>
  );
}

function InlineForm({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ background: ui.accentSoft, border: `1px solid #CFE5FD`, borderRadius: 10, padding: '18px 20px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: ui.sub, lineHeight: 1 }}>×</button>
      </div>
      {children}
    </div>
  );
}

function RowMenu({ id, type, archived, onClose }: { id: string; type: 'buyer' | 'supplier'; archived: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const item = (color: string): React.CSSProperties => ({
    display: 'block', width: '100%', padding: '10px 14px', fontSize: 13, color,
    background: 'transparent', borderWidth: '1px 0 0 0', borderStyle: 'solid', borderColor: ui.lineSoft,
    fontFamily: 'inherit', textAlign: 'left', cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1,
  });

  function runArchiveOrRestore(fn: (id: string) => Promise<{ error?: string } | undefined>) {
    startTransition(async () => {
      const r = await fn(id);
      if (r?.error) alert(r.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <div ref={ref} style={{ position: 'absolute', right: 0, top: 32, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 50, minWidth: 180, overflow: 'hidden' }}>
      <button onClick={() => { router.push(`/${type === 'buyer' ? 'buyers' : 'suppliers'}/${id}`); onClose(); }} style={{ ...item(ui.ink), borderWidth: 0 }}>
        Edit
      </button>
      {type === 'buyer' && (
        <button onClick={() => { router.push(`/buyers/${id}/guests`); onClose(); }} style={item(ui.ink)}>
          Manage guests
        </button>
      )}
      {archived ? (
        <button disabled={pending} onClick={() => runArchiveOrRestore(type === 'buyer' ? restoreBuyer : restoreSupplier)} style={item(ui.accent)}>
          Restore
        </button>
      ) : (
        <button disabled={pending} onClick={() => setConfirming(true)} style={item(ui.danger)}>
          Archive
        </button>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Archive this ${type}?`}
          body="Archived records leave the active views but stay recoverable from the Archived tab."
          confirmLabel="Archive"
          danger
          onConfirm={() => { setConfirming(false); runArchiveOrRestore(type === 'buyer' ? archiveBuyer : archiveSupplier); }}
          onCancel={() => { setConfirming(false); onClose(); }}
        />
      )}
    </div>
  );
}

export function DirectoryClient({
  buyers: initialBuyers,
  suppliers: initialSuppliers,
  presets,
  live,
  page,
  pageSize,
}: {
  buyers: ApiBuyer[];
  suppliers: ApiSupplier[];
  presets: ApiLoopPreset[];
  live: boolean;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /** Server filter: ?includeArchived=1 widens the result set; ?view=archived narrows the display. */
  const showArchived = searchParams.get('includeArchived') === '1';
  const view: 'all' | 'active' | 'archived' =
    searchParams.get('view') === 'archived' ? 'archived' : showArchived ? 'all' : 'active';
  /** The server-side search term currently applied (INS-050). */
  const serverQuery = searchParams.get('q') ?? '';

  const [tab, setTab] = useState<'buyers' | 'suppliers'>('buyers');
  const [search, setSearch] = useState(serverQuery);
  const [showAddBuyer, setShowAddBuyer] = useState(false);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const [buyerState, buyerAction, buyerPending] = useActionState(createBuyer, {});
  const [supplierState, supplierAction, supplierPending] = useActionState(createSupplier, {});

  function pushListParams(next: { q?: string; page?: number; view?: 'all' | 'active' | 'archived' }) {
    const sp = new URLSearchParams();
    const v = next.view ?? view;
    if (v !== 'active') sp.set('includeArchived', '1');
    if (v === 'archived') sp.set('view', 'archived');
    const q = next.q !== undefined ? next.q : serverQuery;
    if (q) sp.set('q', q);
    if (next.page && next.page > 1) sp.set('page', String(next.page));
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  /**
   * The buyers/suppliers tabs share one server ?page= param, so switching to a
   * tab while paged past a smaller list would show it empty. Reset to page 1 on
   * every tab switch so each tab always lands on its first page.
   */
  function switchTab(next: 'buyers' | 'suppliers') {
    setTab(next);
    if (page > 1) pushListParams({ page: 1 });
  }

  const buyers = initialBuyers;
  const suppliers = initialSuppliers;

  const filteredBuyers = buyers.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredSuppliers = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.address ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const visibleBuyers = view === 'archived' ? filteredBuyers.filter((b) => b.archivedAt) : filteredBuyers;
  const visibleSuppliers = view === 'archived' ? filteredSuppliers.filter((s) => s.archivedAt) : filteredSuppliers;

  /** Real Prev/Next (INS-050): next exists when the server returned a full page. */
  const hasPrev = page > 1;
  const hasNext = (tab === 'buyers' ? buyers.length : suppliers.length) === pageSize;

  return (
    <>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 24, marginTop: 22, borderBottom: `1px solid ${ui.line}` }}>
        {([['buyers', 'Buyers', buyers.length], ['suppliers', 'Suppliers / Factories', suppliers.length]] as const).map(([k, l, n]) => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => switchTab(k)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px 12px', marginBottom: -1, borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 0, borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: on ? ui.accent : 'transparent', color: on ? ui.ink : ui.sub, fontWeight: on ? 600 : 500, fontSize: 14, cursor: 'pointer', background: 'transparent', fontFamily: 'inherit' }}>
              {l}
              <span style={{ ...monoStyle, fontSize: 11, padding: '1px 7px', borderRadius: 999, background: on ? ui.accentSoft : ui.lineSoft, color: on ? ui.accent : ui.faint }}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Search + filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0 16px' }}>
        <div style={{ position: 'relative' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={ui.faint} strokeWidth="2" style={{ position: 'absolute', left: 12, top: 10.5 }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') pushListParams({ q: search.trim() }); }}
            style={{ width: 340, height: 36, padding: '0 12px 0 36px', fontSize: 13, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none' }}
            placeholder={tab === 'buyers' ? 'Search buyers by name… (Enter searches all)' : 'Search suppliers by name or city… (Enter searches all)'} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={chip(view === 'all')} onClick={() => pushListParams({ view: 'all' })}>All</button>
          <button style={chip(view === 'active')} onClick={() => pushListParams({ view: 'active' })}>Active</button>
          <button style={chip(view === 'archived')} onClick={() => pushListParams({ view: 'archived' })}>Archived</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11.5, color: ui.faint }}>{live ? 'Live · from API' : 'Demo data · API offline'}</span>
          {tab === 'buyers' ? (
            <Btn kind="primary" icon={<Plus size={15} />} onClick={() => { setShowAddBuyer(true); setShowAddSupplier(false); }}>Add Buyer</Btn>
          ) : (
            <Btn kind="ghost" icon={<Plus size={14} />} small onClick={() => { setShowAddSupplier(true); setShowAddBuyer(false); }}>Add Supplier</Btn>
          )}
        </div>
      </div>

      {/* Buyers tab */}
      {tab === 'buyers' && (
        <>
          {showAddBuyer && (
            <InlineForm title="Add Buyer" onClose={() => setShowAddBuyer(false)}>
              <form action={buyerAction}>
                {buyerState.error && <div style={{ marginBottom: 10, fontSize: 12.5, color: ui.danger }}>{buyerState.error}</div>}
                <InputRow label="Name *" name="name" placeholder="Buyer company name" />
                <InputRow label="Logo URL" name="logoUrl" placeholder="https://…" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Brand Color</label>
                    <input name="primaryColor" type="color" defaultValue="#037BF4"
                      style={{ width: '100%', height: 34, padding: '2px 4px', border: `1px solid ${ui.line}`, borderRadius: 8, cursor: 'pointer' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Default Preset</label>
                    <select name="defaultLoopPresetId"
                      style={{ width: '100%', height: 34, padding: '0 8px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8 }}>
                      <option value="">None</option>
                      {presets.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                  <Btn kind="ghost" onClick={() => setShowAddBuyer(false)}>Cancel</Btn>
                  <Btn kind="primary" type="submit" style={{ opacity: buyerPending ? 0.65 : 1 }}>
                    {buyerPending ? 'Creating…' : 'Create Buyer'}
                  </Btn>
                </div>
              </form>
            </InlineForm>
          )}

          <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 56 }} />
                  <th style={th}>Buyer</th>
                  <th style={th}>Report branding</th>
                  <th style={{ ...th, textAlign: 'right' }}>POs</th>
                  <th style={{ ...th, textAlign: 'right' }}>Inspections</th>
                  <th style={{ ...th, textAlign: 'right' }}>Reports</th>
                  <th style={th}>Last activity</th>
                  <th style={{ ...th, width: 48 }} />
                </tr>
              </thead>
              <tbody>
                {visibleBuyers.map((b, i) => {
                  const color = b.primaryColor || BRANDS[i % BRANDS.length];
                  const initials = initialsOf(b.name);
                  return (
                    <tr key={b.id} style={{ cursor: 'pointer', opacity: b.archivedAt ? 0.6 : 1 }} onClick={() => { if (!menuOpen) window.location.href = `/buyers/${b.id}`; }}>
                      <td style={td}>
                        {b.logoUrl ? (
                          <img src={b.logoUrl} alt={b.name} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'contain', border: `1px solid ${ui.lineSoft}` }} />
                        ) : (
                          <div style={{ width: 32, height: 32, borderRadius: 6, background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{initials}</div>
                        )}
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 550 }}>{b.name}</span>
                          {b.archivedAt && <ArchivedBadge />}
                        </div>
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 16, height: 16, borderRadius: 4, background: color, border: '1px solid rgba(0,0,0,0.08)' }} />
                          <Mono style={{ fontSize: 12, color: ui.sub }}>{color.toUpperCase()}</Mono>
                        </div>
                      </td>
                      <td style={{ ...td, ...monoStyle, textAlign: 'right' }}>{b._count?.purchaseOrders ?? '—'}</td>
                      <td style={{ ...td, ...monoStyle, textAlign: 'right' }}>{b._count?.inspections ?? '—'}</td>
                      <td style={{ ...td, ...monoStyle, textAlign: 'right' }}>{b._count?.reports ?? '—'}</td>
                      <td style={{ ...td, color: ui.sub }}>{fmtDate(b.updatedAt)}</td>
                      <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          <button onClick={() => setMenuOpen(menuOpen === b.id ? null : b.id)}
                            style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ui.faint, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                            <MoreVertical size={16} />
                          </button>
                          {menuOpen === b.id && <RowMenu id={b.id} type="buyer" archived={!!b.archivedAt} onClose={() => setMenuOpen(null)} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: `1px solid ${ui.lineSoft}`, color: ui.sub, fontSize: 12.5 }}>
              <span>Showing <Mono>{visibleBuyers.length}</Mono> buyer{visibleBuyers.length === 1 ? '' : 's'}</span>
              <Pager page={page} hasPrev={hasPrev} hasNext={hasNext} onPage={(n) => pushListParams({ page: n })} />
            </div>
          </div>
        </>
      )}

      {/* Suppliers tab */}
      {tab === 'suppliers' && (
        <>
          {showAddSupplier && (
            <InlineForm title="Add Supplier" onClose={() => setShowAddSupplier(false)}>
              <form action={supplierAction}>
                {supplierState.error && <div style={{ marginBottom: 10, fontSize: 12.5, color: ui.danger }}>{supplierState.error}</div>}
                <InputRow label="Name *" name="name" placeholder="Factory / supplier name" />
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Address</label>
                  <textarea name="address" rows={2} placeholder="City, Country"
                    style={{ width: '100%', padding: '6px 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', resize: 'none', boxSizing: 'border-box' as const }} />
                </div>
                <InputRow label="GPS (JSON)" name="gpsJson" placeholder='{"lat":0,"lng":0}' />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                  <Btn kind="ghost" onClick={() => setShowAddSupplier(false)}>Cancel</Btn>
                  <Btn kind="primary" type="submit" style={{ opacity: supplierPending ? 0.65 : 1 }}>
                    {supplierPending ? 'Creating…' : 'Create Supplier'}
                  </Btn>
                </div>
              </form>
            </InlineForm>
          )}

          <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 56 }} />
                  <th style={th}>Factory</th>
                  <th style={th}>GPS</th>
                  <th style={{ ...th, textAlign: 'right' }}>POs</th>
                  <th style={{ ...th, textAlign: 'right' }}>Inspections</th>
                  <th style={th}>Last activity</th>
                  <th style={{ ...th, width: 48 }} />
                </tr>
              </thead>
              <tbody>
                {visibleSuppliers.map((s) => (
                  <tr key={s.id} style={{ cursor: 'pointer', opacity: s.archivedAt ? 0.6 : 1 }} onClick={() => { if (!menuOpen) window.location.href = `/suppliers/${s.id}`; }}>
                    <td style={td}><Avatar initials={initialsOf(s.name)} size={32} bg="#475467" /></td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 550 }}>{s.name}</span>
                        {s.archivedAt && <ArchivedBadge />}
                      </div>
                      <div style={{ color: ui.faint, fontSize: 12, marginTop: 2 }}>{s.address || '—'}</div>
                    </td>
                    <td style={td}>
                      {s.gps ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#1F8A4C' }}><MapPin size={13} color="#1F8A4C" /> Pinned</span>
                      ) : (
                        <span style={{ fontSize: 12, color: ui.faint }}>—</span>
                      )}
                    </td>
                    <td style={{ ...td, ...monoStyle, textAlign: 'right' }}>{s._count?.purchaseOrders ?? '—'}</td>
                    <td style={{ ...td, ...monoStyle, textAlign: 'right' }}>{s._count?.inspections ?? '—'}</td>
                    <td style={{ ...td, color: ui.sub }}>{fmtDate(s.updatedAt)}</td>
                    <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        <button onClick={() => setMenuOpen(menuOpen === s.id ? null : s.id)}
                          style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ui.faint, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                          <MoreVertical size={16} />
                        </button>
                        {menuOpen === s.id && <RowMenu id={s.id} type="supplier" archived={!!s.archivedAt} onClose={() => setMenuOpen(null)} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: `1px solid ${ui.lineSoft}`, color: ui.sub, fontSize: 12.5 }}>
              <span>Showing <Mono>{visibleSuppliers.length}</Mono> supplier{visibleSuppliers.length === 1 ? '' : 's'}</span>
              <Pager page={page} hasPrev={hasPrev} hasNext={hasNext} onPage={(n) => pushListParams({ page: n })} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
