'use client';

import { useActionState } from 'react';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import type { ApiBuyer, ApiProduct, ApiSupplier } from '@/lib/api';
import { createPurchaseOrder } from '../actions';

const label = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 };
const sel = { width: '100%', height: 36, padding: '0 8px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none' };
const input = { width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const };

export function CreatePurchaseOrderForm({ buyers, suppliers, products }: { buyers: ApiBuyer[]; suppliers: ApiSupplier[]; products: ApiProduct[] }) {
  const [state, action, pending] = useActionState(createPurchaseOrder, {});

  return (
    <div style={{ marginTop: 24, maxWidth: 560, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
      <form action={action}>
        {state.error && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: '#DC2626' }}>
            {state.error}
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <label style={label}>PO Number *</label>
          <input name="poNumber" style={input} placeholder="e.g. PO-2026-NV-0042" required />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Buyer *</label>
          <select name="buyerId" style={sel} required>
            <option value="">Select buyer…</option>
            {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Supplier *</label>
          <select name="supplierId" style={sel} required>
            <option value="">Select supplier…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Product *</label>
          <select name="productId" style={sel} required>
            <option value="">Select product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.styleNumber}{p.description ? ` — ${p.description}` : ''}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={label}>Total Quantity</label>
          <input name="totalQuantity" type="number" min={1} style={input} placeholder="e.g. 1200" />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn kind="ghost" href="/purchase-orders">Cancel</Btn>
          <Btn kind="primary" type="submit" style={{ opacity: pending ? 0.65 : 1 }}>
            {pending ? 'Creating…' : 'Create PO'}
          </Btn>
        </div>
      </form>
    </div>
  );
}
