import { apiGet, loadOrFallback, type ApiBuyer, type ApiDashboardSummary, type ApiLoopPreset, type ApiSupplier } from '@/lib/api';
import { Mono, PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { DirectoryClient } from './directory-client';

export const dynamic = 'force-dynamic';

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const DEMO_BUYERS: ApiBuyer[] = [
  { id: 'demo-b1', name: 'Nordvik Retail Group', primaryColor: '#1457A3', updatedAt: daysAgo(1), _count: { purchaseOrders: 6, inspections: 9, reports: 4 } },
  { id: 'demo-b2', name: 'Maison Adèle', primaryColor: '#0B7D6B', updatedAt: daysAgo(3), _count: { purchaseOrders: 3, inspections: 5, reports: 2 } },
  { id: 'demo-b3', name: 'Beaumont Living', primaryColor: '#C2410C', updatedAt: daysAgo(6), _count: { purchaseOrders: 2, inspections: 2, reports: 1 } },
  { id: 'demo-b4', name: 'Kestrel & Thorne', primaryColor: '#7C3AED', updatedAt: daysAgo(8), _count: { purchaseOrders: 4, inspections: 6, reports: 3 } },
  { id: 'demo-b5', name: 'Hudson & Field', primaryColor: '#B5791A', updatedAt: daysAgo(12), _count: { purchaseOrders: 1, inspections: 1, reports: 0 } },
  { id: 'demo-b6', name: 'Sundsvall Home', primaryColor: '#0B1220', updatedAt: daysAgo(20), _count: { purchaseOrders: 2, inspections: 3, reports: 2 } },
];
const DEMO_SUPPLIERS: ApiSupplier[] = [
  { id: 'demo-s1', name: 'Tirupur Knits Unit-3', address: 'Tirupur, India', gps: { lat: 11.1085, lng: 77.3411 }, updatedAt: daysAgo(2), _count: { purchaseOrders: 7, inspections: 11 } },
  { id: 'demo-s2', name: 'Dhaka Weave Ltd.', address: 'Dhaka, Bangladesh', gps: { lat: 23.8103, lng: 90.4125 }, updatedAt: daysAgo(4), _count: { purchaseOrders: 5, inspections: 8 } },
  { id: 'demo-s3', name: 'Karachi Home Mills', address: 'Karachi, Pakistan', gps: null, updatedAt: daysAgo(9), _count: { purchaseOrders: 2, inspections: 3 } },
  { id: 'demo-s4', name: 'Hanoi Apparel Co.', address: 'Hanoi, Vietnam', gps: { lat: 21.0285, lng: 105.8542 }, updatedAt: daysAgo(15), _count: { purchaseOrders: 4, inspections: 4 } },
];
const DEMO_SUMMARY: ApiDashboardSummary = {
  inspectionsByStatus: { IN_PROGRESS: 4, SUBMITTED: 3, UNDER_REVIEW: 2, APPROVED: 5, REPORT_ISSUED: 12 },
  buyers: 6,
  suppliers: 4,
  products: 14,
  purchaseOrders: 18,
  reports: 12,
};

/** Header KPI row — real org-scoped rollups from GET /dashboard/summary. */
function StatTiles({ summary }: { summary: ApiDashboardSummary }) {
  const inspections = Object.values(summary.inspectionsByStatus).reduce((a, n) => a + n, 0);
  const tiles: [string, number][] = [
    ['Buyers', summary.buyers],
    ['Suppliers', summary.suppliers],
    ['Products', summary.products],
    ['Purchase orders', summary.purchaseOrders],
    ['Inspections', inspections],
    ['Reports', summary.reports],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginTop: 20 }}>
      {tiles.map(([label, value]) => (
        <div key={label} style={{ background: ui.panel, border: `1px solid ${ui.line}`, borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 10.5, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
          <Mono style={{ display: 'block', fontSize: 20, fontWeight: 600, color: ui.ink, marginTop: 4 }}>{value.toLocaleString('en-US')}</Mono>
        </div>
      ))}
    </div>
  );
}

const PAGE_SIZE = 50;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ includeArchived?: string; q?: string; page?: string }>;
}) {
  const { includeArchived, q, page } = await searchParams;
  const pageNum = Math.max(parseInt(page ?? '1', 10) || 1, 1);

  // Default = active rows only (API default); ?includeArchived=1 shows everything.
  // Server-side search + pagination (INS-050): forward q/take/skip.
  const apiParams = new URLSearchParams();
  if (includeArchived === '1') apiParams.set('includeArchived', '1');
  if (q) apiParams.set('q', q);
  apiParams.set('take', String(PAGE_SIZE));
  apiParams.set('skip', String((pageNum - 1) * PAGE_SIZE));
  const qs = `?${apiParams.toString()}`;

  const summaryRes = await loadOrFallback<ApiDashboardSummary>('/dashboard/summary', DEMO_SUMMARY);
  const buyersRes = await loadOrFallback<ApiBuyer[]>(`/buyers${qs}`, DEMO_BUYERS);
  const suppliersRes = await loadOrFallback<ApiSupplier[]>(`/suppliers${qs}`, DEMO_SUPPLIERS);
  const presets = await apiGet<ApiLoopPreset[]>('/loop-presets').catch(() => [] as ApiLoopPreset[]);

  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title="Buyers & Suppliers"
        sub="Buyers receive branded reports. Suppliers are the factories you inspect. Linked by POs and products."
      />
      <StatTiles summary={summaryRes.data} />
      <DirectoryClient
        buyers={buyersRes.data}
        suppliers={suppliersRes.data}
        presets={presets}
        live={buyersRes.live}
        page={pageNum}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
