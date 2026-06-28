'use client';

import { useActionState } from 'react';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { createProduct } from '../actions';

const label = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 };
const input = { width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const };

export function CreateProductForm() {
  const [state, action, pending] = useActionState(createProduct, {});

  return (
    <div style={{ marginTop: 24, maxWidth: 520, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
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
          <label style={label}>Description</label>
          <textarea name="description" rows={3} placeholder="Short product description"
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', resize: 'none', boxSizing: 'border-box' as const }} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn kind="ghost" href="/products">Cancel</Btn>
          <Btn kind="primary" type="submit" style={{ opacity: pending ? 0.65 : 1 }}>
            {pending ? 'Creating…' : 'Create Product'}
          </Btn>
        </div>
      </form>
    </div>
  );
}
