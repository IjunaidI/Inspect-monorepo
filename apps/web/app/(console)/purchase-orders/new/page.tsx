import { apiGet, type ApiBuyer, type ApiProduct, type ApiSupplier } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { CreatePurchaseOrderForm } from './create-form';

export const dynamic = 'force-dynamic';

export default async function NewPurchaseOrderPage() {
  const [buyers, suppliers, products] = await Promise.all([
    apiGet<ApiBuyer[]>('/buyers').catch(() => [] as ApiBuyer[]),
    apiGet<ApiSupplier[]>('/suppliers').catch(() => [] as ApiSupplier[]),
    apiGet<ApiProduct[]>('/products').catch(() => [] as ApiProduct[]),
  ]);

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <PageHead title="Add Purchase Order" sub="Link a buyer, supplier, and product." />
      <CreatePurchaseOrderForm buyers={buyers} suppliers={suppliers} products={products} />
    </div>
  );
}
