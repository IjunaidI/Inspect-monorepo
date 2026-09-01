import Link from 'next/link';
import { FileCheck2, Search } from 'lucide-react';
import { reportNumber } from '@inspect/domain';
import { apiGet, type ApiReportListItem } from '@/lib/api';
import { Mono, PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('take', '50');
  const reports = await apiGet<ApiReportListItem[]>(`/reports?${params.toString()}`).catch(() => []);

  const cols = '1fr 1fr 1.4fr 1fr 0.9fr 0.8fr 0.9fr';

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <FileCheck2 size={15} color={ui.sub} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>Reports</span>
      </div>
      <PageHead
        title="Reports"
        sub={`${reports.length} signed report${reports.length === 1 ? '' : 's'}${q ? ` matching "${q}"` : ''}`}
        actions={
          <form method="GET" action="/reports" style={{ position: 'relative' }}>
            <Search size={15} color={ui.faint} style={{ position: 'absolute', left: 12, top: 10.5 }} />
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Search PO or client…"
              style={{ width: 280, height: 36, padding: '0 12px 0 36px', fontSize: 13, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </form>
        }
      />

      {reports.length === 0 ? (
        <div style={{ marginTop: 16, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 22, color: ui.sub, fontSize: 13 }}>
          {q ? `No reports match "${q}".` : 'No reports yet — approve an inspection and generate its report.'}
        </div>
      ) : (
        <div style={{ marginTop: 16, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, padding: '10px 20px', fontSize: 11, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill, borderBottom: `1px solid ${ui.line}` }}>
            <span>Report no.</span><span>PO</span><span>Client</span><span>Product</span><span>Generated</span><span>Verify</span><span>PDF</span>
          </div>
          {reports.map((r) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: cols, alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${ui.lineSoft}` }}>
              <Link href={`/inspections/${r.inspectionId}/report`} style={{ textDecoration: 'none' }}>
                <Mono style={{ fontWeight: 600, color: ui.accent }}>{reportNumber(r.id)}</Mono>
              </Link>
              <Mono>{r.inspection?.purchaseOrder?.poNumber ?? '—'}</Mono>
              <span>{r.clientCompany?.name ?? '—'}</span>
              <span>{r.inspection?.product?.styleNumber ?? '—'}</span>
              <Mono style={{ color: ui.sub, fontSize: 12 }}>{r.generatedAt ? new Date(r.generatedAt).toISOString().slice(0, 10) : '—'}</Mono>
              {r.verificationToken ? (
                <Link href={`/r/${r.verificationToken}`} style={{ fontSize: 12.5, color: ui.accent, textDecoration: 'none' }}>
                  Public verify
                </Link>
              ) : (
                <span style={{ fontSize: 12.5, color: ui.faint }}>—</span>
              )}
              <span style={{ fontSize: 12.5, color: ui.faint }}>
                {r.pdfStorageKey ? 'Available' : 'Pending (INS-003)'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
