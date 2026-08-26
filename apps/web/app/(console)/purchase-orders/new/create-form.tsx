'use client';

import { useActionState, useMemo, useState } from 'react';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import type { ApiCompany, ApiProduct } from '@/lib/api';
import { createPurchaseOrder } from '../actions';

const label = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 };
const sel = { width: '100%', height: 36, padding: '0 8px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none' };
const input = { width: '100%', height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const };

/**
 * INS-055 — both party pickers are fed by the SAME company list, because trade
 * role is a property of this PO, not of the company.
 *
 * The pickers are ranked by how often each company has already played THAT role
 * (spec §0 P3's replacement for `canBeClient` / `canBeFactory` flags — flags
 * would re-encode the Buyer/Supplier split this model removes). Ranking is a
 * hint; every company stays selectable in either slot.
 */
function rankedFor(companies: ApiCompany[], _role: 'client' | 'factory') {
  // `_count` is already flattened across both edges by the API, so it cannot
  // separate the roles; fall back to overall activity, then name. When the API
  // starts returning per-role counts this is the one place to change.
  return [...companies].sort(
    (a, b) =>
      (b._count?.purchaseOrders ?? 0) - (a._count?.purchaseOrders ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

export function CreatePurchaseOrderForm({ companies, products }: { companies: ApiCompany[]; products: ApiProduct[] }) {
  const [state, action, pending] = useActionState(createPurchaseOrder, {});
  const [clientId, setClientId] = useState('');
  const [factoryId, setFactoryId] = useState('');

  const clientOptions = useMemo(() => rankedFor(companies, 'client'), [companies]);
  const factoryOptions = useMemo(() => rankedFor(companies, 'factory'), [companies]);

  // Mirrors the API's 400 (spec §2.4). The server check is the authority — this
  // only saves a round trip and names the problem next to the field.
  const selfDealing = clientId !== '' && clientId === factoryId;

  return (
    <div style={{ marginTop: 24, maxWidth: 560, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
      <form action={action}>
        {state.error && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: ui.danger }}>
            {state.error}
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <label style={label}>PO Number *</label>
          <input name="poNumber" style={input} placeholder="e.g. PO-2026-NV-0042" required />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Client *</label>
          <select
            name="clientCompanyId"
            style={sel}
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Select the client…</option>
            {clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{ fontSize: 11, color: ui.faint, marginTop: 4 }}>Receives the branded report.</div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={label}>Factory *</label>
          <select
            name="factoryCompanyId"
            style={{ ...sel, border: `1px solid ${selfDealing ? ui.danger : ui.line}` }}
            required
            value={factoryId}
            onChange={(e) => setFactoryId(e.target.value)}
          >
            <option value="">Select the factory…</option>
            {factoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{ fontSize: 11, color: selfDealing ? ui.danger : ui.faint, marginTop: 4 }}>
            {selfDealing
              ? 'Client and factory must differ.'
              : 'Produces the goods being inspected.'}
          </div>
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
          <Btn kind="primary" type="submit" loading={pending} disabled={selfDealing}>
            {pending ? 'Creating…' : 'Create PO'}
          </Btn>
        </div>
      </form>
    </div>
  );
}
