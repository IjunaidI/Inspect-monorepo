'use client';

import { useMemo, useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { rankCompaniesByActivity } from '@inspect/domain';
import { Modal } from '@/components/inspect/modal';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { EntityPicker } from '@/components/inspect/entity-picker';
import { Btn } from '@/components/inspect/shell';
import type { ApiCompany, ApiProduct, ApiPurchaseOrder } from '@/lib/api';
import { quickCreatePurchaseOrder } from '@/app/(console)/purchase-orders/actions';
import { QuickCreateCompany, qcInput, qcLabel } from './quick-create-company';
import { QuickCreateProduct } from './quick-create-product';

type Creating = 'client' | 'factory' | 'product' | null;

/**
 * INS-091 — a PO created from the new-inspection picker. It needs two
 * companies and a product, so it carries the same three pickers as the PO
 * form, each with its own "+ Add new…" (one level of nested dialog). The host
 * passes the lists it already loaded; rows created here stay local to the
 * dialog and are selected as they are created.
 */
export function QuickCreatePurchaseOrder({
  open,
  onClose,
  onCreated,
  companies: initialCompanies,
  products: initialProducts,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (po: ApiPurchaseOrder) => void;
  companies: ApiCompany[];
  products: ApiProduct[];
}) {
  const [companies, setCompanies] = useState(initialCompanies);
  const [products, setProducts] = useState(initialProducts);
  const [poNumber, setPoNumber] = useState('');
  const [clientId, setClientId] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [creating, setCreating] = useState<Creating>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const companyOptions = useMemo(
    () => rankCompaniesByActivity(companies).map((c) => ({ id: c.id, label: c.name })),
    [companies],
  );
  const productOptions = useMemo(
    () => products.map((p) => ({ id: p.id, label: p.styleNumber, hint: p.description ?? undefined })),
    [products],
  );
  const selfDealing = clientId !== '' && clientId === factoryId;
  const ready = poNumber.trim() !== '' && clientId !== '' && factoryId !== '' && productId !== '' && !selfDealing;

  if (!open) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    start(async () => {
      const r = await quickCreatePurchaseOrder({
        poNumber,
        clientCompanyId: clientId,
        factoryCompanyId: factoryId,
        productId,
        totalQuantity: qty.trim() ? Number(qty) : undefined,
      });
      if (!r.data) {
        setError(r.error ?? 'create failed');
        return;
      }
      setError(null);
      onCreated(r.data);
    });
  }

  return (
    <Modal title="New purchase order" onClose={onClose} width={520}>
      <form onSubmit={submit} style={{ marginTop: 14 }}>
        {error && <ErrorBanner style={{ marginBottom: 12 }}>{error}</ErrorBanner>}
        <div style={{ marginBottom: 14 }}>
          <label style={qcLabel} htmlFor="qc-po-number">PO number *</label>
          <input id="qc-po-number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} style={qcInput} placeholder="e.g. PO-2026-NV-0042" required />
        </div>
        <div style={{ marginBottom: 14 }}>
          <EntityPicker label="Client *" options={companyOptions} value={clientId} onChange={setClientId} placeholder="Select the client…" emptyText="No companies yet." hintText="Receives the branded report." createLabel="+ Add new company…" onCreate={() => setCreating('client')} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <EntityPicker label="Factory *" options={companyOptions} value={factoryId} onChange={setFactoryId} placeholder="Select the factory…" emptyText="No companies yet." invalid={selfDealing} hintText={selfDealing ? 'Client and factory must differ.' : 'Produces the goods being inspected.'} createLabel="+ Add new company…" onCreate={() => setCreating('factory')} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <EntityPicker label="Product *" options={productOptions} value={productId} onChange={setProductId} placeholder="Select product…" emptyText="No products yet." createLabel="+ Add new product…" onCreate={() => setCreating('product')} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={qcLabel} htmlFor="qc-po-qty">Total quantity</label>
          <input id="qc-po-qty" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} style={qcInput} placeholder="Optional" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" loading={pending} disabled={!ready}>
            {pending ? 'Creating…' : 'Create PO'}
          </Btn>
        </div>
      </form>

      <QuickCreateCompany
        open={creating === 'client' || creating === 'factory'}
        onClose={() => setCreating(null)}
        onCreated={(c) => {
          setCompanies((prev) => [...prev, c]);
          if (creating === 'client') setClientId(c.id);
          if (creating === 'factory') setFactoryId(c.id);
          setCreating(null);
        }}
      />
      <QuickCreateProduct
        open={creating === 'product'}
        onClose={() => setCreating(null)}
        onCreated={(p) => {
          setProducts((prev) => [...prev, p]);
          setProductId(p.id);
          setCreating(null);
        }}
      />
    </Modal>
  );
}
