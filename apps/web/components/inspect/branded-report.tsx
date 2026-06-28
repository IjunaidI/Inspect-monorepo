import type { CSSProperties, ReactNode } from 'react';
import { Check, Lock, X } from 'lucide-react';
import { Mono, SeverityTag, UnverifiedBadge } from './shell';
import { aqlPlan, mono, severity, ui, type SeverityKey } from './tokens';
import type { ApiPhoto, ApiMeasurement } from '@/lib/api';

export interface BrandedReportData {
  buyer: {
    name: string;
    initials: string;
    color: string;
    loc?: string | null;
  };
  meta: {
    reportNo?: string | null;
    po: string;
    product: string;
    sku?: string | null;
    supplier: string;
    supplierLoc?: string | null;
    inspector?: string | null;
    type: string;
    date: string;
    gps?: string | null;
  };
  conclusion: 'pass' | 'fail' | 'hold';
  qaRemarks?: string | null;
  samplingPlan?: {
    sampleSize: number;
    codeLetter: string;
    lotSize: number;
  } | null;
  classes: {
    sev: 'critical' | 'major' | 'minor';
    aql: number | string;
    found: number;
    ac: number;
    re: number;
  }[];
  photos?: {
    loop: string;
    shots: ApiPhoto[];
    flaggedCount: number;
  }[];
  measurements?: {
    loop: string;
    items: ApiMeasurement[];
  }[];
  tamperProof?: {
    contentHash?: string | null;
    signedBy?: string | null;
    signedAt?: string | null;
  } | null;
}

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

