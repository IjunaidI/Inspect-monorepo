import Link from 'next/link';
import { Plus } from 'lucide-react';
import { loadOrFallback, type ApiPurchaseOrder } from '@/lib/api';
import { Btn, Mono, PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';

export const dynamic = 'force-dynamic';

const DEMO: ApiPurchaseOrder[] = [
  { id: 'demo-po1', poNumber: 'PO-2026-NV-0041', totalQuantity: 1200, buyer: { id: 'b1', name: 'Nordvik Retail Group' }, supplier: { id: 's1', name: 'Tirupur Knits Unit-3' }, product: { id: 'p1', styleNumber: 'NV-2026-POLO-M' } },
  { id: 'demo-po2', poNumber: 'PO-2026-MA-0019', totalQuantity: 400, buyer: { id: 'b2', name: 'Maison Adèle' }, supplier: { id: 's4', name: 'Hanoi Apparel Co.' }, product: { id: 'p2', styleNumber: 'MA-BLZR-WF-01' } },
  { id: 'demo-po3', poNumber: 'PO-2026-KT-0033', totalQuantity: 800, buyer: { id: 'b4', name: 'Kestrel & Thorne' }, supplier: { id: 's2', name: 'Dhaka Weave Ltd.' }, product: { id: 'p3', styleNumber: 'KT-CHNO-BLU-32' } },
];

export default async function PurchaseOrdersPage() {
  const { data: pos, live } = await loadOrFallback<ApiPurchaseOrder[]>('/purchase-orders', DEMO);
  const th = { fontSize: 11, fontWeight: 550, color: ui.sub, textTransform: 'uppercase' as const, letterSpacing: 0.4, padding: '13px 20px', textAlign: 'left' as const, borderBottom: `1px solid ${ui.line}`, background: ui.fill };

  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title="Purchase Orders"
        sub="Each PO links a buyer, supplier, and product. Inspections are created against a PO."
        actions={<Btn kind="primary" icon={<Plus size={15} />} href="/purchase-orders/new">Add PO</Btn>}
      />

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 11.5, color: ui.faint }}>{live ? 'Live · from API' : 'Demo data · API offline'}</span>
        <Mono style={{ fontSize: 12, color: ui.sub }}>{pos.length} PO{pos.length === 1 ? '' : 's'}</Mono>
      </div>

      <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>PO Number</th>
              <th style={th}>Buyer</th>
              <th style={th}>Supplier</th>
              <th style={th}>Product</th>
              <th style={{ ...th, textAlign: 'right' }}>Qty</th>
              <th style={{ ...th, width: 96 }} />
            </tr>
          </thead>
          <tbody>
            {pos.map((po) => (
              <tr key={po.id} style={{ borderBottom: `1px solid ${ui.lineSoft}` }}>
                <td style={{ padding: '14px 20px', fontSize: 13 }}>
                  <Mono style={{ fontWeight: 550 }}>{po.poNumber}</Mono>
                </td>
                <td style={{ padding: '14px 20px', fontSize: 13 }}>{po.buyer?.name ?? '—'}</td>
                <td style={{ padding: '14px 20px', fontSize: 13 }}>{po.supplier?.name ?? '—'}</td>
                <td style={{ padding: '14px 20px', fontSize: 13 }}>
                  {po.product ? <Mono style={{ fontSize: 12 }}>{po.product.styleNumber}</Mono> : '—'}
                </td>
                <td style={{ padding: '14px 20px', fontSize: 13, textAlign: 'right' }}>
                  <Mono>{po.totalQuantity != null ? po.totalQuantity.toLocaleString() : '—'}</Mono>
                </td>
                <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                  <Link href={`/purchase-orders/${po.id}`} style={{ fontSize: 12.5, color: ui.accent, textDecoration: 'none', fontWeight: 500 }}>Edit →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pos.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: ui.faint, fontSize: 13 }}>No purchase orders yet. <Link href="/purchase-orders/new" style={{ color: ui.accent }}>Add one →</Link></div>
        )}
      </div>
    </div>
  );
}
