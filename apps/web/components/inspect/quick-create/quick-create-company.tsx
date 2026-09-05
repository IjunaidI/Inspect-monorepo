'use client';

import { useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { Modal } from '@/components/inspect/modal';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { Field, Input, Select } from '@/components/inspect/field';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import type { ApiCompany, ApiCompanyKind } from '@/lib/api';
import { quickCreateCompany } from '@/app/(console)/dashboard/actions';

/**
 * INS-091 — create a company without leaving the form that needs it. Only
 * `name` is required by the API; branding + location are finished later on
 * /companies/[id]. On success the DTO goes to the host, which appends + selects.
 */
export function QuickCreateCompany({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (company: ApiCompany) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ApiCompanyKind>('THIRD_PARTY');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await quickCreateCompany({ name, kind });
      if (!r.data) {
        setError(r.error ?? 'create failed');
        return;
      }
      setName('');
      setError(null);
      onCreated(r.data);
    });
  }

  return (
    <Modal title="New company" onClose={onClose}>
      <form onSubmit={submit} style={{ marginTop: 14 }}>
        {error && <ErrorBanner style={{ marginBottom: 12 }}>{error}</ErrorBanner>}
        <Field label="Name *" htmlFor="qc-company-name" style={{ marginBottom: 14 }}>
          <Input id="qc-company-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northwind Apparel" required />
        </Field>
        <Field label="Kind" htmlFor="qc-company-kind" style={{ marginBottom: 14 }}>
          <Select id="qc-company-kind" value={kind} onChange={(e) => setKind(e.target.value as ApiCompanyKind)}>
            <option value="THIRD_PARTY">Third-party</option>
            <option value="INTERNAL">Internal</option>
          </Select>
        </Field>
        <div style={{ fontSize: 11.5, color: ui.faint, marginBottom: 16 }}>
          Branding and location can be added later from the directory.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" loading={pending} disabled={!name.trim()}>
            {pending ? 'Creating…' : 'Create company'}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
