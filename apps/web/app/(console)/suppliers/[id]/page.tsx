import { notFound } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { apiGet, type ApiSupplier } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { mono, ui } from '@/components/inspect/tokens';
import { EditSupplierForm } from './edit-form';

export const dynamic = 'force-dynamic';

/**
 * Decimal degrees, trimmed of trailing zeros (INS-071). `Number(toFixed())` — not
 * a regex on the string — so 23.810300 renders 23.8103 and 120.000000 renders 120
 * without a hand-rolled trimmer that could eat a significant digit.
 */
const coord = (n: number) => String(Number(n.toFixed(6)));

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
      {/*
        INS-071: show the real coordinates, not just a "Pinned" badge. The badge
        told an inspector a factory had a location but never which one, so a wrong
        pin (the old hand-typed JSON made those easy) was invisible from the UI.
      */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <MapPin size={14} color={supplier.gps ? ui.accent : ui.faint} />
        {supplier.gps ? (
          <span style={{ ...mono, color: ui.ink }}>
            {coord(supplier.gps.lat)}, {coord(supplier.gps.lng)}
          </span>
        ) : (
          <span style={{ color: ui.faint }}>No GPS coordinates set</span>
        )}
        {supplier.address && <span style={{ color: ui.sub }}>· {supplier.address}</span>}
      </div>
      <EditSupplierForm supplier={supplier} />
    </div>
  );
}
