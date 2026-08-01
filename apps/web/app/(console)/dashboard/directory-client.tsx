'use client';

import { useState, useTransition, useActionState, useRef, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  MapPin,
  MoreVertical,
  Plus,
  Upload,
} from 'lucide-react';
import { Avatar, Btn, Mono } from '@/components/inspect/shell';
import { ConfirmDialog } from '@/components/inspect/confirm-dialog';
import { mono as monoStyle, ui } from '@/components/inspect/tokens';
import type { ApiBuyer, ApiLoopPreset, ApiSupplier } from '@/lib/api';
import { archiveBuyer, archiveSupplier, createBuyer, createSupplier, presignBuyerLogo, restoreBuyer, restoreSupplier } from './actions';

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

const fieldLabel = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 };
const boxInput = { width: '100%', height: 34, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const };

/** Exactly what the API accepts for primaryColor (INS-077) — mirrored for a live hint only. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const isAbsoluteUrl = (v: string) => /^https?:\/\//i.test(v);
/** Decimal degrees with trailing zeros dropped (INS-071): 23.810300 → 23.8103, 120.000000 → 120. */
const coord = (n: number) => String(Number(n.toFixed(6)));
/** Render source for a buyer logo: the API's short-lived presigned GET, or a legacy absolute URL. */
const logoSrcOf = (b: ApiBuyer): string | null =>
  b.logoViewUrl ?? (b.logoUrl && isAbsoluteUrl(b.logoUrl) ? b.logoUrl : null);

/**
 * Buyer logo upload (INS-072): presign → PUT the bytes straight to storage →
 * submit the DURABLE object key. The presigned URL is display-only and must never
 * be persisted — `logoUrl` freezes verbatim into the Ed25519-signed report
 * brandingSnapshot, so a ~900s URL there would rot permanently.
 */
