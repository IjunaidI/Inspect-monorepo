'use client';

import { useActionState } from 'react';
import { Btn } from '@/components/inspect/shell';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { Field, Input, Textarea } from '@/components/inspect/field';
import { ui } from '@/components/inspect/tokens';
import { createProduct } from '../actions';

/** INS-074: room to write — a real multi-paragraph box the user can drag taller. */
const descriptionBox = { padding: '10px 12px', lineHeight: 1.6, minHeight: 132 };

export function CreateProductForm() {
  const [state, action, pending] = useActionState(createProduct, {});

  return (
    <div style={{ marginTop: 24, maxWidth: 640, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
      <form action={action}>
        {state.error && <ErrorBanner style={{ marginBottom: 14 }}>{state.error}</ErrorBanner>}
        <Field label="Style Number *" htmlFor="product-style" style={{ marginBottom: 16 }}>
          <Input id="product-style" name="styleNumber" placeholder="e.g. NV-2026-POLO-M" required />
        </Field>
        <Field
          label="Description"
          htmlFor="product-description"
          hint="Line breaks are kept. Optional — the style number is the display key."
          style={{ marginBottom: 20 }}
        >
          <Textarea
            id="product-description"
            name="description"
            rows={7}
            placeholder="Materials, construction, finish, client notes — as much detail as the inspector needs."
            style={descriptionBox}
          />
        </Field>
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
