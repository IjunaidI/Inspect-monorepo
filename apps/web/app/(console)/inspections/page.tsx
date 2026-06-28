import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { apiGet, type ApiInspection } from '@/lib/api';
import { Btn, Mono, PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';

const STATUS_CHIPS = [
  { label: 'All', value: undefined },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Submitted', value: 'SUBMITTED' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Report Issued', value: 'REPORT_ISSUED' },
] as const;

export default async function InspectionsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const inspections = await apiGet<ApiInspection[]>(`/inspections${qs}`).catch(() => []);

  const subLabel = status
    ? `${inspections.length} · filtered by ${status}`
    : `${inspections.length} total`;

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <ClipboardList size={15} color={ui.sub} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>Inspections</span>
      </div>
      <PageHead title="Inspections" sub={subLabel} actions={<Btn kind="primary" href="/inspections/new">New inspection</Btn>} />

      {/* Status filter chips */}
      <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
        {STATUS_CHIPS.map((chip) => {
          const isActive = chip.value === status || (chip.value === undefined && !status);
          return (
            <Link
              key={chip.label}
              href={chip.value ? `/inspections?status=${chip.value}` : '/inspections'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 30,
                padding: '0 14px',
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: isActive ? 600 : 500,
                textDecoration: 'none',
                background: isActive ? ui.accentSoft : '#fff',
                color: isActive ? ui.accent : ui.sub,
                border: `1px solid ${isActive ? ui.accent : ui.line}`,
              }}
            >
              {chip.label}
            </Link>
          );
        })}
      </div>

      {inspections.length === 0 ? (
        <div style={{ marginTop: 16, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 22, color: ui.sub, fontSize: 13 }}>
          {status ? `No inspections with status "${status}".` : 'No inspections yet — create one.'}
        </div>
      ) : (
        <div style={{ marginTop: 16, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
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