function LogoUploadField() {
  const [logoKey, setLogoKey] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sole owner of the blob: URL — runs on replacement and on unmount.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const presign = await presignBuyerLogo(ext);
      if (presign.error || !presign.data) {
        setError(presign.error ?? 'Could not prepare the upload.');
        return;
      }
      // fetch() only *rejects* on a transport failure — offline, DNS/TLS, or a CORS
      // preflight the bucket refused, meaning the bytes never left the browser. An
      // HTTP error status resolves normally: storage answered and said no.
      let res: Response;
      try {
        res = await fetch(presign.data.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
      } catch {
        setError('Could not reach object storage — the upload never left the browser (network or CORS). The buyer can still be created without a logo.');
        return;
      }
      if (!res.ok) {
        setError(`Upload rejected by object storage (${res.status}). The buyer can still be created without a logo.`);
        return;
      }
      setPreview(URL.createObjectURL(file));
      setLogoKey(presign.data.storageKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Logo upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={fieldLabel}>Logo</label>
      {/* The durable key — never the presigned preview URL. */}
      <input type="hidden" name="logoUrl" value={logoKey} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: 8, border: `1px solid ${ui.line}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Logo preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <ImageIcon size={16} color={ui.faint} />
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', border: `1px solid ${ui.line}`, borderRadius: 8, background: '#fff', color: ui.accent, fontSize: 12.5, fontWeight: 550, fontFamily: 'inherit', cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}
        >
          <Upload size={14} /> {uploading ? 'Uploading…' : logoKey ? 'Replace' : 'Upload logo'}
        </button>
        {logoKey !== '' && !uploading && (
          <button
            type="button"
            onClick={() => { setPreview(null); setLogoKey(''); setError(null); }}
            style={{ height: 32, padding: '0 12px', border: `1px solid ${ui.line}`, borderRadius: 8, background: '#fff', color: ui.sub, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer' }}
          >
            Remove
          </button>
        )}
      </div>
      {error && <div style={{ marginTop: 6, fontSize: 11.5, color: ui.danger, lineHeight: 1.4 }}>{error}</div>}
    </div>
  );
}

/**
 * Brand colour (INS-077): the native picker plus a synced hex field. The TEXT box
 * is what submits, so an invalid value actually reaches the API and its 400
 * surfaces — the picker can only ever emit #rrggbb, and is deliberately unnamed.
 */
function HexColorField({ defaultValue }: { defaultValue: string }) {
  const [hex, setHex] = useState(defaultValue);
  const [swatch, setSwatch] = useState(HEX_RE.test(defaultValue) ? defaultValue.toLowerCase() : ui.accent);
  const invalid = hex.trim() !== '' && !HEX_RE.test(hex.trim());
  return (
    <div>
      <label style={fieldLabel}>Brand Color</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="color"
          aria-label="Pick brand color"
          value={swatch}
          onChange={(e) => { setHex(e.target.value); setSwatch(e.target.value); }}
          style={{ width: 44, height: 34, padding: '2px 4px', border: `1px solid ${ui.line}`, borderRadius: 8, cursor: 'pointer', flexShrink: 0 }}
        />
        <input
          name="primaryColor"
          aria-label="Brand color hex value"
          value={hex}
          onChange={(e) => {
            setHex(e.target.value);
            if (HEX_RE.test(e.target.value.trim())) setSwatch(e.target.value.trim().toLowerCase());
          }}
          placeholder="#1457A3"
          spellCheck={false}
          style={{ ...boxInput, ...monoStyle, border: `1px solid ${invalid ? ui.danger : ui.line}` }}
        />
      </div>
      {invalid && <div style={{ marginTop: 4, fontSize: 11, color: ui.danger }}>Expected #RRGGBB.</div>}
    </div>
  );
}

/**
 * Supplier GPS (INS-071): a structured numeric pair. Replaces a single hand-typed
 * JSON field whose JSON.parse sat in an EMPTY catch, so a mistyped brace saved the
 * supplier with no coordinates and no error. Range checks stay on the API.
 */
function GpsFields({ lat, lng }: { lat?: number; lng?: number }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={fieldLabel}>GPS coordinates</label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <input name="lat" type="number" step="any" min={-90} max={90} inputMode="decimal" aria-label="Latitude"
          defaultValue={lat === undefined ? '' : String(lat)} placeholder="Latitude (−90…90)" style={{ ...boxInput, ...monoStyle }} />
        <input name="lng" type="number" step="any" min={-180} max={180} inputMode="decimal" aria-label="Longitude"
          defaultValue={lng === undefined ? '' : String(lng)} placeholder="Longitude (−180…180)" style={{ ...boxInput, ...monoStyle }} />
      </div>
      <div style={{ fontSize: 11, color: ui.faint, marginTop: 5 }}>Decimal degrees — leave both blank for no pin.</div>
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
                <LogoUploadField />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <HexColorField defaultValue={ui.accent} />
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
                  // INS-072: render from the API's short-lived presigned GET (or a
                  // legacy absolute URL). `logoUrl` itself is now an object key and
                  // is NOT fetchable — using it directly would show a broken image.
                  const logoSrc = logoSrcOf(b);
                  return (
                    <tr key={b.id} style={{ cursor: 'pointer', opacity: b.archivedAt ? 0.6 : 1 }} onClick={() => { if (!menuOpen) window.location.href = `/buyers/${b.id}`; }}>
                      <td style={td}>
                        {logoSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logoSrc} alt={b.name} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'contain', border: `1px solid ${ui.lineSoft}` }} />
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
                <GpsFields />
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
                    {/* INS-071: the real coordinates, not a "Pinned" badge that hid a wrong pin. */}
                    <td style={td}>
                      {s.gps ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <MapPin size={13} color={ui.accent} />
                          <Mono style={{ fontSize: 12, color: ui.sub }}>{coord(s.gps.lat)}, {coord(s.gps.lng)}</Mono>
                        </span>
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
