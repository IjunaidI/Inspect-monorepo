import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { apiGet, type ApiInspection } from '@/lib/api';
import { Btn, Mono, PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';

export default async function InspectionsListPage() {
  const inspections = await apiGet<ApiInspection[]>('/inspections').catch(() => []);
  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <ClipboardList size={15} color={ui.sub} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>Inspections</span>
      </div>
      <PageHead title="Inspections" sub={`${inspections.length} total`} actions={<Btn kind="primary" href="/inspections/new">New inspection</Btn>} />
      {inspections.length === 0 ? (
        <div style={{ marginTop: 24, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 22, color: ui.sub, fontSize: 13 }}>
          No inspections yet — create one.
        </div>
      ) : (
        <div style={{ marginTop: 24, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr 1fr 1fr', padding: '10px 20px', fontSize: 11, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill, borderBottom: `1px solid ${ui.line}` }}>
            <span>PO</span><span>Buyer</span><span>Product</span><span>Status</span><span>System</span>
          </div>
          {inspections.map((i) => (
            <Link key={i.id} href={`/inspections/${i.id}/review`} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr 1fr 1fr', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${ui.lineSoft}`, textDecoration: 'none', color: ui.ink }}>
              <Mono style={{ fontWeight: 600 }}>{i.purchaseOrder?.poNumber ?? i.id.slice(0, 8)}</Mono>
              <span>{i.buyer?.name ?? '—'}</span>
              <span>{i.product?.styleNumber ?? '—'}</span>
              <span style={{ fontSize: 12.5, color: ui.sub }}>{i.status}</span>
              <span style={{ fontSize: 12.5, color: ui.sub }}>{i.aqlResult?.systemRecommendation ?? '—'}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
