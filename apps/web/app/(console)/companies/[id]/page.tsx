import { notFound } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { apiGet, type ApiCompany, type ApiLoopPreset } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { mono, ui } from '@/components/inspect/tokens';
import { EditCompanyForm } from './edit-form';

export const dynamic = 'force-dynamic';

/**
 * Decimal degrees, trimmed of trailing zeros (INS-071). `Number(toFixed())` — not
 * a regex on the string — so 23.810300 renders 23.8103 and 120.000000 renders 120
 * without a hand-rolled trimmer that could eat a significant digit.
 */
const coord = (n: number) => String(Number(n.toFixed(6)));

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let company: ApiCompany;
  let presets: ApiLoopPreset[] = [];
  try {
    [company, presets] = await Promise.all([
      apiGet<ApiCompany>(`/companies/${id}`),
      apiGet<ApiLoopPreset[]>('/loop-presets').catch(() => []),
    ]);
  } catch {
    notFound();
  }

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <PageHead
        title={company.name}
        sub={
          company.kind === 'INTERNAL'
            ? 'Internal company — one of our own sites'
            : 'Third-party company'
        }
        // INS-055 Task 7 adds the "Manage guests" action here once
        // /companies/:id/guests exists.
      />
      {/*
        INS-071: show the real coordinates, not just a "Pinned" badge. The badge
        told an inspector a factory had a location but never which one, so a wrong
        pin (the old hand-typed JSON made those easy) was invisible from the UI.
      */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <MapPin size={14} color={company.gps ? ui.accent : ui.faint} />
        {company.gps ? (
          <span style={{ ...mono, color: ui.ink }}>
            {coord(company.gps.lat)}, {coord(company.gps.lng)}
          </span>
        ) : (
          <span style={{ color: ui.faint }}>No GPS coordinates set</span>
        )}
        {company.address && <span style={{ color: ui.sub }}>· {company.address}</span>}
      </div>
      <EditCompanyForm company={company} presets={presets} />
    </div>
  );
}
