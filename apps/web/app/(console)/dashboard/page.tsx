import type { CSSProperties } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, MapPin, MoreVertical, Plus, Search } from 'lucide-react';
import { Avatar, Btn, Mono, PageHead } from '@/components/inspect/shell';
import { mono, ui } from '@/components/inspect/tokens';

const dirData = {
  buyers: [
    { initials: 'NV', brand: '#1457A3', name: 'Nordvik Retail Group', loc: 'Oslo, Norway', pos: 14, products: 38, reports: 26, last: '12 min ago' },
    { initials: 'MA', brand: '#0B7D6B', name: 'Maison Adèle', loc: 'Paris, France', pos: 9, products: 22, reports: 18, last: '2 hours ago' },
    { initials: 'BL', brand: '#C2410C', name: 'Beaumont Living', loc: 'London, UK', pos: 6, products: 17, reports: 9, last: 'Yesterday' },
    { initials: 'KT', brand: '#7C3AED', name: 'Kestrel & Thorne', loc: 'New York, USA', pos: 11, products: 41, reports: 31, last: '4 hours ago' },
    { initials: 'HF', brand: '#B5791A', name: 'Hudson & Field', loc: 'Toronto, Canada', pos: 4, products: 12, reports: 12, last: '3 days ago' },
    { initials: 'SU', brand: '#0B1220', name: 'Sundsvall Home', loc: 'Stockholm, Sweden', pos: 7, products: 19, reports: 7, last: '1 hour ago' },
  ],
  suppliers: [
    { initials: 'TK', name: 'Tirupur Knits Unit-3', loc: 'Tirupur, India', gps: true, buyers: 5, pos: 18, open: 3, last: '38 min ago' },
    { initials: 'DW', name: 'Dhaka Weave Ltd.', loc: 'Dhaka, Bangladesh', gps: true, buyers: 3, pos: 11, open: 2, last: '3 hours ago' },
    { initials: 'KH', name: 'Karachi Home Mills', loc: 'Karachi, Pakistan', gps: false, buyers: 2, pos: 6, open: 0, last: 'Yesterday' },
    { initials: 'HN', name: 'Hanoi Apparel Co.', loc: 'Hanoi, Vietnam', gps: true, buyers: 4, pos: 14, open: 1, last: '5 hours ago' },
  ],
};

const th: CSSProperties = {
  fontSize: 11, fontWeight: 550, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4,
  padding: '13px 20px', textAlign: 'left', borderBottom: `1px solid ${ui.line}`, background: ui.fill,
};
const td: CSSProperties = { padding: '15px 20px', fontSize: 13, color: ui.ink, borderBottom: `1px solid ${ui.lineSoft}`, verticalAlign: 'middle' };
const chip = (active: boolean): CSSProperties => ({
  height: 30, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 6,
  border: `1px solid ${active ? ui.ink : ui.line}`, background: active ? ui.ink : '#fff',
  color: active ? '#fff' : ui.sub, borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer',
});

