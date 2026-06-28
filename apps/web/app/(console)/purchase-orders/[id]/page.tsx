import { notFound } from 'next/navigation';
import { apiGet, type ApiPurchaseOrder } from '@/lib/api';
import { Mono, PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { EditPurchaseOrderForm } from './edit-form';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let po: ApiPurchaseOrder;
  try {
    po = await apiGet<ApiPurchaseOrder>(`/purchase-orders/${id}`);
  } catch {
    notFound();
  }

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <PageHead title={po.poNumber} sub="Purchase order" />

      {/* FK summary (read-only) */}
      <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
        {[['Buyer', po.buyer?.name], ['Supplier', po.supplier?.name], ['Product', po.product?.styleNumber]].map(([lbl, val]) => (
          <div key={lbl} style={{ flex: 1, padding: '12px 16px', background: ui.fill, border: `1px solid ${ui.lineSoft}`, borderRadius: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{lbl}</div>
            <div style={{ fontSize: 13, fontWeight: 550 }}>{val || '—'}</div>
          </div>
        ))}
      </div>

      <EditPurchaseOrderForm po={po} />
    </div>
  );
}
