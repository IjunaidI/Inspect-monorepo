import { ChevronRight, ClipboardList } from 'lucide-react';
import { apiGet, type ApiInspection } from '@/lib/api';
import { Mono, PageHead, SeverityTag } from '@/components/inspect/shell';
import { severity, ui, type SeverityKey } from '@/components/inspect/tokens';
import { DecisionForm, SubmitForReview } from './decision-panel';

const SUBMITTABLE = new Set(['DRAFT', 'ASSIGNED', 'IN_PROGRESS']);
const DECIDABLE = new Set(['SUBMITTED', 'UNDER_REVIEW', 'HOLD']);
const CLASSES: SeverityKey[] = ['critical', 'major', 'minor'];

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let inspection: ApiInspection | null = null;
  try {
    inspection = await apiGet<ApiInspection>(`/inspections/${id}`);
  } catch {
    inspection = null;
  }
  if (!inspection) {
    return <div style={{ padding: '24px 32px' }}>Inspection not found, or you are not signed in.</div>;
  }
  const r = inspection.aqlResult;
  const fail = r?.systemRecommendation === 'FAIL';

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <ClipboardList size={15} color={ui.sub} />
        <span>Inspections</span>
        <ChevronRight size={14} color={ui.faint} />
        <Mono style={{ color: ui.ink, fontWeight: 600 }}>{inspection.purchaseOrder?.poNumber ?? id.slice(0, 8)}</Mono>
        <ChevronRight size={14} color={ui.faint} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>Review</span>
      </div>

      <PageHead
        title="Report review"
        sub={`${inspection.buyer?.name ?? '—'} · ${inspection.product?.styleNumber ?? '—'} · status ${inspection.status}`}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 24, marginTop: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {r ? (
            <>
              <div style={{ borderRadius: 12, padding: 20, background: fail ? severity.critical.bg : '#EAF6F0', border: `1px solid ${fail ? '#F1C9C5' : '#BEE3CD'}` }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: fail ? severity.critical.fg : '#1F6B43', textTransform: 'uppercase', letterSpacing: 0.6 }}>System recommendation</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: fail ? severity.critical.fg : '#1F6B43', marginTop: 2 }}>{r.systemRecommendation}</div>
                <div style={{ fontSize: 12.5, color: ui.sub, marginTop: 4 }}>
                  Sample n <Mono style={{ fontWeight: 600 }}>{inspection.computedSampling?.sampleSize ?? '—'}</Mono> · code {inspection.computedSampling?.sampleSizeCodeLetter ?? '—'} · lot <Mono>{inspection.lotSize ?? '—'}</Mono>
                </div>
              </div>
              <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1.1fr', padding: '8px 20px', fontSize: 11, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill, borderBottom: `1px solid ${ui.line}` }}>
                  <span>Class</span><span style={{ textAlign: 'right' }}>Found</span><span style={{ textAlign: 'right' }}>Accept</span><span style={{ textAlign: 'right' }}>Reject</span><span style={{ textAlign: 'right' }}>Result</span>
                </div>
                {CLASSES.map((sev) => {
                  const c = r.perClass[sev];
                  const rej = c.outcome === 'FAIL';
                  return (
                    <div key={sev} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1.1fr', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${ui.lineSoft}` }}>
                      <SeverityTag sev={sev} />
                      <Mono style={{ textAlign: 'right', fontSize: 15, fontWeight: 700, color: rej ? severity.critical.fg : ui.ink }}>{c.found}</Mono>
                      <Mono style={{ textAlign: 'right', fontSize: 13, color: ui.sub }}>{c.ac}</Mono>
                      <Mono style={{ textAlign: 'right', fontSize: 13, color: ui.sub }}>{c.re}</Mono>
                      <span style={{ textAlign: 'right', justifySelf: 'end', fontSize: 11.5, fontWeight: 600, color: rej ? severity.critical.fg : '#1F8A4C' }}>{rej ? 'Reject' : 'Accept'}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 22, color: ui.sub, fontSize: 13 }}>
              No AQL result yet — submit the inspection to compute the sampling evaluation.
            </div>
          )}
        </div>

        <div style={{ position: 'sticky', top: 0, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px', borderBottom: `1px solid ${ui.line}`, fontSize: 14, fontWeight: 600 }}>QA decision</div>
          {SUBMITTABLE.has(inspection.status) && <SubmitForReview id={id} />}
          {DECIDABLE.has(inspection.status) && <DecisionForm id={id} />}
          {!SUBMITTABLE.has(inspection.status) && !DECIDABLE.has(inspection.status) && (
            <div style={{ padding: 20, fontSize: 13, color: ui.sub }}>
              Final decision: <strong>{r?.qaDecision ?? inspection.status}</strong>
              {r?.qaRemarks ? <div style={{ marginTop: 8, color: ui.ink }}>{r.qaRemarks}</div> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
