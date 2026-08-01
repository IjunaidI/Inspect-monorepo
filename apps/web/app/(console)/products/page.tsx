import Link from 'next/link';
import { Plus } from 'lucide-react';
import { loadOrFallback, type ApiProduct } from '@/lib/api';
import { Btn, Mono, PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';

export const dynamic = 'force-dynamic';

const DEMO: ApiProduct[] = [
  { id: 'demo-p1', styleNumber: 'NV-2026-POLO-M', description: 'Polo shirt, mercerized cotton, regular fit' },
  { id: 'demo-p2', styleNumber: 'MA-BLZR-WF-01', description: 'Women\'s blazer, wool-blend, 4-button' },
  { id: 'demo-p3', styleNumber: 'KT-CHNO-BLU-32', description: 'Chino pants, stretch cotton, 32" inseam' },
];

export default async function ProductsPage() {
  const { data: products, live } = await loadOrFallback<ApiProduct[]>('/products', DEMO);

  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title="Products"
        sub="Style numbers and garment descriptions used in purchase orders and inspections."
        actions={<Btn kind="primary" icon={<Plus size={15} />} href="/products/new">Add Product</Btn>}
      />

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 11.5, color: ui.faint }}>{live ? 'Live · from API' : 'Demo data · API offline'}</span>
        <Mono style={{ fontSize: 12, color: ui.sub }}>{products.length} product{products.length === 1 ? '' : 's'}</Mono>
      </div>

      <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ fontSize: 11, fontWeight: 550, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, padding: '13px 20px', textAlign: 'left', borderBottom: `1px solid ${ui.line}`, background: ui.fill }}>Style Number</th>
              <th style={{ fontSize: 11, fontWeight: 550, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, padding: '13px 20px', textAlign: 'left', borderBottom: `1px solid ${ui.line}`, background: ui.fill }}>Description</th>
              <th style={{ fontSize: 11, fontWeight: 550, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, padding: '13px 20px', textAlign: 'left', borderBottom: `1px solid ${ui.line}`, background: ui.fill, width: 96 }} />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} style={{ borderBottom: `1px solid ${ui.lineSoft}` }}>
                <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 550 }}>
                  <Mono>{p.styleNumber}</Mono>
                </td>
                <td style={{ padding: '14px 20px', fontSize: 13, color: ui.sub }}>
                  {/* INS-074: descriptions are unbounded TEXT — clamp to two
                      lines so one long entry cannot blow the row height out.
                      The full text lives on the detail page. */}
                  {p.description ? (
                    <div
                      title={p.description}
                      style={{
                        maxWidth: 560,
                        lineHeight: 1.5,
                        display: '-webkit-box',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: 2,
                        overflow: 'hidden',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {p.description}
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                  <Link href={`/products/${p.id}`} style={{ fontSize: 12.5, color: ui.accent, textDecoration: 'none', fontWeight: 500 }}>Edit →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {products.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: ui.faint, fontSize: 13 }}>No products yet. <Link href="/products/new" style={{ color: ui.accent }}>Add one →</Link></div>
        )}
      </div>
    </div>
  );
}
