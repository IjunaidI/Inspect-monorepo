'use client';

import { useActionState, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ui, mono } from '@/components/inspect/tokens';
import type { ApiPurchaseOrder, ApiLoopPreset, ApiUser, AqlPreview } from '@/lib/api';
import { createInspection, previewAql } from '../actions';

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const lbl: CSSProperties = { fontSize: 12, fontWeight: 550, color: ui.ink };
const input: CSSProperties = { height: 40, padding: '0 12px', fontSize: 13.5, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', color: ui.ink, outline: 'none', boxSizing: 'border-box' };
const card: CSSProperties = { background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 22 };

export function CreateInspectionForm({ pos, presets, inspectors }: { pos: ApiPurchaseOrder[]; presets: ApiLoopPreset[]; inspectors: ApiUser[] }) {
  const [state, action, pending] = useActionState(createInspection, {} as { error?: string });
  const [poId, setPoId] = useState(pos[0]?.id ?? '');
  const [lotSize, setLotSize] = useState(1000);
  const [preview, setPreview] = useState<AqlPreview>();
  const [previewError, setPreviewError] = useState<string>();
  const [crid] = useState(() => `web-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const po = pos.find((p) => p.id === poId);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await previewAql({ lotSize });
      if (!live) return;
      setPreview(r.data);
      setPreviewError(r.error);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [lotSize]);

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
          <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>Purchase order</div>
          <div style={{ ...field, marginTop: 14 }}>
            <span style={lbl}>PO</span>
            <select value={poId} onChange={(e) => setPoId(e.target.value)} style={{ ...input, cursor: 'pointer' }}>
              {pos.map((p) => <option key={p.id} value={p.id}>{p.poNumber}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 18, marginTop: 14, fontSize: 13, color: ui.sub }}>
            <span>Buyer: <strong style={{ color: ui.ink }}>{po?.buyer?.name ?? '—'}</strong></span>
            <span>Supplier: <strong style={{ color: ui.ink }}>{po?.supplier?.name ?? '—'}</strong></span>
            <span>Product: <strong style={{ color: ui.ink }}>{po?.product?.styleNumber ?? '—'}</strong></span>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>Procedure & lot</div>
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

        {state?.error && <div style={{ color: '#B42318', fontSize: 13 }}>{state.error}</div>}
        <div>
          <button type="submit" disabled={pending} style={{ height: 40, padding: '0 16px', background: ui.accent, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.7 : 1 }}>
            {pending ? 'Creating…' : 'Create inspection'}
          </button>
        </div>
      </div>

      <div style={{ background: ui.ink, borderRadius: 12, padding: '18px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Computed AQL plan</div>
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
              {(['critical', 'major', 'minor'] as const).map((sev) => {
                const c = preview.perClass[sev];
                return (
                  <div key={sev} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', padding: '8px 0', fontSize: 12.5, color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <span style={{ textTransform: 'capitalize' }}>{sev}</span>
                    <span style={{ ...mono, width: 52, textAlign: 'right', color: 'rgba(255,255,255,0.7)' }}>{c.aql}</span>
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
