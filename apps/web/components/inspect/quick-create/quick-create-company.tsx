'use client';

import { useState, useTransition } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { Modal } from '@/components/inspect/modal';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import type { ApiCompany, ApiCompanyKind } from '@/lib/api';
import { quickCreateCompany } from '@/app/(console)/dashboard/actions';

export const qcLabel: CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };
export const qcInput: CSSProperties = { width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' };

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
        <div style={{ marginBottom: 14 }}>
          <label style={qcLabel} htmlFor="qc-company-name">Name *</label>
          <input id="qc-company-name" value={name} onChange={(e) => setName(e.target.value)} style={qcInput} placeholder="e.g. Northwind Apparel" required />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={qcLabel} htmlFor="qc-company-kind">Kind</label>
          <select id="qc-company-kind" value={kind} onChange={(e) => setKind(e.target.value as ApiCompanyKind)} style={{ ...qcInput, cursor: 'pointer' }}>
            <option value="THIRD_PARTY">Third-party</option>
            <option value="INTERNAL">Internal</option>
          </select>
        </div>
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