export default function DashboardPage() {
  const tab = 'buyers';
  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title="Buyers & Suppliers"
        sub="Buyers receive branded reports. Suppliers are the factories you inspect. Linked by POs and products."
        actions={
          <>
            <Btn kind="ghost">Import CSV</Btn>
            <Btn kind="primary" icon={<Plus size={15} />}>Add Buyer</Btn>
          </>
        }
      />

      <div style={{ display: 'flex', gap: 24, marginTop: 22, borderBottom: `1px solid ${ui.line}` }}>
        {([['buyers', 'Buyers', 6], ['suppliers', 'Suppliers / Factories', 6]] as const).map(([k, l, n]) => {
          const on = k === tab;
          return (
            <div
              key={k}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px 12px', marginBottom: -1,
                borderBottom: `2px solid ${on ? ui.accent : 'transparent'}`, color: on ? ui.ink : ui.sub,
                fontWeight: on ? 600 : 500, fontSize: 14, cursor: 'pointer',
              }}
            >
              {l}
              <span style={{ ...mono, fontSize: 11, padding: '1px 7px', borderRadius: 999, background: on ? ui.accentSoft : ui.lineSoft, color: on ? ui.accent : ui.faint }}>
                {n}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0 16px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={15} color={ui.faint} style={{ position: 'absolute', left: 12, top: 10.5 }} />
          <input
            style={{ width: 340, height: 36, padding: '0 12px 0 36px', fontSize: 13, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none' }}
            placeholder="Search buyers by name or city…"
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={chip(true)}>All <Mono style={{ opacity: 0.7 }}>6</Mono></div>
          <div style={chip(false)}>Active <Mono style={{ opacity: 0.7 }}>5</Mono></div>
          <div style={chip(false)}>Archived <Mono style={{ opacity: 0.7 }}>1</Mono></div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 12.5 }}>
          <span>Sort by</span>
          <Btn kind="ghost" small>Last activity <ChevronDown size={14} color={ui.sub} /></Btn>
        </div>
      </div>

      <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 56 }} />
              <th style={th}>Buyer</th>
              <th style={th}>Report branding</th>
              <th style={{ ...th, textAlign: 'right' }}>Open POs</th>
              <th style={{ ...th, textAlign: 'right' }}>Products</th>
              <th style={{ ...th, textAlign: 'right' }}>Reports</th>
              <th style={th}>Last activity</th>
              <th style={{ ...th, width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {dirData.buyers.map((b, i) => (
              <tr key={b.name} style={i === 0 ? { background: '#F8FAFC' } : undefined}>
                <td style={td}>
                  <div style={{ width: 32, height: 32, borderRadius: 6, background: b.brand, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>
                    {b.initials}
                  </div>
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 550 }}>{b.name}</div>
                  <div style={{ color: ui.faint, fontSize: 12, marginTop: 2 }}>{b.loc}</div>
                </td>
                <td style={td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: b.brand, border: '1px solid rgba(0,0,0,0.08)' }} />
                    <Mono style={{ fontSize: 12, color: ui.sub }}>{b.brand.toUpperCase()}</Mono>
                    <span style={{ fontSize: 11.5, color: ui.faint }}>· logo set</span>
                  </div>
                </td>
                <td style={{ ...td, ...mono, textAlign: 'right' }}>{String(b.pos).padStart(2, '0')}</td>
                <td style={{ ...td, ...mono, textAlign: 'right' }}>{String(b.products).padStart(2, '0')}</td>
                <td style={{ ...td, ...mono, textAlign: 'right' }}>{String(b.reports).padStart(2, '0')}</td>
                <td style={{ ...td, color: ui.sub }}>{b.last}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center', color: ui.faint }}>
                    <MoreVertical size={16} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: `1px solid ${ui.lineSoft}`, color: ui.sub, fontSize: 12.5 }}>
          <span>Showing <Mono>1–6</Mono> of <Mono>6</Mono> buyers</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${ui.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ui.faint }}>
              <ChevronLeft size={14} />
            </div>
            <div style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${ui.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ChevronRight size={14} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Suppliers / Factories</div>
          <span style={{ ...mono, fontSize: 11, marginLeft: 8, padding: '1px 7px', borderRadius: 999, background: ui.lineSoft, color: ui.faint }}>6</span>
          <Btn kind="ghost" small icon={<Plus size={14} />} style={{ marginLeft: 'auto' }}>Add Supplier</Btn>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 56 }} />
                <th style={th}>Factory</th>
                <th style={th}>GPS</th>
                <th style={{ ...th, textAlign: 'right' }}>Buyers</th>
                <th style={{ ...th, textAlign: 'right' }}>POs</th>
                <th style={{ ...th, textAlign: 'right' }}>Open insp.</th>
                <th style={th}>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {dirData.suppliers.map((s) => (
                <tr key={s.name}>
                  <td style={td}><Avatar initials={s.initials} size={32} bg="#475467" /></td>
                  <td style={td}>
                    <div style={{ fontWeight: 550 }}>{s.name}</div>
                    <div style={{ color: ui.faint, fontSize: 12, marginTop: 2 }}>{s.loc}</div>
                  </td>
                  <td style={td}>
                    {s.gps ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#1F8A4C' }}>
                        <MapPin size={13} color="#1F8A4C" /> Pinned
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: ui.faint }}>—</span>
                    )}
                  </td>
                  <td style={{ ...td, ...mono, textAlign: 'right' }}>{String(s.buyers).padStart(2, '0')}</td>
                  <td style={{ ...td, ...mono, textAlign: 'right' }}>{String(s.pos).padStart(2, '0')}</td>
                  <td style={{ ...td, ...mono, textAlign: 'right' }}>{String(s.open).padStart(2, '0')}</td>
                  <td style={{ ...td, color: ui.sub }}>{s.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
