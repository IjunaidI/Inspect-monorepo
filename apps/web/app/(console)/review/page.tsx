import { Check, ChevronRight, ClipboardList, Eye, Lock, X } from 'lucide-react';
import { Btn, Mono, PageHead, RoleBadge, SeverityTag, UnverifiedBadge } from '@/components/inspect/shell';
import { severity, ui, type SeverityKey } from '@/components/inspect/tokens';

const reviewClasses: { sev: SeverityKey; found: number; ac: number; re: number }[] = [
  { sev: 'critical', found: 0, ac: 0, re: 1 },
  { sev: 'major', found: 9, ac: 7, re: 8 },
  { sev: 'minor', found: 6, ac: 10, re: 11 },
];
const isReject = (c: { found: number; re: number }) => c.found >= c.re;
const systemFail = reviewClasses.some(isReject);
const decision = 'fail';

const decisionOptions = [
  { k: 'pass', label: 'Pass', desc: 'Release the lot. Overrides the system flag.', color: '#1F8A4C', bg: '#EAF6F0', bd: '#BEE3CD' },
  { k: 'fail', label: 'Fail', desc: 'Reject the lot. Matches system recommendation.', color: severity.critical.fg, bg: severity.critical.bg, bd: '#F1C9C5' },
  { k: 'hold', label: 'Hold', desc: 'Pause for clarification or re-inspection.', color: severity.major.fg, bg: severity.major.bg, bd: '#EBD9B4' },
];

