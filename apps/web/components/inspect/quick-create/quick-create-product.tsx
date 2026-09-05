'use client';

import { useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { Modal } from '@/components/inspect/modal';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { Btn } from '@/components/inspect/shell';
import { Field, Input, Textarea } from '@/components/inspect/field';
import type { ApiProduct } from '@/lib/api';
import { quickCreateProduct } from '@/app/(console)/products/actions';

/** INS-091 — create a product from the picker that needs it. */
export function QuickCreateProduct({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (product: ApiProduct) => void;
}) {
  const [styleNumber, setStyleNumber] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await quickCreateProduct({ styleNumber, description });
      if (!r.data) {
        setError(r.error ?? 'create failed');
        return;
      }
      setStyleNumber('');
      setDescription('');
      setError(null);
      onCreated(r.data);
    });
  }

  return (
    <Modal title="New product" onClose={onClose}>
      <form onSubmit={submit} style={{ marginTop: 14 }}>
        {error && <ErrorBanner style={{ marginBottom: 12 }}>{error}</ErrorBanner>}
        <Field label="Style number *" htmlFor="qc-style" style={{ marginBottom: 14 }}>
          <Input id="qc-style" value={styleNumber} onChange={(e) => setStyleNumber(e.target.value)} placeholder="e.g. NV-2026-POLO-M" required />
        </Field>
        <Field label="Description" htmlFor="qc-desc" style={{ marginBottom: 16 }}>
          <Textarea id="qc-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ padding: '8px 10px' }} placeholder="Optional" />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" loading={pending} disabled={!styleNumber.trim()}>
            {pending ? 'Creating…' : 'Create product'}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
