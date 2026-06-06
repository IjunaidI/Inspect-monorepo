import type { CSSProperties, ReactNode } from 'react';
import { Check, Lock, X } from 'lucide-react';
import { Mono, SeverityTag, UnverifiedBadge } from './shell';
import { aqlPlan, mono, severity, ui, type SeverityKey } from './tokens';

export const reportData = {
  buyer: { name: 'Nordvik Retail Group', initials: 'NV', color: '#1457A3', loc: 'Oslo, Norway' },
  meta: {
    reportNo: 'IR-2026-04812-F',
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
  conclusion: 'fail' as 'fail' | 'pass',
};

const reportClasses: { sev: SeverityKey; found: number; ac: number; re: number }[] = [
  { sev: 'critical', found: 0, ac: 0, re: 1 },
  { sev: 'major', found: 9, ac: 7, re: 8 },
  { sev: 'minor', found: 6, ac: 10, re: 11 },
];

function ReportSection({ no, title, color, children, right }: { no: number; title: string; color: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: `2px solid ${color}` }}>
        <span style={{ ...mono, fontSize: 11, fontWeight: 600, color }}>{String(no).padStart(2, '0')}</span>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.2, textTransform: 'uppercase', color: ui.ink }}>{title}</span>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      <div style={{ paddingTop: 14 }}>{children}</div>
    </div>
  );
}

