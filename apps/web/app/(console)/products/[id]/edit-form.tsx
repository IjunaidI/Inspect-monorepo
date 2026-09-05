'use client';

import { useActionState, useTransition } from 'react';
import { Btn } from '@/components/inspect/shell';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { Field, Input, Textarea } from '@/components/inspect/field';
import { ui } from '@/components/inspect/tokens';
import type { ApiProduct } from '@/lib/api';
import { archiveProduct, updateProduct } from '../actions';

/** INS-074: room to write — a real multi-paragraph box the user can drag taller. */
const descriptionBox = { padding: '10px 12px', lineHeight: 1.6, minHeight: 132 };

export function EditProductForm({ product }: { product: ApiProduct }) {
  const [state, action, pending] = useActionState(updateProduct, {});
  const [archivePending, startArchive] = useTransition();

  return (
    <div style={{ marginTop: 24, maxWidth: 640 }}>
      <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
        <form action={action}>
          <input type="hidden" name="id" value={product.id} />
          {state.error && <ErrorBanner style={{ marginBottom: 14 }}>{state.error}</ErrorBanner>}
          <Field label="Style Number *" htmlFor="product-style" style={{ marginBottom: 16 }}>
            <Input id="product-style" name="styleNumber" defaultValue={product.styleNumber} required />
          </Field>
          <Field
            label="Description"
            htmlFor="product-description"
            hint="Line breaks are kept. Clearing this box and saving removes the description."
            style={{ marginBottom: 20 }}
          >
            <Textarea
              id="product-description"
              name="description"
              defaultValue={product.description ?? ''}
              rows={7}
              placeholder="Materials, construction, finish, client notes — as much detail as the inspector needs."
              style={descriptionBox}
            />
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn kind="ghost" href="/products">Back</Btn>
            <Btn kind="primary" type="submit" loading={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </Btn>
          </div>
        </form>
      </div>

      <div style={{ marginTop: 24, padding: '18px 20px', background: '#FFF8F8', border: '1px solid #FECACA', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: ui.danger }}>Archive product</div>
        <div style={{ fontSize: 12.5, color: ui.sub, marginBottom: 12 }}>Removes this style from the active list. Historical inspections are preserved.</div>
        <button
          onClick={() => startArchive(async () => { await archiveProduct(product.id); })}
          disabled={archivePending}
          style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: 'inherit', border: '1px solid #FECACA', background: '#FEF2F2', color: ui.danger, cursor: archivePending ? 'default' : 'pointer', opacity: archivePending ? 0.6 : 1 }}
        >
          {archivePending ? 'Archiving…' : 'Archive product'}
        </button>
      </div>
    </div>
  );
}
