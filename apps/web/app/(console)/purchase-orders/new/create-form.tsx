'use client';

import { useActionState, useMemo, useState } from 'react';
import { rankCompaniesByActivity } from '@inspect/domain';
import { Btn } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { EntityPicker } from '@/components/inspect/entity-picker';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { Field, Input } from '@/components/inspect/field';
import { QuickCreateCompany } from '@/components/inspect/quick-create/quick-create-company';
import { QuickCreateProduct } from '@/components/inspect/quick-create/quick-create-product';
import type { ApiCompany, ApiProduct } from '@/lib/api';
import { createPurchaseOrder } from '../actions';

type Creating = 'client' | 'factory' | 'product' | null;

/**
 * INS-055 — both party pickers are fed by the SAME company list, because trade
 * role is a property of this PO, not of the company. Ranking is a hint
 * (`rankCompaniesByActivity`, shared with mobile; per-role ranking since INS-087).
 *
 * INS-091 — every picker is searchable and ends in "+ Add new…": the company
 * or product is created in a dialog, appended to the list and selected, and
 * nothing typed here is lost. Lists live in state so they can grow.
 */
export function CreatePurchaseOrderForm({ companies: initialCompanies, products: initialProducts }: { companies: ApiCompany[]; products: ApiProduct[] }) {
  const [state, action, pending] = useActionState(createPurchaseOrder, {});
  const [companies, setCompanies] = useState(initialCompanies);
  const [products, setProducts] = useState(initialProducts);
  const [clientId, setClientId] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [creating, setCreating] = useState<Creating>(null);

  // INS-087: each picker ranks on ITS trade role — the companies this org has
  // recently used as a client float up in the Client picker, factories in the
  // Factory picker. Same list, two orders.
  const clientOptions = useMemo(
    () => rankCompaniesByActivity(companies, 'client').map((c) => ({ id: c.id, label: c.name })),
    [companies],
  );
  const factoryOptions = useMemo(
    () => rankCompaniesByActivity(companies, 'factory').map((c) => ({ id: c.id, label: c.name })),
    [companies],
  );
  const productOptions = useMemo(
    () => products.map((p) => ({ id: p.id, label: p.styleNumber, hint: p.description ?? undefined })),
    [products],
  );

  // Mirrors the API's 400 (spec §2.4). The server check is the authority.
  const selfDealing = clientId !== '' && clientId === factoryId;
  const incomplete = !clientId || !factoryId || !productId;

  function onCompanyCreated(c: ApiCompany) {
    setCompanies((prev) => [...prev, c]);
    if (creating === 'client') setClientId(c.id);
    if (creating === 'factory') setFactoryId(c.id);
    setCreating(null);
  }
  function onProductCreated(p: ApiProduct) {
    setProducts((prev) => [...prev, p]);
    setProductId(p.id);
    setCreating(null);
  }

  return (
    <div style={{ marginTop: 24, maxWidth: 560, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
      <form action={action}>
        {state.error && <ErrorBanner style={{ marginBottom: 14 }}>{state.error}</ErrorBanner>}
        <Field label="PO Number *" htmlFor="po-number" style={{ marginBottom: 16 }}>
          <Input id="po-number" name="poNumber" placeholder="e.g. PO-2026-NV-0042" required />
        </Field>
        <div style={{ marginBottom: 16 }}>
          <EntityPicker
            name="clientCompanyId"
            label="Client *"
            options={clientOptions}
            value={clientId}
            onChange={setClientId}
            placeholder="Select the client…"
            emptyText="No companies yet."
            hintText="Receives the branded report."
            createLabel="+ Add new company…"
            onCreate={() => setCreating('client')}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <EntityPicker
            name="factoryCompanyId"
            label="Factory *"
            options={factoryOptions}
            value={factoryId}
            onChange={setFactoryId}
            placeholder="Select the factory…"
            emptyText="No companies yet."
            invalid={selfDealing}
            hintText={selfDealing ? 'Client and factory must differ.' : 'Produces the goods being inspected.'}
            createLabel="+ Add new company…"
            onCreate={() => setCreating('factory')}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <EntityPicker
            name="productId"
            label="Product *"
            options={productOptions}
            value={productId}
            onChange={setProductId}
            placeholder="Select product…"
            emptyText="No products yet."
            createLabel="+ Add new product…"
            onCreate={() => setCreating('product')}
          />
        </div>
        <Field label="Total Quantity" htmlFor="po-qty" style={{ marginBottom: 20 }}>
          <Input id="po-qty" name="totalQuantity" type="number" min={1} placeholder="e.g. 1200" />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn kind="ghost" href="/purchase-orders">Cancel</Btn>
          <Btn kind="primary" type="submit" loading={pending} disabled={selfDealing || incomplete}>
            {pending ? 'Creating…' : 'Create PO'}
          </Btn>
        </div>
      </form>

      <QuickCreateCompany open={creating === 'client' || creating === 'factory'} onClose={() => setCreating(null)} onCreated={onCompanyCreated} />
      <QuickCreateProduct open={creating === 'product'} onClose={() => setCreating(null)} onCreated={onProductCreated} />
    </div>
  );
}
