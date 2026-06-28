'use client';

import { useActionState, useTransition } from 'react';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import type { ApiBuyer, ApiLoopPreset } from '@/lib/api';
import { archiveBuyer, updateBuyer } from '../../dashboard/actions';

const label = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 };
const input = { width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const };
const row = { marginBottom: 16 };

export function EditBuyerForm({ buyer, presets }: { buyer: ApiBuyer; presets: ApiLoopPreset[] }) {
  const [state, action, pending] = useActionState(updateBuyer, {});
  const [archivePending, startArchive] = useTransition();

  return (
    <div style={{ marginTop: 24, maxWidth: 520 }}>
      <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
        <form action={action}>
          <input type="hidden" name="id" value={buyer.id} />
          {state.error && (
            <div style={{ marginBottom: 14, padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: '#DC2626' }}>
              {state.error}
            </div>
          )}
          <div style={row}>
            <label style={label}>Name *</label>
            <input name="name" defaultValue={buyer.name} style={input} required />
          </div>
          <div style={row}>
            <label style={label}>Logo URL</label>
            <input name="logoUrl" defaultValue={buyer.logoUrl ?? ''} placeholder="https://…" style={input} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={label}>Brand Color</label>
              <input name="primaryColor" type="color" defaultValue={buyer.primaryColor ?? '#037BF4'}
                style={{ width: '100%', height: 36, padding: '2px 4px', border: `1px solid ${ui.line}`, borderRadius: 8, cursor: 'pointer' }} />
            </div>
            <div>
              <label style={label}>Default Preset</label>
              <select name="defaultLoopPresetId" defaultValue={buyer.defaultLoopPresetId ?? ''}
                style={{ width: '100%', height: 36, padding: '0 8px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8 }}>
                <option value="">None</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn kind="ghost" href="/dashboard">Cancel</Btn>
            <Btn kind="primary" type="submit" style={{ opacity: pending ? 0.65 : 1 }}>
              {pending ? 'Saving…' : 'Save changes'}
            </Btn>
          </div>
        </form>
      </div>

      <div style={{ marginTop: 24, padding: '18px 20px', background: '#FFF8F8', border: '1px solid #FECACA', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#DC2626' }}>Archive buyer</div>
        <div style={{ fontSize: 12.5, color: ui.sub, marginBottom: 12 }}>Archiving removes this buyer from the active list. Historical inspections and reports are preserved.</div>
        <button
          onClick={() => startArchive(async () => { await archiveBuyer(buyer.id); })}
          disabled={archivePending}
          style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: 'inherit', border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: archivePending ? 'default' : 'pointer', opacity: archivePending ? 0.6 : 1 }}
        >
          {archivePending ? 'Archiving…' : 'Archive buyer'}
        </button>
      </div>
    </div>
  );
}
