'use client';

import { useActionState, useTransition } from 'react';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import type { ApiPurchaseOrder } from '@/lib/api';
import { deletePurchaseOrder, updatePurchaseOrder } from '../actions';

const label = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 };
const input = { width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const };

export function EditPurchaseOrderForm({ po }: { po: ApiPurchaseOrder }) {
  const [state, action, pending] = useActionState(updatePurchaseOrder, {});
  const [deletePending, startDelete] = useTransition();

  return (
    <div style={{ marginTop: 24, maxWidth: 520 }}>
      <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
        <form action={action}>
          <input type="hidden" name="id" value={po.id} />
          {state.error && (
            <div style={{ marginBottom: 14, padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: '#DC2626' }}>
              {state.error}
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <label style={label}>PO Number *</label>
            <input name="poNumber" defaultValue={po.poNumber} style={input} required />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={label}>Total Quantity</label>
            <input name="totalQuantity" type="number" min={1} defaultValue={po.totalQuantity ?? ''} style={input} placeholder="e.g. 1200" />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn kind="ghost" href="/purchase-orders">Back</Btn>
            <Btn kind="primary" type="submit" loading={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </Btn>
          </div>
        </form>
      </div>

      <div style={{ marginTop: 24, padding: '18px 20px', background: '#FFF8F8', border: '1px solid #FECACA', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#DC2626' }}>Delete purchase order</div>
        <div style={{ fontSize: 12.5, color: ui.sub, marginBottom: 12 }}>This PO will be permanently removed. Only delete if no inspections have been created against it.</div>
        <button
          onClick={() => startDelete(async () => { await deletePurchaseOrder(po.id); })}
          disabled={deletePending}
          style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: 'inherit', border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: deletePending ? 'default' : 'pointer', opacity: deletePending ? 0.6 : 1 }}
        >
          {deletePending ? 'Deleting…' : 'Delete PO'}
        </button>
      </div>
    </div>
  );
}
