'use client';

import { useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { Modal } from '@/components/inspect/modal';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import type { ApiProduct } from '@/lib/api';
import { quickCreateProduct } from '@/app/(console)/products/actions';
import { qcInput, qcLabel } from './quick-create-company';

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
        <div style={{ marginBottom: 14 }}>
          <label style={qcLabel} htmlFor="qc-style">Style number *</label>
          <input id="qc-style" value={styleNumber} onChange={(e) => setStyleNumber(e.target.value)} style={qcInput} placeholder="e.g. NV-2026-POLO-M" required />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={qcLabel} htmlFor="qc-desc">Description</label>
          <textarea id="qc-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...qcInput, height: 'auto', padding: '8px 10px', resize: 'vertical', lineHeight: 1.5, color: ui.ink }} placeholder="Optional" />
        </div>
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
