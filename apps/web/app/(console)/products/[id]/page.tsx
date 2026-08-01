import { notFound } from 'next/navigation';
import { apiGet, type ApiProduct } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
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

  const description = product.description?.trim();

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      {/* INS-074: the subtitle stays a stable one-liner — the description is a
          body block below, so a long multi-paragraph write-up reads properly
          instead of being squeezed into the page header. */}
      <PageHead title={product.styleNumber} sub="Product configuration" />

      {description ? (
        <div style={{ marginTop: 20, maxWidth: 640, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
            Description
          </div>
          <div style={{ fontSize: 13.5, color: ui.ink, lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {description}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 20, maxWidth: 640, fontSize: 12.5, color: ui.faint }}>
          No description yet — add one below.
        </div>
      )}

      <EditProductForm product={product} />
    </div>
  );
}
