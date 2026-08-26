import { apiGet, type ApiCompany, type ApiProduct } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { CreatePurchaseOrderForm } from './create-form';

export const dynamic = 'force-dynamic';

export default async function NewPurchaseOrderPage() {
  // INS-055: ONE company list feeds BOTH party pickers. There is no
  // "buyers endpoint" and "suppliers endpoint" any more, because a company can
  // be the client on this PO and the factory on the next one.
  const [companies, products] = await Promise.all([
    apiGet<ApiCompany[]>('/companies').catch(() => [] as ApiCompany[]),
    apiGet<ApiProduct[]>('/products').catch(() => [] as ApiProduct[]),
  ]);

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <PageHead
        title="Add Purchase Order"
        sub="A PO names two parties — the client it is for, and the factory producing it — plus the product."
      />
      <CreatePurchaseOrderForm companies={companies} products={products} />
    </div>
  );
}
