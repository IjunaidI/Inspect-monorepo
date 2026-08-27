'use client';

import { useActionState, useTransition } from 'react';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import type { ApiProduct } from '@/lib/api';
import { archiveProduct, updateProduct } from '../actions';

const label = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 };
const input = { width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const };
/** INS-074: room to write — a real multi-paragraph box the user can drag taller. */
const textarea = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 13,
  lineHeight: 1.6,
  fontFamily: 'inherit',
  color: ui.ink,
  border: `1px solid ${ui.line}`,
  borderRadius: 8,
  outline: 'none',
  resize: 'vertical' as const,
  minHeight: 132,
  boxSizing: 'border-box' as const,
};

export function EditProductForm({ product }: { product: ApiProduct }) {
  const [state, action, pending] = useActionState(updateProduct, {});
  const [archivePending, startArchive] = useTransition();

  return (
    <div style={{ marginTop: 24, maxWidth: 640 }}>
      <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
        <form action={action}>
          <input type="hidden" name="id" value={product.id} />
          {state.error && (
            <div style={{ marginBottom: 14, padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: '#DC2626' }}>
              {state.error}
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <label style={label}>Style Number *</label>
            <input name="styleNumber" defaultValue={product.styleNumber} style={input} required />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={label} htmlFor="product-description">Description</label>
            <textarea
              id="product-description"
              name="description"
              defaultValue={product.description ?? ''}
              rows={7}
              placeholder="Materials, construction, finish, client notes — as much detail as the inspector needs."
              style={textarea}
            />
            <div style={{ fontSize: 11.5, color: ui.faint, marginTop: 6, lineHeight: 1.45 }}>
              Line breaks are kept. Clearing this box and saving removes the description.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn kind="ghost" href="/products">Back</Btn>
            <Btn kind="primary" type="submit" loading={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </Btn>
          </div>
        </form>
      </div>

      <div style={{ marginTop: 24, padding: '18px 20px', background: '#FFF8F8', border: '1px solid #FECACA', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#DC2626' }}>Archive product</div>
        <div style={{ fontSize: 12.5, color: ui.sub, marginBottom: 12 }}>Removes this style from the active list. Historical inspections are preserved.</div>
        <button
          onClick={() => startArchive(async () => { await archiveProduct(product.id); })}
          disabled={archivePending}
          style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: 'inherit', border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: archivePending ? 'default' : 'pointer', opacity: archivePending ? 0.6 : 1 }}
        >
          {archivePending ? 'Archiving…' : 'Archive product'}
        </button>
      </div>
    </div>
  );
}
