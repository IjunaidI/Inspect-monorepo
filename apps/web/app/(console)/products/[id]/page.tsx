import { notFound } from 'next/navigation';
import { apiGet, type ApiProduct } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { EditProductForm } from './edit-form';

export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let product: ApiProduct;
  try {
    product = await apiGet<ApiProduct>(`/products/${id}`);
  } catch {
    notFound();
  }

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <PageHead title={product.styleNumber} sub={product.description ?? 'Product configuration'} />
      <EditProductForm product={product} />
    </div>
  );
}
