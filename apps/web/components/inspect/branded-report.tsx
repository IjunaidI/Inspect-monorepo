import type { CSSProperties, ReactNode } from 'react';
import { Check, Lock, Minus, Upload, X } from 'lucide-react';
import { report, type SeverityKey } from '@inspect/design-tokens';
import { Mono } from './shell';
import { mono, ui } from './tokens';
import type { ApiMeasurement } from '@/lib/api';

/**
 * Photo evidence tile input. `viewUrl` is the short-lived presigned GET URL
 * (INS-049) — when set the tile renders the real thumbnail; the gradient
 * placeholder remains only for photos with no viewable URL. Console photos
 * (ApiPhoto) and guest-portal photos (no storageKey) both satisfy this shape.
 */
export interface ReportPhoto {
  id: string;
  storageKey?: string | null;
  viewUrl?: string | null;
  /** The loop item this shot fills (e.g. "Right sleeve"); shown as the tile caption when set. */
  label?: string | null;
}

export interface BrandedReportData {
  client: {
    name: string;
    initials: string;
    color: string;
    loc?: string | null;
  };
  meta: {
    reportNo?: string | null;
    po: string;
    product: string;
    factory: string;
    factoryLoc?: string | null;
    inspector?: string | null;
    type: string;
    date: string;
    gps?: string | null;
  };
  conclusion: 'pass' | 'fail' | 'hold' | 'pending';
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
  /**
   * Evidence rows in CAPTURE order. The console builds one row per inspected
   * unit ("Unit 1", "Unit 2", ...) holding that unit's item shots in loop
   * position order (INS-081 cycles); the guest portal, which has no slot data,
   * passes a single flat row. `loop` is the row heading either way.
   */
  photos?: {
    loop: string;
    shots: ReportPhoto[];
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

/**
 * The report's own severity tag and photo badge (INS-094 D5). They look like the
 * console shell's tags but read the FROZEN `report` palette, so a theme change
 * never re-colours a document.
 */
function ReportSeverityTag({ sev, children, dot = true }: { sev: SeverityKey; children?: ReactNode; dot?: boolean }) {
  const s = report.severity[sev];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: s.bg, color: s.fg }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />}
      {children ?? s.label}
    </span>
  );
}

/** Every MVP photo is an Admin desktop upload — badged unverified (spec §9). Same wording as the console's badge. */
function ReportUnverifiedBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: report.amberBg, color: report.amber }}>
      <Upload size={11} />
      Manually uploaded · unverified
    </span>
  );
}

