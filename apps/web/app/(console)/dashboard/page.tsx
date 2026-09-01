import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { STATUS_BUCKETS } from '@inspect/domain';
import {
  apiGet,
  loadOrFallback,
  type ApiCompany,
  type ApiDashboardSummary,
  type ApiLoopPreset,
  type ApiQualityMetrics,
} from '@/lib/api';
import { auth } from '@/lib/auth';
import { apiRoleAtLeast } from '@/lib/roles';
import { Mono, PageHead } from '@/components/inspect/shell';
import { ErrorBoundary } from '@/components/inspect/error-boundary';
import { ui } from '@/components/inspect/tokens';
import { DirectoryClient } from './directory-client';

export const dynamic = 'force-dynamic';

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

/**
 * INS-055: one fallback fixture, mixing both ownership kinds so the directory's
 * filter chips still have something to separate when the API is unreachable.
 * The brand-carrying rows are the ones that used to be buyers; the addressed
 * rows are the ones that used to be suppliers — but nothing here declares a
 * trade role, because a row cannot have one.
 */
const DEMO_COMPANIES: ApiCompany[] = [
  { id: 'demo-c1', name: 'Nordvik Retail Group', kind: 'THIRD_PARTY', primaryColor: '#1457A3', updatedAt: daysAgo(1), _count: { purchaseOrders: 6, inspections: 9, reports: 4 } },
  { id: 'demo-c2', name: 'Maison Adèle', kind: 'THIRD_PARTY', primaryColor: '#0B7D6B', updatedAt: daysAgo(3), _count: { purchaseOrders: 3, inspections: 5, reports: 2 } },
  { id: 'demo-c3', name: 'Beaumont Living', kind: 'THIRD_PARTY', primaryColor: '#C2410C', updatedAt: daysAgo(6), _count: { purchaseOrders: 2, inspections: 2, reports: 1 } },
  { id: 'demo-c4', name: 'Kestrel & Thorne', kind: 'THIRD_PARTY', primaryColor: '#7C3AED', updatedAt: daysAgo(8), _count: { purchaseOrders: 4, inspections: 6, reports: 3 } },
  { id: 'demo-c5', name: 'Tirupur Knits Unit-3', kind: 'INTERNAL', address: 'Tirupur, India', gps: { lat: 11.1085, lng: 77.3411 }, updatedAt: daysAgo(2), _count: { purchaseOrders: 7, inspections: 11, reports: 0 } },
  { id: 'demo-c6', name: 'Dhaka Weave Ltd.', kind: 'THIRD_PARTY', address: 'Dhaka, Bangladesh', gps: { lat: 23.8103, lng: 90.4125 }, updatedAt: daysAgo(4), _count: { purchaseOrders: 5, inspections: 8, reports: 0 } },
  { id: 'demo-c7', name: 'Karachi Home Mills', kind: 'THIRD_PARTY', address: 'Karachi, Pakistan', gps: null, updatedAt: daysAgo(9), _count: { purchaseOrders: 2, inspections: 3, reports: 0 } },
  { id: 'demo-c8', name: 'Hanoi Apparel Co.', kind: 'INTERNAL', address: 'Hanoi, Vietnam', gps: { lat: 21.0285, lng: 105.8542 }, updatedAt: daysAgo(15), _count: { purchaseOrders: 4, inspections: 4, reports: 0 } },
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
  companies: 8,
  products: 14,
  purchaseOrders: 18,
  reports: 12,
};

const countIn = (byStatus: Record<string, number>, statuses: readonly string[]) =>
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
        {STATUS_BUCKETS.map(({ label, statuses }) => (
          <StatTile key={label} label={label} value={num(countIn(byStatus, statuses))} />
        ))}
        <StatTile label="Pass rate" value={pct(quality.passRate)} hint={qualityHint} />
      </TileRow>
      <TileRow>
        <StatTile label="Companies" value={num(summary.companies)} />
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
  searchParams: Promise<{
    includeArchived?: string;
    q?: string;
    page?: string;
    kind?: string;
  }>;
}) {
  // Every read below (/dashboard/summary, /companies) floors at
  // QA_MANAGER, and loadOrFallback deliberately RETHROWS 401/403 rather than
  // showing demo data to an authenticated user. An INSPECTOR therefore hit the
  // console error boundary here — and `/` redirects to this screen, so it was
  // the first thing they saw after logging in. Same gate + destination the
  // users screen already uses.
  const session = (await auth()) as unknown as { role?: string } | null;
  if (!apiRoleAtLeast(session?.role, 'QA_MANAGER')) redirect('/inspections');

  const { includeArchived, q, page, kind } = await searchParams;
  const pageNum = Math.max(parseInt(page ?? '1', 10) || 1, 1);

  // Default = active rows only (API default); ?includeArchived=1 shows everything.
  // Server-side search + pagination (INS-050): forward q/take/skip.
  // INS-055: ?kind= narrows by ownership. An unrecognised value is ignored by
  // the API rather than 400ing, so a stale bookmark still renders.
  const apiParams = new URLSearchParams();
  if (includeArchived === '1') apiParams.set('includeArchived', '1');
  if (q) apiParams.set('q', q);
  if (kind) apiParams.set('kind', kind);
  apiParams.set('take', String(PAGE_SIZE));
  apiParams.set('skip', String((pageNum - 1) * PAGE_SIZE));
  const qs = `?${apiParams.toString()}`;

  const summaryRes = await loadOrFallback<ApiDashboardSummary>('/dashboard/summary', DEMO_SUMMARY);
  const companiesRes = await loadOrFallback<ApiCompany[]>(`/companies${qs}`, DEMO_COMPANIES);
  const presets = await apiGet<ApiLoopPreset[]>('/loop-presets').catch(() => [] as ApiLoopPreset[]);

  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title="Companies"
        sub="Every counterparty you trade with. Whether a company is the client or the factory is decided per purchase order — the same company can be either."
      />
      <StatTiles summary={summaryRes.data} />
      <ErrorBoundary label="The companies directory">
        <DirectoryClient
          companies={companiesRes.data}
          presets={presets}
          live={companiesRes.live}
          page={pageNum}
          pageSize={PAGE_SIZE}
        />
      </ErrorBoundary>
    </div>
  );
}
