'use client';

import { useActionState } from 'react';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { createProduct } from '../actions';

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

export function CreateProductForm() {
  const [state, action, pending] = useActionState(createProduct, {});

  return (
    <div style={{ marginTop: 24, maxWidth: 640, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
      <form action={action}>
        {state.error && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: '#DC2626' }}>
            {state.error}
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Style Number *</label>
          <input name="styleNumber" style={input} placeholder="e.g. NV-2026-POLO-M" required />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={label} htmlFor="product-description">Description</label>
          <textarea
            id="product-description"
            name="description"
            rows={7}
            placeholder="Materials, construction, finish, buyer notes — as much detail as the inspector needs."
            style={textarea}
          />
          <div style={{ fontSize: 11.5, color: ui.faint, marginTop: 6, lineHeight: 1.45 }}>
            Line breaks are kept. Optional — the style number is the display key.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn kind="ghost" href="/products">Cancel</Btn>
          <Btn kind="primary" type="submit" loading={pending}>
            {pending ? 'Creating…' : 'Create Product'}
          </Btn>
        </div>
      </form>
    </div>
  );
}
