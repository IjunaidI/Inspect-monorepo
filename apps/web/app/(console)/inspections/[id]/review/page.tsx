import { ClipboardList, ImageOff } from 'lucide-react';
import { auth } from '@/lib/auth';
import { apiRoleAtLeast } from '@/lib/roles';
import { apiGet, type ApiInspection } from '@/lib/api';
import { groupPhotosByUnit } from '@/lib/photo-evidence';
import { Btn, Mono, PageHead, SeverityTag } from '@/components/inspect/shell';
import { Breadcrumb } from '@/components/inspect/breadcrumb';
import { severity, ui, type SeverityKey } from '@/components/inspect/tokens';
import { DecisionForm, SubmitForReview } from './decision-panel';
import { ReInspectButton } from './re-inspect-button';
import {
  DECIDABLE_STATUSES,
  REINSPECTABLE_STATUSES,
  REPORTABLE_STATUSES,
  SUBMITTABLE_STATUSES,
} from '@inspect/domain';

// The status transition sets are declared ONCE in @inspect/domain (INS-086
// Phase 3/4) — the API's guards and the mobile review screen read the same
// tables, so the three surfaces cannot drift.
const SUBMITTABLE = new Set<string>(SUBMITTABLE_STATUSES);
const DECIDABLE = new Set<string>(DECIDABLE_STATUSES);
// Populate is legal exactly while submit still is — the lock boundary.
const POPULATABLE = new Set<string>(SUBMITTABLE_STATUSES);
const REPORTABLE = new Set<string>(REPORTABLE_STATUSES);
const REINSPECTABLE = new Set<string>(REINSPECTABLE_STATUSES);
const CLASSES: SeverityKey[] = ['critical', 'major', 'minor'];

/**
 * INS-092: the evidence, in capture order — units as the inspector shot them,
 * and inside a unit the loop items by position. Read-only; every photo here is
 * already on the GET /inspections/:id payload (`items[].photos[]`), and
 * `viewUrl` is the API's short-lived presigned GET (INS-049) — null when the
 * presign failed, which renders as a neutral placeholder rather than a broken
 * image. `cycleIndex` is 0-based in storage and may have gaps after a discard;
 * the unit number shown is cycleIndex + 1, so a gap stays visible as one.
 */
function PhotoEvidence({ inspection }: { inspection: ApiInspection }) {
  const items = inspection.items ?? [];
  const units = groupPhotosByUnit(items);
  const total = inspection.cycleState?.totalPhotos ?? units.reduce((n, u) => n + u.slots.filter((s) => s.photo).length, 0);

  return (
    <section aria-labelledby="photo-evidence" style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '14px 20px', borderBottom: `1px solid ${ui.line}` }}>
        <h2 id="photo-evidence" style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Photo evidence</h2>
        <span style={{ fontSize: 12, color: ui.sub }}>
          <Mono>{units.length}</Mono> unit{units.length === 1 ? '' : 's'} · <Mono>{total}</Mono> photo{total === 1 ? '' : 's'} · in capture order
        </span>
      </div>
      {units.length === 0 ? (
        <div style={{ padding: 20, fontSize: 13, color: ui.sub }}>
          {items.length === 0 ? 'This inspection has no loop items.' : 'No photos captured yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {units.map((unit, i) => (
            <div key={unit.cycleIndex} style={{ padding: '14px 20px', borderTop: i === 0 ? 'none' : `1px solid ${ui.lineSoft}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: ui.ink }}>Unit {unit.unitNumber}</span>
                {unit.slots.some((s) => !s.photo) && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: severity.major.fg, background: severity.major.bg, padding: '1px 7px', borderRadius: 4 }}>
                    Partial
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 10 }}>
                {unit.slots.map(({ item, photo }) => (
                  <figure key={item.id} style={{ margin: 0 }}>
                    <div style={{ aspectRatio: '4 / 3', borderRadius: 8, border: `1px solid ${ui.lineSoft}`, background: ui.fill, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {photo?.viewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL; not an optimisable static asset
                        <img src={photo.viewUrl} alt={`Unit ${unit.unitNumber} — ${item.itemName}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <ImageOff size={18} color={ui.faint} aria-label={photo ? 'Preview unavailable' : 'Not captured'} />
                      )}
                    </div>
                    <figcaption style={{ marginTop: 5, fontSize: 11.5, color: photo ? ui.ink : ui.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.itemName}>
                      <Mono style={{ color: ui.faint, marginRight: 5 }}>{String(item.position + 1).padStart(2, '0')}</Mono>
                      {item.itemName}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = (await auth()) as unknown as { role?: string } | null;
  const role = session?.role;
  // Web-side UX gate only (INS-057 relaxed GET /inspections/:id to INSPECTOR,
  // so an inspector can land here) — the API remains the RBAC authority on
  // POST /:id/decision, the populate screen, and POST /inspections.
  const canDecide = apiRoleAtLeast(role, 'QA_MANAGER');
  // INS-083: populate dropped from a PLATFORM_ADMIN floor to INSPECTOR, so the
  // Populate link is offered to anyone who can capture. The API still decides
  // whether this particular inspection is theirs to touch.
  const canPopulate = apiRoleAtLeast(role, 'INSPECTOR');

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
  const showDecisionForm = DECIDABLE.has(inspection.status) && canDecide;
  const showPopulateLink = POPULATABLE.has(inspection.status) && canPopulate;
  const showReInspect = REINSPECTABLE.has(inspection.status) && canDecide;

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <Breadcrumb
        icon={<ClipboardList size={15} color={ui.sub} />}
        items={[
          { label: 'Inspections', href: '/inspections' },
          { label: inspection.purchaseOrder?.poNumber ?? id.slice(0, 8), mono: true },
          { label: 'Review' },
        ]}
        style={{ marginBottom: 14 }}
      />

      <PageHead
        title="Report review"
        sub={`${inspection.clientCompany?.name ?? '—'} · ${inspection.product?.styleNumber ?? '—'} · status ${inspection.status}`}
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

          <PhotoEvidence inspection={inspection} />
        </div>

        <div style={{ position: 'sticky', top: 0, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px', borderBottom: `1px solid ${ui.line}`, fontSize: 14, fontWeight: 600 }}>QA decision</div>
          {SUBMITTABLE.has(inspection.status) && <SubmitForReview id={id} />}
          {showDecisionForm && <DecisionForm id={id} />}
          {!SUBMITTABLE.has(inspection.status) && !showDecisionForm && (
            <div style={{ padding: 20, fontSize: 13, color: ui.sub }}>
              {DECIDABLE.has(inspection.status) ? (
                'Awaiting QA Manager review.'
              ) : (
                <>
                  Final decision: <strong>{r?.qaDecision ?? inspection.status}</strong>
                  {r?.qaRemarks ? <div style={{ marginTop: 8, color: ui.ink }}>{r.qaRemarks}</div> : null}
                </>
              )}
            </div>
          )}

          {/* Contextual action links */}
          <div style={{ padding: '12px 20px', borderTop: `1px solid ${ui.line}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {showPopulateLink && (
              <Btn kind="ghost" href={`/inspections/${id}/populate`}>
                Populate photos &amp; defects
              </Btn>
            )}
            {REPORTABLE.has(inspection.status) && (
              <Btn kind="ghost" href={`/inspections/${id}/report`}>
                View / generate report
              </Btn>
            )}
            {showReInspect && (
              <ReInspectButton id={id} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
