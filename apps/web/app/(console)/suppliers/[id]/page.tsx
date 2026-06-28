import { notFound } from 'next/navigation';
import { apiGet, type ApiSupplier } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { EditSupplierForm } from './edit-form';

export const dynamic = 'force-dynamic';

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let supplier: ApiSupplier;
  try {
    supplier = await apiGet<ApiSupplier>(`/suppliers/${id}`);
  } catch {
    notFound();
  }

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <PageHead title={supplier.name} sub="Supplier configuration" />
      <EditSupplierForm supplier={supplier} />
    </div>
  );
}
