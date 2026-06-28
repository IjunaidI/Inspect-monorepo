import type { CSSProperties } from 'react';
import { Download, Eye, Lock, Search } from 'lucide-react';
import { Mono } from '@/components/inspect/shell';
import { BrandedReport, type BrandedReportData } from '@/components/inspect/branded-report';
import { severity, ui } from '@/components/inspect/tokens';

const portalBuyer = { name: 'Nordvik Retail Group', initials: 'NV', color: '#1457A3' };
const portalReportNo = 'IR-2026-04812-F';

const previewData: BrandedReportData = {
  buyer: { ...portalBuyer, loc: 'Oslo, Norway' },
  meta: {
    reportNo: portalReportNo,
    po: 'PO-2026-04812',
    product: "Men's Knit Polo Shirt",
    sku: 'NV-KP-2241',
    supplier: 'Tirupur Knits Unit-3',
    supplierLoc: 'Tirupur, India',
    inspector: 'Deepak Menon',
    type: 'Pre-shipment (FRI)',
    date: '2026-05-09',
    gps: '11.1085° N, 77.3411° E',
  },
  conclusion: 'fail',
  classes: [
    { sev: 'critical', aql: 0, found: 0, ac: 0, re: 1 },
    { sev: 'major', aql: 2.5, found: 9, ac: 7, re: 8 },
    { sev: 'minor', aql: 4.0, found: 6, ac: 10, re: 11 },
  ],
};

type PortalStatus = 'pass' | 'fail' | 'hold';
const reports: { no: string; po: string; product: string; type: string; date: string; status: PortalStatus; active?: boolean }[] = [
  { no: 'IR-2026-04812-F', po: 'PO-2026-04812', product: "Men's Knit Polo Shirt", type: 'Pre-shipment', date: '2026-05-09', status: 'fail', active: true },
  { no: 'IR-2026-04790-F', po: 'PO-2026-04790', product: 'Oxford Shirt', type: 'Pre-shipment', date: '2026-05-02', status: 'pass' },
  { no: 'IR-2026-04755-M', po: 'PO-2026-04755', product: 'Linen Trouser', type: 'Pre-shipment', date: '2026-04-24', status: 'pass' },
  { no: 'IR-2026-04712-F', po: 'PO-2026-04712', product: 'Knit Beanie', type: 'Pre-shipment', date: '2026-04-18', status: 'hold' },
];
const statusChip: Record<PortalStatus, { label: string; fg: string; bg: string }> = {
  pass: { label: 'Accepted', fg: '#1F6B43', bg: '#EAF6F0' },
  fail: { label: 'Rejected', fg: severity.critical.fg, bg: severity.critical.bg },
  hold: { label: 'On hold', fg: severity.major.fg, bg: severity.major.bg },
};

const chipStyle = (sc: { fg: string; bg: string }): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 600, background: sc.bg, color: sc.fg,
});

export default function GuestPortalPage() {
  const b = portalBuyer;
  const C = b.color;
  return (
    <div style={{ height: '100vh', background: '#EEF1F5', fontFamily: ui.font, fontSize: 13, color: ui.ink, display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: 60, background: C, display: 'flex', alignItems: 'center', padding: '0 28px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>{b.initials}</div>
          <div style={{ color: '#fff' }}>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{b.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>Inspection reports</div>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 500, background: 'rgba(255,255,255,0.16)', color: '#fff' }}>
            <Eye size={13} color="#fff" /> Guest · read-only
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#fff' }}>
            <div style={{ width: 30, height: 30, borderRadius: 999, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>LE</div>
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>Lars Eriksen</div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.75)' }}>Buyer guest</div>
            </div>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: 360, background: '#fff', borderRight: `1px solid ${ui.line}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '20px 20px 14px', borderBottom: `1px solid ${ui.line}` }}>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Your reports</div>
            <div style={{ fontSize: 12.5, color: ui.sub, marginTop: 2 }}>Showing reports for {b.name} only</div>
            <div style={{ position: 'relative', marginTop: 14 }}>
              <Search size={15} color={ui.faint} style={{ position: 'absolute', left: 12, top: 10.5 }} />
              <input style={{ width: '100%', height: 36, padding: '0 12px 0 36px', fontSize: 13, background: ui.bg, border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} placeholder="Search by PO or product…" />
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {reports.map((r) => {
              const sc = statusChip[r.status];
              return (
                <div key={r.no} style={{ padding: 14, borderRadius: 10, marginBottom: 8, cursor: 'pointer', background: r.active ? ui.accentSoft : '#fff', border: `1px solid ${r.active ? '#CFE5FD' : ui.line}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Mono style={{ fontSize: 12, fontWeight: 600 }}>{r.po}</Mono>
                    <span style={{ marginLeft: 'auto', ...chipStyle(sc) }}>{sc.label}</span>
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 550, marginTop: 7 }}>{r.product}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 11.5, color: ui.faint }}>
                    <span>{r.type}</span><span>·</span><Mono>{r.date}</Mono>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${ui.line}`, fontSize: 11, color: ui.faint, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Lock size={12} color={ui.faint} /> You can view and download. Reports are read-only.
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 52, background: '#fff', borderBottom: `1px solid ${ui.line}`, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 12, flexShrink: 0 }}>
            <Mono style={{ fontSize: 12.5, fontWeight: 600 }}>{portalReportNo}</Mono>
            <span style={chipStyle(statusChip.fail)}>Rejected</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 11px', borderRadius: 8, fontWeight: 550, fontSize: 12.5, cursor: 'pointer', background: '#fff', color: ui.ink, border: `1px solid ${ui.line}`, fontFamily: 'inherit' }}>
                <Download size={14} /> Download PDF
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 28, display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: 760, maxWidth: '100%', boxShadow: '0 4px 24px rgba(11,18,32,0.12)', borderRadius: 8, overflow: 'hidden', height: 'fit-content', flexShrink: 0 }}>
              <BrandedReport data={previewData} width="100%" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