export function BrandedReport({
  data,
  width = 900,
}: {
  data: BrandedReportData;
  width?: number | string;
}) {
  const b = data.buyer;
  const m = data.meta;
  const C = b.color;
  const fail = data.conclusion === 'fail';
  const hold = data.conclusion === 'hold';

  const metaPairs: [string, string, boolean][] = [
    ['Purchase order', m.po, true],
    ['Product', m.product, false],
    ['Style / SKU', m.sku ?? '—', true],
    ['Supplier', [m.supplier, m.supplierLoc].filter(Boolean).join(' · ') || '—', false],
    ['Inspector', m.inspector ?? '—', false],
    ['Inspection type', m.type, false],
    ['Date', m.date, true],
    ['Location (GPS)', m.gps ?? '—', true],
  ];

  const kv = (k: string, v: string, isMono: boolean) => (
    <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10.5, color: ui.faint, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{k}</span>
      <span style={{ fontSize: 13, color: ui.ink, fontWeight: 500, ...(isMono ? mono : {}) }}>{v}</span>
    </div>
  );

  const conclusionColor = fail ? severity.critical.fg : hold ? '#B5791A' : '#1F6B43';
  const conclusionBg = fail ? severity.critical.bg : hold ? '#FAF1E2' : '#EAF6F0';
  const conclusionBorder = fail ? '#F1C9C5' : hold ? '#EBD9B4' : '#BEE3CD';
  const conclusionLabel = fail ? 'REJECTED' : hold ? 'HOLD' : 'ACCEPTED';
  const conclusionIcon = fail || hold ? <X size={17} color="#fff" /> : <Check size={17} color="#fff" />;
  const conclusionDot = fail ? severity.critical.dot : hold ? '#B5791A' : '#1F8A4C';

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
            <div style={{ ...mono, fontSize: 14, fontWeight: 600, marginTop: 2 }}>{m.reportNo ?? '—'}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 48px', display: 'flex', alignItems: 'center', gap: 14, background: conclusionBg, borderBottom: `1px solid ${conclusionBorder}` }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: conclusionDot, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {conclusionIcon}
        </div>
        <div>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: conclusionColor, textTransform: 'uppercase', letterSpacing: 0.6 }}>QA conclusion</span>
          <div style={{ fontSize: 17, fontWeight: 700, color: conclusionColor, letterSpacing: -0.2 }}>{conclusionLabel}</div>
        </div>
        {data.qaRemarks && (
          <div style={{ marginLeft: 'auto', fontSize: 12, color: ui.sub, textAlign: 'right', maxWidth: 320 }}>
            {data.qaRemarks}
          </div>
        )}
      </div>

      <div style={{ padding: '8px 48px 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '18px 24px', paddingTop: 24 }}>
          {metaPairs.map(([k, v, isMono]) => kv(k, v, isMono))}
        </div>

        <ReportSection no={1} title="Sampling plan (AQL)" color={C} right={<span style={{ fontSize: 11, color: ui.faint }}>ANSI/ASQ Z1.4 · single, normal</span>}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {([
              ['Level', aqlPlan.level],
              ['Code letter', data.samplingPlan?.codeLetter ?? aqlPlan.codeLetter],
              ['Lot size', data.samplingPlan?.lotSize != null ? String(data.samplingPlan.lotSize) : '—'],
              ['Sample size', data.samplingPlan?.sampleSize != null ? String(data.samplingPlan.sampleSize) : aqlPlan.sampleSize],
            ] as const).map(([k, v]) => (
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
            {data.classes.map((c) => {
              const rej = c.found >= c.re;
              return (
                <div key={c.sev} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr 1.1fr', alignItems: 'center', padding: '11px 14px', borderTop: `1px solid ${ui.lineSoft}` }}>
                  <span><SeverityTag sev={c.sev} /></span>
                  <Mono style={{ textAlign: 'right', fontSize: 12.5, color: ui.sub }}>{String(c.aql)}</Mono>
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
            {(['Quantity verified', 'Result'] as const).map((k, i) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: i < 1 ? `1px solid ${ui.lineSoft}` : 'none', fontSize: 13 }}>
                <span style={{ color: ui.sub, flex: 1 }}>{k}</span>
                <span style={{ fontWeight: 600, ...(i < 1 ? mono : {}), color: i === 1 ? '#1F8A4C' : ui.ink } as CSSProperties}>
                  {i === 0 ? (data.samplingPlan?.lotSize != null ? `${data.samplingPlan.lotSize} pcs` : '—') : 'See AQL'}
                </span>
              </div>
            ))}
          </ReportSection>

          <ReportSection no={3} title="Defect summary" color={C}>
            {data.classes.map((c, i) => (
              <div key={c.sev} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: i < 2 ? `1px solid ${ui.lineSoft}` : 'none' }}>
                <SeverityTag sev={c.sev} />
                <Mono style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 700, color: c.found >= c.re ? severity.critical.fg : ui.ink }}>{c.found}</Mono>
              </div>
            ))}
            <div style={{ marginTop: 8, fontSize: 11.5, color: ui.faint }}>Defects found within the sample.</div>
          </ReportSection>
        </div>

        {/* Photo evidence */}
        {data.photos && data.photos.length > 0 && (
          <ReportSection no={4} title="Photo evidence" color={C} right={<UnverifiedBadge />}>
            {data.photos.map((row, ri) => (
              <div key={row.loop} style={{ marginBottom: ri < data.photos!.length - 1 ? 18 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{row.loop}</span>
                  {row.flaggedCount > 0 && <SeverityTag sev="major" dot={false}>{row.flaggedCount} major flagged</SeverityTag>}
                </div>
                {row.shots.length === 0 ? (
                  <div style={{ fontSize: 12, color: ui.faint, fontStyle: 'italic' }}>No photos uploaded yet (MinIO/INS-023 pending).</div>
                ) : (
                  <div style={{ display: 'flex', gap: 12 }}>
                    {row.shots.map((photo, i) => (
                      <div key={photo.id} style={{ flex: 1, borderRadius: 8, overflow: 'hidden', border: `1px solid ${ui.line}` }}>
                        <div style={{ position: 'relative', height: 96, background: 'linear-gradient(135deg,#BFC8D2,#7E8794)' }}>
                          <div style={{ position: 'absolute', top: 6, left: 6 }}><UnverifiedBadge /></div>
                        </div>
                        <div style={{ padding: '6px 8px', fontSize: 10.5, color: ui.sub, ...mono }}>{String(i + 1).padStart(2, '0')} · {photo.storageKey.slice(-8)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </ReportSection>
        )}

        {/* Measurement sheet */}
        {data.measurements && data.measurements.length > 0 && (
          <ReportSection no={5} title="Measurement sheet" color={C} right={<span style={{ fontSize: 11, color: ui.faint }}>Free-form · as recorded</span>}>
            <div style={{ border: `1px solid ${ui.line}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', padding: '9px 14px', fontSize: 10.5, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill }}>
                <span>Point</span><span style={{ textAlign: 'right' }}>Recorded</span><span style={{ textAlign: 'right' }}>Unit</span>
              </div>
              {data.measurements.flatMap((row) =>
                row.items.map((m) => (
                  <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', alignItems: 'center', padding: '10px 14px', borderTop: `1px solid ${ui.lineSoft}`, fontSize: 12.5 }}>
                    <span>{m.label}</span>
                    <Mono style={{ textAlign: 'right', fontWeight: 600, color: ui.ink }}>{m.recordedValue ?? '—'}</Mono>
                    <Mono style={{ textAlign: 'right', color: ui.sub }}>{m.unit ?? '—'}</Mono>
                  </div>
                ))
              )}
            </div>
          </ReportSection>
        )}

        {/* Tamper-proof footer */}
        <div style={{ marginTop: 30, background: ui.lineSoft, border: `1px solid ${ui.line}`, borderRadius: 10, padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Lock size={18} color={ui.sub} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>Tamper-proof record</div>
            <div style={{ display: 'flex', gap: 20, marginTop: 6 }}>
              <div>
                <span style={{ fontSize: 10.5, color: ui.faint }}>Content hash (SHA-256)</span>
                <div style={{ ...mono, fontSize: 11.5, color: ui.ink, marginTop: 1 }}>{data.tamperProof?.contentHash ?? '—'}</div>
              </div>
              <div>
                <span style={{ fontSize: 10.5, color: ui.faint }}>Signed by (Ed25519)</span>
                <div style={{ fontSize: 11.5, color: ui.ink, marginTop: 1 }}>
                  {data.tamperProof?.signedBy ?? '—'}{data.tamperProof?.signedAt ? ` · ${data.tamperProof.signedAt.slice(0, 10)}` : ''}
                </div>
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10.5, color: ui.faint }}>Status</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: ui.ink }}>Immutable · v1</div>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 10.5, color: ui.faint, textAlign: 'center' }}>
          Generated by Inspect · {data.buyer.name} · This report is read-only. Corrections are issued as a new linked re-inspection.
        </div>
      </div>
    </div>
  );
}