export default function ReviewPage() {
  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <ClipboardList size={15} color={ui.sub} />
        <span>Inspections</span>
        <ChevronRight size={14} color={ui.faint} />
        <Mono style={{ color: ui.ink, fontWeight: 600 }}>PO-2026-04812</Mono>
        <ChevronRight size={14} color={ui.faint} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>Review</span>
      </div>

      <PageHead
        title="Report review"
        sub="Pre-shipment · Nordvik Retail Group · Tirupur Knits Unit-3"
        actions={<Btn kind="ghost" icon={<Eye size={15} />}>Preview report</Btn>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 24, marginTop: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ borderRadius: 12, padding: 20, display: 'flex', alignItems: 'center', gap: 18, background: systemFail ? severity.critical.bg : '#EAF6F0', border: `1px solid ${systemFail ? '#F1C9C5' : '#BEE3CD'}` }}>
            <div style={{ width: 52, height: 52, borderRadius: 12, flexShrink: 0, background: systemFail ? severity.critical.dot : '#1F8A4C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {systemFail ? <X size={26} color="#fff" /> : <Check size={26} color="#fff" />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: systemFail ? severity.critical.fg : '#1F6B43', textTransform: 'uppercase', letterSpacing: 0.6 }}>System recommendation</div>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.3, color: systemFail ? severity.critical.fg : '#1F6B43', marginTop: 2 }}>{systemFail ? 'FAIL' : 'PASS'}</div>
              <div style={{ fontSize: 13, color: ui.ink, marginTop: 4 }}>
                Major defects <Mono style={{ fontWeight: 600 }}>9</Mono> reach the Reject point <Mono style={{ fontWeight: 600 }}>8</Mono> — the lot fails the Major class.
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: ui.sub }}>Sample inspected</div>
              <Mono style={{ fontSize: 22, fontWeight: 600 }}>200</Mono>
              <div style={{ fontSize: 11, color: ui.faint }}>of <Mono>3,200</Mono> · code L</div>
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>AQL evaluation by class</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: ui.faint }}>Level II · single sampling, normal</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1.1fr', padding: '8px 20px', fontSize: 11, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill, borderTop: `1px solid ${ui.line}`, borderBottom: `1px solid ${ui.line}` }}>
              <span>Class</span>
              <span style={{ textAlign: 'right' }}>Found</span>
              <span style={{ textAlign: 'right' }}>Accept</span>
              <span style={{ textAlign: 'right' }}>Reject</span>
              <span style={{ textAlign: 'right' }}>Result</span>
            </div>
            {reviewClasses.map((c) => {
              const rej = isReject(c);
              return (
                <div key={c.sev} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1.1fr', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${ui.lineSoft}` }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SeverityTag sev={c.sev} /></span>
                  <Mono style={{ textAlign: 'right', fontSize: 15, fontWeight: 700, color: rej ? severity.critical.fg : ui.ink }}>{c.found}</Mono>
                  <Mono style={{ textAlign: 'right', fontSize: 13, color: ui.sub }}>{c.ac}</Mono>
                  <Mono style={{ textAlign: 'right', fontSize: 13, color: ui.sub }}>{c.re}</Mono>
                  <span style={{ textAlign: 'right', justifySelf: 'end' }}>
                    {rej ? (
                      <SeverityTag sev="critical" dot={false}>Reject</SeverityTag>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#1F8A4C', fontWeight: 600 }}><Check size={13} color="#1F8A4C" /> Accept</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Evidence collected</div>
              {([['Loops completed', '6 / 6'], ['Photos uploaded', '28'], ['Measurements out of tol.', '1']] as const).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', padding: '7px 0', fontSize: 13 }}>
                  <span style={{ color: ui.sub, flex: 1 }}>{k}</span>
                  <Mono style={{ fontWeight: 600 }}>{v}</Mono>
                </div>
              ))}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${ui.lineSoft}` }}>
                <UnverifiedBadge />
                <div style={{ fontSize: 11, color: ui.faint, marginTop: 6, lineHeight: 1.4 }}>All photos are desktop uploads in this MVP. Mobile-verified capture arrives in Phase 2.</div>
              </div>
            </div>
            <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Quantity / carton check</div>
              {([['Cartons presented', '128'], ['Cartons opened', '13'], ['Qty verified', '3,200']] as const).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', padding: '7px 0', fontSize: 13 }}>
                  <span style={{ color: ui.sub, flex: 1 }}>{k}</span>
                  <Mono style={{ fontWeight: 600 }}>{v}</Mono>
                </div>
              ))}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${ui.lineSoft}`, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#1F8A4C', fontWeight: 600 }}>
                <Check size={14} color="#1F8A4C" /> Quantities match PO
              </div>
            </div>
          </div>
        </div>

        <div style={{ position: 'sticky', top: 0, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px', borderBottom: `1px solid ${ui.line}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>QA decision</span>
              <RoleBadge role="qa" style={{ marginLeft: 'auto' }} />
            </div>
            <div style={{ fontSize: 12, color: ui.sub, marginTop: 4 }}>This is the binding verdict for the whole inspection.</div>
          </div>

          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {decisionOptions.map((o) => {
              const sel = o.k === decision;
              return (
                <label key={o.k} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 10, cursor: 'pointer', background: sel ? o.bg : '#fff', border: `1px solid ${sel ? o.bd : ui.line}`, boxShadow: sel ? `inset 0 0 0 1px ${o.bd}` : 'none' }}>
                  <span style={{ width: 18, height: 18, borderRadius: 999, marginTop: 1, border: `1.5px solid ${sel ? o.color : '#C8D0DA'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {sel && <span style={{ width: 8, height: 8, borderRadius: 999, background: o.color }} />}
                  </span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: sel ? o.color : ui.ink }}>{o.label}</div>
                    <div style={{ fontSize: 12, color: ui.sub, marginTop: 2, lineHeight: 1.45 }}>{o.desc}</div>
                  </div>
                </label>
              );
            })}

            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 550, marginBottom: 6 }}>Decision note <span style={{ color: severity.critical.fg }}>*</span></div>
              <textarea
                defaultValue="Major defect count reaches reject point — primarily skewed collars across 3 cartons. Recommending re-work and re-inspection."
                style={{ width: '100%', height: 76, padding: 12, fontSize: 13, lineHeight: 1.5, resize: 'none', boxSizing: 'border-box', background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', color: ui.ink, outline: 'none' }}
              />
            </div>

            <button style={{ height: 44, background: ui.accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', marginTop: 4, cursor: 'pointer' }}>
              Submit decision
            </button>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11.5, color: ui.faint, lineHeight: 1.45 }}>
              <Lock size={13} color={ui.faint} style={{ marginTop: 1, flexShrink: 0 }} />
              Submitting locks the report and notifies the buyer. Corrections require a new linked re-inspection.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
