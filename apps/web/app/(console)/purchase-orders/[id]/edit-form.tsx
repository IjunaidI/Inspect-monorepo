'use client';

import { useActionState, useTransition } from 'react';
import { Btn } from '@/components/inspect/shell';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { Field, Input, ReadOnlyValue } from '@/components/inspect/field';
import { ui } from '@/components/inspect/tokens';
import type { ApiPurchaseOrder } from '@/lib/api';
import { deletePurchaseOrder, updatePurchaseOrder } from '../actions';

const PARTIES_HINT = 'Fixed once the PO exists — create a new PO to change parties.';

export function EditPurchaseOrderForm({ po }: { po: ApiPurchaseOrder }) {
  const [state, action, pending] = useActionState(updatePurchaseOrder, {});
  const [deletePending, startDelete] = useTransition();

  return (
    <div style={{ marginTop: 24, maxWidth: 520 }}>
      <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
        <form action={action}>
          <input type="hidden" name="id" value={po.id} />
          {state.error && <ErrorBanner style={{ marginBottom: 14 }}>{state.error}</ErrorBanner>}

          {/*
            INS-092: the parties and the product are immutable after create
            (PATCH /purchase-orders/:id accepts only poNumber + totalQuantity —
            INS-055 puts trade role on this edge, and an inspection may already
            have frozen it). Shown in the form so the user sees WHAT is fixed and
            why, instead of hunting for an edit control that does not exist.
          */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 4 }}>
            <Field label="Client">
              <ReadOnlyValue>{po.clientCompany?.name ?? '—'}</ReadOnlyValue>
            </Field>
            <Field label="Factory">
              <ReadOnlyValue>{po.factoryCompany?.name ?? '—'}</ReadOnlyValue>
            </Field>
          </div>
          <Field label="Product" hint={PARTIES_HINT} style={{ marginBottom: 20 }}>
            <ReadOnlyValue>{po.product?.styleNumber ?? '—'}</ReadOnlyValue>
          </Field>

          <Field label="PO Number *" htmlFor="po-number" style={{ marginBottom: 16 }}>
            <Input id="po-number" name="poNumber" defaultValue={po.poNumber} required />
          </Field>
          <Field label="Total Quantity" htmlFor="po-qty" style={{ marginBottom: 20 }}>
            <Input id="po-qty" name="totalQuantity" type="number" min={1} defaultValue={po.totalQuantity ?? ''} placeholder="e.g. 1200" />
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn kind="ghost" href="/purchase-orders">Back</Btn>
            <Btn kind="primary" type="submit" loading={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </Btn>
          </div>
        </form>
      </div>

      <div style={{ marginTop: 24, padding: '18px 20px', background: '#FFF8F8', border: '1px solid #FECACA', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: ui.danger }}>Delete purchase order</div>
        <div style={{ fontSize: 12.5, color: ui.sub, marginBottom: 12 }}>This PO will be permanently removed. Only delete if no inspections have been created against it.</div>
        <button
          onClick={() => startDelete(async () => { await deletePurchaseOrder(po.id); })}
          disabled={deletePending}
          style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: 'inherit', border: '1px solid #FECACA', background: '#FEF2F2', color: ui.danger, cursor: deletePending ? 'default' : 'pointer', opacity: deletePending ? 0.6 : 1 }}
        >
          {deletePending ? 'Deleting…' : 'Delete PO'}
        </button>
      </div>
    </div>
  );
}