function ReportSection({ no, title, color, children, right }: { no: number; title: string; color: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: `2px solid ${color}` }}>
        <span style={{ ...mono, fontSize: 11, fontWeight: 600, color }}>{String(no).padStart(2, '0')}</span>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.2, textTransform: 'uppercase', color: report.ink }}>{title}</span>
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
  const b = data.client;
  const m = data.meta;
  const C = b.color;
  const fail = data.conclusion === 'fail';
  const hold = data.conclusion === 'hold';
  const pending = data.conclusion === 'pending';

  const metaPairs: [string, string, boolean][] = [
    ['Purchase order', m.po, true],
    ['Product', m.product, false],
    ['Factory', [m.factory, m.factoryLoc].filter(Boolean).join(' · ') || '—', false],
    ['Inspector', m.inspector ?? '—', false],
    ['Inspection type', m.type, false],
    ['Date', m.date, true],
    ['Location (GPS)', m.gps ?? '—', true],
  ];

  const kv = (k: string, v: string, isMono: boolean) => (
    <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10.5, color: report.faint, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{k}</span>
      <span style={{ fontSize: 13, color: report.ink, fontWeight: 500, ...(isMono ? mono : {}) }}>{v}</span>
    </div>
  );

  const conclusionColor = pending ? report.sub : fail ? report.critical : hold ? report.amber : report.pass;
  const conclusionBg = pending ? report.fill : fail ? report.criticalBg : hold ? report.amberBg : report.passBg;
  const conclusionBorder = pending ? report.line : fail ? report.criticalBorder : hold ? report.amberBorder : report.passBorder;
  const conclusionLabel = pending ? 'PENDING QA DECISION' : fail ? 'REJECTED' : hold ? 'HOLD' : 'ACCEPTED';
  const conclusionIcon = pending ? <Minus size={17} color={report.white} /> : fail || hold ? <X size={17} color={report.white} /> : <Check size={17} color={report.white} />;
  const conclusionDot = pending ? report.faint : fail ? report.criticalDot : hold ? report.amber : report.passDot;

  return (
    <div style={{ width, background: report.white, fontFamily: ui.font, color: report.ink, boxSizing: 'border-box', fontFeatureSettings: report.fontFeatureSettings }}>
      <div style={{ background: C, padding: '28px 48px 24px', color: report.white }}>
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
          <div style={{ marginLeft: 'auto', fontSize: 12, color: report.sub, textAlign: 'right', maxWidth: 320 }}>
            {data.qaRemarks}
          </div>
        )}
      </div>

      <div style={{ padding: '8px 48px 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '18px 24px', paddingTop: 24 }}>
          {metaPairs.map(([k, v, isMono]) => kv(k, v, isMono))}
        </div>

        <ReportSection no={1} title="Sampling plan (AQL)" color={C} right={<span style={{ fontSize: 11, color: report.faint }}>ANSI/ASQ Z1.4 · single, normal</span>}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {/* No demo-token fallback: a missing sampling plan renders an honest "—". */}
            {([
              ['Level', data.samplingPlan ? 'II' : '—'],
              ['Code letter', data.samplingPlan?.codeLetter ?? '—'],
              ['Lot size', data.samplingPlan?.lotSize != null ? String(data.samplingPlan.lotSize) : '—'],
              ['Sample size', data.samplingPlan?.sampleSize != null ? String(data.samplingPlan.sampleSize) : '—'],
            ] as const).map(([k, v]) => (
              <div key={k} style={{ flex: 1, background: report.fill, border: `1px solid ${report.line}`, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: report.faint, textTransform: 'uppercase', letterSpacing: 0.5 }}>{k}</div>
                <div style={{ ...mono, fontSize: 17, fontWeight: 600, marginTop: 3 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ border: `1px solid ${report.line}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr 1.1fr', padding: '9px 14px', fontSize: 10.5, color: report.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: report.fill }}>
              <span>Class</span><span style={{ textAlign: 'right' }}>AQL</span><span style={{ textAlign: 'right' }}>Found</span><span style={{ textAlign: 'right' }}>Ac</span><span style={{ textAlign: 'right' }}>Re</span><span style={{ textAlign: 'right' }}>Result</span>
            </div>
            {data.classes.map((c) => {
              const rej = c.found >= c.re;
              return (
                <div key={c.sev} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr 1.1fr', alignItems: 'center', padding: '11px 14px', borderTop: `1px solid ${report.lineSoft}` }}>
                  <span><ReportSeverityTag sev={c.sev} /></span>
                  <Mono style={{ textAlign: 'right', fontSize: 12.5, color: report.sub }}>{String(c.aql)}</Mono>
                  <Mono style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 700, color: rej ? report.critical : report.ink }}>{c.found}</Mono>
                  <Mono style={{ textAlign: 'right', fontSize: 12.5, color: report.sub }}>{c.ac}</Mono>
                  <Mono style={{ textAlign: 'right', fontSize: 12.5, color: report.sub }}>{c.re}</Mono>
                  <span style={{ textAlign: 'right', justifySelf: 'end' }}>{rej ? <ReportSeverityTag sev="critical" dot={false}>Reject</ReportSeverityTag> : <span style={{ fontSize: 11.5, color: report.passDot, fontWeight: 600 }}>Accept</span>}</span>
                </div>
              );
            })}
          </div>
        </ReportSection>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
          <ReportSection no={2} title="Quantity & carton check" color={C}>
            {(['Quantity verified', 'Result'] as const).map((k, i) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: i < 1 ? `1px solid ${report.lineSoft}` : 'none', fontSize: 13 }}>
                <span style={{ color: report.sub, flex: 1 }}>{k}</span>
                <span style={{ fontWeight: 600, ...(i < 1 ? mono : {}), color: i === 1 ? report.passDot : report.ink } as CSSProperties}>
                  {i === 0 ? (data.samplingPlan?.lotSize != null ? `${data.samplingPlan.lotSize} pcs` : '—') : 'See AQL'}
                </span>
              </div>
            ))}
          </ReportSection>

          <ReportSection no={3} title="Defect summary" color={C}>
            {data.classes.map((c, i) => (
              <div key={c.sev} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: i < 2 ? `1px solid ${report.lineSoft}` : 'none' }}>
                <ReportSeverityTag sev={c.sev} />
                <Mono style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 700, color: c.found >= c.re ? report.critical : report.ink }}>{c.found}</Mono>
              </div>
            ))}
            <div style={{ marginTop: 8, fontSize: 11.5, color: report.faint }}>Defects found within the sample.</div>
          </ReportSection>
        </div>

        {/* Photo evidence */}
        {data.photos && data.photos.length > 0 && (
          <ReportSection no={4} title="Photo evidence" color={C} right={<ReportUnverifiedBadge />}>
            {data.photos.map((row, ri) => (
              <div key={row.loop} style={{ marginBottom: ri < data.photos!.length - 1 ? 18 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{row.loop}</span>
                  {row.flaggedCount > 0 && <ReportSeverityTag sev="major" dot={false}>{row.flaggedCount} major flagged</ReportSeverityTag>}
                </div>
                {row.shots.length === 0 ? (
                  <div style={{ fontSize: 12, color: report.faint, fontStyle: 'italic' }}>No photos uploaded yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    {row.shots.map((photo, i) => (
                      <div key={photo.id} style={{ flex: '1 1 150px', maxWidth: 260, borderRadius: 8, overflow: 'hidden', border: `1px solid ${report.line}` }}>
                        {/* Real thumbnail when a presigned viewUrl exists (INS-049); gradient placeholder otherwise. */}
                        <div style={{ position: 'relative', height: 96, background: `linear-gradient(135deg,${report.photoPlaceholderFrom},${report.photoPlaceholderTo})` }}>
                          {photo.viewUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={photo.viewUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          )}
                          <div style={{ position: 'absolute', top: 6, left: 6 }}><ReportUnverifiedBadge /></div>
                        </div>
                        {/* Item name when the slot is known; the storage-key tail is the fallback for flat (portal) rows. */}
                        <div style={{ padding: '6px 8px', fontSize: 10.5, color: report.sub, ...mono, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {String(i + 1).padStart(2, '0')} · {photo.label ?? (photo.storageKey ?? photo.id).slice(-8)}
                        </div>
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
          <ReportSection no={5} title="Measurement sheet" color={C} right={<span style={{ fontSize: 11, color: report.faint }}>Free-form · as recorded</span>}>
            <div style={{ border: `1px solid ${report.line}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', padding: '9px 14px', fontSize: 10.5, color: report.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: report.fill }}>
                <span>Point</span><span style={{ textAlign: 'right' }}>Recorded</span><span style={{ textAlign: 'right' }}>Unit</span>
              </div>
              {data.measurements.flatMap((row) =>
                row.items.map((m) => (
                  <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', alignItems: 'center', padding: '10px 14px', borderTop: `1px solid ${report.lineSoft}`, fontSize: 12.5 }}>
                    <span>{m.label}</span>
                    <Mono style={{ textAlign: 'right', fontWeight: 600, color: report.ink }}>{m.recordedValue ?? '—'}</Mono>
                    <Mono style={{ textAlign: 'right', color: report.sub }}>{m.unit ?? '—'}</Mono>
                  </div>
                ))
              )}
            </div>
          </ReportSection>
        )}

        {/* Tamper-proof footer */}
        <div style={{ marginTop: 30, background: report.lineSoft, border: `1px solid ${report.line}`, borderRadius: 10, padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Lock size={18} color={report.sub} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: report.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>Tamper-proof record</div>
            <div style={{ display: 'flex', gap: 20, marginTop: 6 }}>
              <div>
                <span style={{ fontSize: 10.5, color: report.faint }}>Content hash (SHA-256)</span>
                <div style={{ ...mono, fontSize: 11.5, color: report.ink, marginTop: 1 }}>{data.tamperProof?.contentHash ?? '—'}</div>
              </div>
              <div>
                <span style={{ fontSize: 10.5, color: report.faint }}>Signed by (Ed25519)</span>
                <div style={{ fontSize: 11.5, color: report.ink, marginTop: 1 }}>
                  {data.tamperProof?.signedBy ?? '—'}{data.tamperProof?.signedAt ? ` · ${data.tamperProof.signedAt.slice(0, 10)}` : ''}
                </div>
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10.5, color: report.faint }}>Status</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: report.ink }}>Immutable</div>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 10.5, color: report.faint, textAlign: 'center' }}>
          Generated by Inspect · {data.client.name} · This report is read-only. Corrections are issued as a new linked re-inspection.
        </div>
      </div>
    </div>
  );
}
