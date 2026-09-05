import { notFound } from 'next/navigation';
import { apiGet, type ApiPurchaseOrder } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
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

  // INS-092: client / factory / product now render inside the form as read-only
  // fields with the "fixed once the PO exists" hint, so the separate FK tile row
  // that used to sit here is gone rather than shown twice.
  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <PageHead title={po.poNumber} sub="Purchase order" />
      <EditPurchaseOrderForm po={po} />
    </div>
  );
}
