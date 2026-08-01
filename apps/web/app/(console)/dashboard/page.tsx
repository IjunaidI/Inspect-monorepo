import type { ReactNode } from 'react';
import {
  apiGet,
  loadOrFallback,
  type ApiBuyer,
  type ApiDashboardSummary,
  type ApiLoopPreset,
  type ApiQualityMetrics,
  type ApiSupplier,
} from '@/lib/api';
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
  // Demo and live must agree in SHAPE, and the demo numbers must be internally
  // consistent (INS-068): the decided statuses below match qaDecisionCounts, and
  // quality is the arithmetic those counts imply.
  inspectionsByStatus: {
    DRAFT: 2,
    ASSIGNED: 1,
    IN_PROGRESS: 4,
    SUBMITTED: 3,
    UNDER_REVIEW: 2,
    HOLD: 1,
    APPROVED: 5,
    REPORT_ISSUED: 12,
    REJECTED: 2,
  },
  qaDecisionCounts: { PASS: 17, FAIL: 2, HOLD: 1, PENDING: 5 },
  quality: {
    decidedInspections: 20,
    sampledUnits: 1600, // 20 × code-J sample of 80
    defectsFound: 21,
    dphu: 1.31, // 100 × 21 / 1600 = 1.3125
    passRate: 89.5, // 100 × 17 / 19 (HOLD excluded)
    verdicts: 19,
    truncated: false,
  },
  buyers: 6,
  suppliers: 4,
  products: 14,
  purchaseOrders: 18,
  reports: 12,
};

/**
 * The nine InspectionStatus values folded into the four states a QA manager
 * actually acts on (INS-068). Every status belongs to exactly one bucket, so
 * the four tiles always sum to the org's total inspections.
 */
const STATUS_GROUPS: { label: string; statuses: string[] }[] = [
  { label: 'In progress', statuses: ['DRAFT', 'ASSIGNED', 'IN_PROGRESS'] },
  { label: 'Awaiting review', statuses: ['SUBMITTED', 'UNDER_REVIEW', 'HOLD'] },
  { label: 'Passed', statuses: ['APPROVED', 'REPORT_ISSUED'] },
  { label: 'Failed', statuses: ['REJECTED'] },
];

const countIn = (byStatus: Record<string, number>, statuses: string[]) =>
  statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);

const num = (value: number) => value.toLocaleString('en-US');
/** `null` (nothing decided yet) renders as an em dash, never as NaN or a bare 0. */
const pct = (value: number | null) => (value === null ? '—' : `${num(value)}%`);

const ZERO_QUALITY: ApiQualityMetrics = {
  decidedInspections: 0,
  sampledUnits: 0,
  defectsFound: 0,
  dphu: null,
  passRate: null,
  verdicts: 0,
  truncated: false,
};

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ background: ui.panel, border: `1px solid ${ui.line}`, borderRadius: 10, padding: '12px 16px' }}>
      <div style={{ fontSize: 10.5, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <Mono style={{ display: 'block', fontSize: 20, fontWeight: 600, color: ui.ink, marginTop: 4 }}>{value}</Mono>
      <div style={{ fontSize: 10.5, color: ui.faint, marginTop: 3, minHeight: 14 }}>{hint ?? ''}</div>
    </div>
  );
}

function TileRow({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>{children}</div>;
}

/**
 * Header KPI rows — real org-scoped rollups from GET /dashboard/summary.
 * Row 1 is the inspection pipeline + the org quality headline (INS-068); row 2
 * is the directory this screen manages.
 */
function StatTiles({ summary }: { summary: ApiDashboardSummary }) {
  // `?? ZERO_QUALITY`: @inspect/shared-types is not yet the wire contract
  // (INS-008), so an older API build could answer without `quality`. A missing
  // metric must degrade to the zero-state, never crash the dashboard.
  const quality = summary.quality ?? ZERO_QUALITY;
  const byStatus = summary.inspectionsByStatus ?? {};

  // Zero-state: no verdict yet -> "—" with a hint that says why, rather than a
  // confident-looking 0% that a QA manager would read as "everything failed".
  const qualityHint =
    quality.passRate === null
      ? 'No decisions yet'
      : `DPHU ${quality.dphu === null ? '—' : num(quality.dphu)} · ${num(quality.verdicts)} verdict${quality.verdicts === 1 ? '' : 's'}${quality.truncated ? ' (recent)' : ''}`;

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
      <TileRow>
        {STATUS_GROUPS.map(({ label, statuses }) => (
          <StatTile key={label} label={label} value={num(countIn(byStatus, statuses))} />
        ))}
        <StatTile label="Pass rate" value={pct(quality.passRate)} hint={qualityHint} />
      </TileRow>
      <TileRow>
        <StatTile label="Buyers" value={num(summary.buyers)} />
        <StatTile label="Suppliers" value={num(summary.suppliers)} />
        <StatTile label="Products" value={num(summary.products)} />
        <StatTile label="Purchase orders" value={num(summary.purchaseOrders)} />
        <StatTile label="Reports" value={num(summary.reports)} />
      </TileRow>
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
