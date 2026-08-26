'use client';

import { useActionState, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ui, mono, severity } from '@/components/inspect/tokens';
import { Spinner } from '@/components/inspect/loading';
import type { ApiPurchaseOrder, ApiLoopPreset, ApiUser, AqlPreview } from '@/lib/api';
import { createInspection, previewAql } from '../actions';

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const lbl: CSSProperties = { fontSize: 12, fontWeight: 550, color: ui.ink };
const input: CSSProperties = { height: 40, padding: '0 12px', fontSize: 13.5, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', color: ui.ink, outline: 'none', boxSizing: 'border-box' };
const card: CSSProperties = { background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 22 };
const eyebrow: CSSProperties = { fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5 };

type AqlClass = 'critical' | 'major' | 'minor';
const AQL_CLASSES: readonly AqlClass[] = ['critical', 'major', 'minor'];

/**
 * INS-063 — the per-class AQL values the API accepts. Mirrors ALLOWED_AQL_VALUES
 * in apps/api/src/inspections/aql-plan-input.ts, which DERIVES the set from the
 * verified ISO 2859-1 / Z1.4 acceptance grid: 0 ("any defect rejects") plus the
 * grid's columns. Offering anything else here would only earn a 400 — and the
 * inspection LEVEL stays locked to II, the only level with a verified table.
 */
const AQL_VALUES: readonly number[] = [0, 1.0, 1.5, 2.5, 4.0, 6.5];
/** Spec §8 MVP defaults — identical to DEFAULT_AQL on the API. */
const DEFAULT_AQL: Record<AqlClass, number> = { critical: 0, major: 2.5, minor: 4.0 };
/** FormData keys read back by the `createInspection` server action. */
const AQL_FIELD: Record<AqlClass, string> = { critical: 'aqlCritical', major: 'aqlMajor', minor: 'aqlMinor' };

const aqlOptionLabel = (v: number) => (v === 0 ? '0 · any defect rejects' : v.toFixed(1));

export function CreateInspectionForm({ pos, presets, inspectors }: { pos: ApiPurchaseOrder[]; presets: ApiLoopPreset[]; inspectors: ApiUser[] }) {
  const [state, action, pending] = useActionState(createInspection, {} as { error?: string });
  const [poId, setPoId] = useState(pos[0]?.id ?? '');
  const [lotSize, setLotSize] = useState(1000);
  const [aql, setAql] = useState<Record<AqlClass, number>>({ ...DEFAULT_AQL });
  const [preview, setPreview] = useState<AqlPreview>();
  const [previewError, setPreviewError] = useState<string>();
  const [crid] = useState(() => `web-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const po = pos.find((p) => p.id === poId);

  // The preview is driven by the SAME inputs the create POST sends, and the API
  // runs the same validation on both — so the panel can never show a plan the
  // create would reject. A combination the verified grid has no column for
  // (e.g. lot 100 -> code letter F at AQL 2.5) comes back as a 400 message:
  // clear the stale plan and show it inline rather than leaving a plan on
  // screen that no longer corresponds to the selection.
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await previewAql({ lotSize, ...aql });
      if (!live) return;
      setPreview(r.data);
      setPreviewError(r.error);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [lotSize, aql]);

  if (pos.length === 0) {
    return <div style={card}>No purchase orders yet. Create a buyer, supplier, product and PO first, then return here.</div>;
  }

  return (
    <form action={action} style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' }}>
      <input type="hidden" name="poId" value={poId} />
      <input type="hidden" name="lotSize" value={lotSize} />
      <input type="hidden" name="clientRequestId" value={crid} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={card}>
          <div style={eyebrow}>Purchase order</div>
          <div style={{ ...field, marginTop: 14 }}>
            <span style={lbl}>PO</span>
            <select value={poId} onChange={(e) => setPoId(e.target.value)} style={{ ...input, cursor: 'pointer' }}>
              {pos.map((p) => <option key={p.id} value={p.id}>{p.poNumber}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 18, marginTop: 14, fontSize: 13, color: ui.sub }}>
            <span>Client: <strong style={{ color: ui.ink }}>{po?.clientCompany?.name ?? '—'}</strong></span>
            <span>Factory: <strong style={{ color: ui.ink }}>{po?.factoryCompany?.name ?? '—'}</strong></span>
            <span>Product: <strong style={{ color: ui.ink }}>{po?.product?.styleNumber ?? '—'}</strong></span>
          </div>
        </div>

        <div style={card}>
          <div style={eyebrow}>Procedure &amp; lot</div>
          <div style={{ ...field, marginTop: 14 }}>
            <span style={lbl}>Loop preset</span>
            <select name="loopPresetId" defaultValue={presets[0]?.id ?? ''} style={{ ...input, cursor: 'pointer' }}>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <div style={field}>
              <span style={lbl}>Lot size (pcs)</span>
              <input type="number" min={2} value={lotSize} onChange={(e) => setLotSize(Number(e.target.value))} style={{ ...input, ...mono }} />
            </div>
            <div style={field}>
              <span style={lbl}>Assigned inspector <span style={{ color: ui.faint, fontWeight: 400 }}>· optional</span></span>
              <select name="assignedInspectorId" defaultValue="" style={{ ...input, cursor: 'pointer' }}>
                <option value="">Unassigned (draft)</option>
                {inspectors.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={card}>
          <div style={eyebrow}>Acceptance quality limits</div>
          <div style={{ fontSize: 12.5, color: ui.sub, marginTop: 8 }}>
            General inspection Level II, single sampling, normal severity. The level is fixed; the per-class
            AQL is the QA Manager&apos;s call and is frozen onto the inspection at creation.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginTop: 14 }}>
            {AQL_CLASSES.map((sev) => (
              <div key={sev} style={field}>
                <span style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: severity[sev].dot }} />
                  {severity[sev].label} AQL
                </span>
                <select
                  name={AQL_FIELD[sev]}
                  value={String(aql[sev])}
                  onChange={(e) => setAql((prev) => ({ ...prev, [sev]: Number(e.target.value) }))}
                  style={{ ...input, ...mono, cursor: 'pointer' }}
                >
                  {AQL_VALUES.map((v) => (
                    <option key={v} value={String(v)}>{aqlOptionLabel(v)}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {previewError && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: ui.danger }}>{previewError}</div>
          )}
        </div>

        {state?.error && <div style={{ color: ui.danger, fontSize: 13 }}>{state.error}</div>}
        <div>
          <button type="submit" disabled={pending} aria-busy={pending || undefined} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, padding: '0 16px', background: ui.accent, color: '#fff', borderWidth: 0, borderStyle: 'solid', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.7 : 1 }}>
            {pending && <Spinner size={13} />}
            {pending ? 'Creating…' : 'Create inspection'}
          </button>
        </div>
      </div>

      <div style={{ background: ui.ink, borderRadius: 12, padding: '18px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Computed AQL plan</div>
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>Level II · single sampling · normal</div>
        {previewError ? (
          <div style={{ color: '#F49A9A', fontSize: 12.5, marginTop: 12 }}>{previewError}</div>
        ) : preview ? (
          <>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              {[['Code', preview.sampleSizeCodeLetter], ['Sample n', preview.sampleSize]].map(([k, v]) => (
                <div key={k} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>{k}</div>
                  <div style={{ ...mono, fontSize: 20, fontWeight: 600, color: '#fff', marginTop: 3 }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', padding: '0 0 6px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'rgba(255,255,255,0.45)' }}>
                <span>Class</span>
                <span style={{ width: 52, textAlign: 'right' }}>AQL</span>
                <span style={{ width: 44, textAlign: 'right' }}>Ac</span>
                <span style={{ width: 44, textAlign: 'right' }}>Re</span>
              </div>
              {AQL_CLASSES.map((sev) => {
                const c = preview.perClass?.[sev];
                if (!c) return null;
                return (
                  <div key={sev} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', padding: '8px 0', fontSize: 12.5, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <span style={{ textTransform: 'capitalize' }}>{sev}</span>
                    <span style={{ ...mono, width: 52, textAlign: 'right', color: 'rgba(255,255,255,0.7)' }}>{c.aql === 0 ? '0' : c.aql.toFixed(1)}</span>
                    <span style={{ ...mono, width: 44, textAlign: 'right', color: '#6FE39A' }}>{c.ac}</span>
                    <span style={{ ...mono, width: 44, textAlign: 'right', color: '#F49A9A' }}>{c.re}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12.5, marginTop: 12 }}>Enter a lot size…</div>
        )}
      </div>
    </form>
  );
}