export function BrandedReport({ width = 900 }: { width?: number | string }) {
  const b = reportData.buyer;
  const m = reportData.meta;
  const C = b.color;
  const fail = reportData.conclusion === 'fail';

  const metaPairs: [string, string, boolean][] = [
    ['Purchase order', m.po, true],
    ['Product', m.product, false],
    ['Style / SKU', m.sku, true],
    ['Supplier', `${m.supplier} · ${m.supplierLoc}`, false],
    ['Inspector', m.inspector, false],
    ['Inspection type', m.type, false],
    ['Date', m.date, true],
    ['Location (GPS)', m.gps, true],
  ];

  const kv = (k: string, v: string, isMono: boolean) => (
    <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10.5, color: ui.faint, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{k}</span>
      <span style={{ fontSize: 13, color: ui.ink, fontWeight: 500, ...(isMono ? mono : {}) }}>{v}</span>
    </div>
  );

  return (
    <div style={{ width, background: '#fff', fontFamily: ui.font, color: ui.ink, boxSizing: 'border-box', fontFeatureSettings: '"cv11", "ss01"' }}>
      <div style={{ background: C, padding: '28px 48px 24px', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 10, background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, letterSpacing: 0.5 }}>{b.initials}</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.2 }}>{b.name}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>Quality Inspection Report</div>
            </div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Report no.</div>
            <div style={{ ...mono, fontSize: 14, fontWeight: 600, marginTop: 2 }}>{m.reportNo}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 48px', display: 'flex', alignItems: 'center', gap: 14, background: fail ? severity.critical.bg : '#EAF6F0', borderBottom: `1px solid ${fail ? '#F1C9C5' : '#BEE3CD'}` }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: fail ? severity.critical.dot : '#1F8A4C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {fail ? <X size={17} color="#fff" /> : <Check size={17} color="#fff" />}
        </div>
        <div>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: fail ? severity.critical.fg : '#1F6B43', textTransform: 'uppercase', letterSpacing: 0.6 }}>QA conclusion</span>
          <div style={{ fontSize: 17, fontWeight: 700, color: fail ? severity.critical.fg : '#1F6B43', letterSpacing: -0.2 }}>{fail ? 'REJECTED' : 'ACCEPTED'}</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: ui.sub, textAlign: 'right', maxWidth: 320 }}>
          Major defect count reaches the reject point. Re-work and re-inspection required.
        </div>
      </div>

      <div style={{ padding: '8px 48px 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '18px 24px', paddingTop: 24 }}>
          {metaPairs.map(([k, v, isMono]) => kv(k, v, isMono))}
        </div>

        <ReportSection no={1} title="Sampling plan (AQL)" color={C} right={<span style={{ fontSize: 11, color: ui.faint }}>ANSI/ASQ Z1.4 · single, normal</span>}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {([['Level', aqlPlan.level], ['Code letter', aqlPlan.codeLetter], ['Lot size', '3,200'], ['Sample size', aqlPlan.sampleSize]] as const).map(([k, v]) => (
              <div key={k} style={{ flex: 1, background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: ui.faint, textTransform: 'uppercase', letterSpacing: 0.5 }}>{k}</div>
                <div style={{ ...mono, fontSize: 17, fontWeight: 600, marginTop: 3 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ border: `1px solid ${ui.line}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr 1.1fr', padding: '9px 14px', fontSize: 10.5, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill }}>
              <span>Class</span><span style={{ textAlign: 'right' }}>AQL</span><span style={{ textAlign: 'right' }}>Found</span><span style={{ textAlign: 'right' }}>Ac</span><span style={{ textAlign: 'right' }}>Re</span><span style={{ textAlign: 'right' }}>Result</span>
            </div>
            {reportClasses.map((c, i) => {
              const rej = c.found >= c.re;
              return (
                <div key={c.sev} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr 1.1fr', alignItems: 'center', padding: '11px 14px', borderTop: `1px solid ${ui.lineSoft}` }}>
                  <span><SeverityTag sev={c.sev} /></span>
                  <Mono style={{ textAlign: 'right', fontSize: 12.5, color: ui.sub }}>{aqlPlan.classes[i].aql}</Mono>
                  <Mono style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 700, color: rej ? severity.critical.fg : ui.ink }}>{c.found}</Mono>
                  <Mono style={{ textAlign: 'right', fontSize: 12.5, color: ui.sub }}>{c.ac}</Mono>
                  <Mono style={{ textAlign: 'right', fontSize: 12.5, color: ui.sub }}>{c.re}</Mono>
                  <span style={{ textAlign: 'right', justifySelf: 'end' }}>{rej ? <SeverityTag sev="critical" dot={false}>Reject</SeverityTag> : <span style={{ fontSize: 11.5, color: '#1F8A4C', fontWeight: 600 }}>Accept</span>}</span>
                </div>
              );
            })}
          </div>
        </ReportSection>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
          <ReportSection no={2} title="Quantity & carton check" color={C}>
            {([['Cartons presented', '128'], ['Cartons opened', '13'], ['Quantity verified', '3,200 pcs'], ['Result', 'Matches PO']] as const).map(([k, v], i) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: i < 3 ? `1px solid ${ui.lineSoft}` : 'none', fontSize: 13 }}>
                <span style={{ color: ui.sub, flex: 1 }}>{k}</span>
                <span style={{ fontWeight: 600, ...(i < 3 ? mono : {}), color: i === 3 ? '#1F8A4C' : ui.ink } as CSSProperties}>{v}</span>
              </div>
            ))}
          </ReportSection>

          <ReportSection no={3} title="Defect summary" color={C}>
            {reportClasses.map((c, i) => (
              <div key={c.sev} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: i < 2 ? `1px solid ${ui.lineSoft}` : 'none' }}>
                <SeverityTag sev={c.sev} />
                <Mono style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 700, color: c.found >= c.re ? severity.critical.fg : ui.ink }}>{c.found}</Mono>
              </div>
            ))}
            <div style={{ marginTop: 8, fontSize: 11.5, color: ui.faint }}>Defects found within the 200-pc sample.</div>
          </ReportSection>
        </div>

        <ReportSection no={4} title="Photo evidence" color={C} right={<UnverifiedBadge />}>
          {[
            { loop: 'Loop 01 · Fabric inspection', shots: ['#C8D0DA,#8C95A3', '#D2C9BE,#9A8E7E', '#BFC8D2,#7E8794', '#CBD2C5,#8B9483'], flagged: 0 },
            { loop: 'Loop 03 · Collar & neckline', shots: ['#C8D0DA,#8C95A3', '#D2C9BE,#9A8E7E', '#C4B7AA,#94806C'], flagged: 2 },
          ].map((row, ri) => (
            <div key={row.loop} style={{ marginBottom: ri === 0 ? 18 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{row.loop}</span>
                {row.flagged > 0 && <SeverityTag sev="major" dot={false}>{row.flagged} major flagged</SeverityTag>}
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                {row.shots.map((g, i) => (
                  <div key={i} style={{ flex: 1, borderRadius: 8, overflow: 'hidden', border: `1px solid ${ui.line}` }}>
                    <div style={{ position: 'relative', height: 96, background: `linear-gradient(135deg, ${g})` }}>
                      <div style={{ position: 'absolute', top: 6, left: 6 }}><UnverifiedBadge /></div>
                    </div>
                    <div style={{ padding: '6px 8px', fontSize: 10.5, color: ui.sub, ...mono }}>{String(i + 1).padStart(2, '0')} · {(96 + i).toString(16).toUpperCase()}KB</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </ReportSection>

        <ReportSection no={5} title="Measurement sheet" color={C} right={<span style={{ fontSize: 11, color: ui.faint }}>Free-form · as recorded</span>}>
          <div style={{ border: `1px solid ${ui.line}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', padding: '9px 14px', fontSize: 10.5, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill }}>
              <span>Point</span><span style={{ textAlign: 'right' }}>Recorded</span><span style={{ textAlign: 'right' }}>Unit</span>
            </div>
            {([['Collar point length', '7.4', 'in'], ['Collar spread', '11.3', 'in'], ['Stitch density', '8', 'spi'], ['Sleeve length', '23.1', 'in'], ['Fabric weight', '182', 'GSM']] as [string, string, string][]).map((m) => (
              <div key={m[0]} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', alignItems: 'center', padding: '10px 14px', borderTop: `1px solid ${ui.lineSoft}`, fontSize: 12.5 }}>
                <span>{m[0]}</span>
                <Mono style={{ textAlign: 'right', fontWeight: 600, color: ui.ink }}>{m[1]}</Mono>
                <Mono style={{ textAlign: 'right', color: ui.sub }}>{m[2]}</Mono>
              </div>
            ))}
          </div>
        </ReportSection>

        <ReportSection no={6} title="Workmanship & packaging notes" color={C}>
          <div style={{ fontSize: 13, color: '#344054', lineHeight: 1.6 }}>
            Collar alignment inconsistent across cartons 4–7; three units show visibly skewed collars. Stitch density on the placket measured below spec (8 spi vs 10). Packaging, polybags, and carton markings conform to buyer specification. Care labels present and correct.
          </div>
        </ReportSection>

        <div style={{ marginTop: 30, background: ui.lineSoft, border: `1px solid ${ui.line}`, borderRadius: 10, padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Lock size={18} color={ui.sub} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>Tamper-proof record</div>
            <div style={{ display: 'flex', gap: 20, marginTop: 6 }}>
              <div>
                <span style={{ fontSize: 10.5, color: ui.faint }}>Content hash (SHA-256)</span>
                <div style={{ ...mono, fontSize: 11.5, color: ui.ink, marginTop: 1 }}>a27f9c11·84e0·d3b6·5f02·c9a1</div>
              </div>
              <div>
                <span style={{ fontSize: 10.5, color: ui.faint }}>Signed by (Ed25519)</span>
                <div style={{ fontSize: 11.5, color: ui.ink, marginTop: 1 }}>Aisha Khan, QA Manager · {m.date}</div>
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10.5, color: ui.faint }}>Status</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: ui.ink }}>Immutable · v1</div>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 10.5, color: ui.faint, textAlign: 'center' }}>
          Generated by Inspect · {reportData.buyer.name} · This report is read-only. Corrections are issued as a new linked re-inspection.
        </div>
      </div>
    </div>
  );
}
