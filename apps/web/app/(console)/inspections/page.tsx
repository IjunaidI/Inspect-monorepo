import Link from 'next/link';
import { ChevronLeft, ChevronRight, ClipboardList, Search } from 'lucide-react';
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

const PAGE_SIZE = 50;

/** Build an /inspections href preserving the other filters (page resets unless given). */
function hrefFor(params: { status?: string; q?: string; page?: number }): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set('status', params.status);
  if (params.q) sp.set('q', params.q);
  if (params.page && params.page > 1) sp.set('page', String(params.page));
  const qs = sp.toString();
  return qs ? `/inspections?${qs}` : '/inspections';
}

function PagerLink({ href, disabled, dir }: { href: string; disabled: boolean; dir: 'prev' | 'next' }) {
  const style = {
    width: 28,
    height: 28,
    borderRadius: 6,
    border: `1px solid ${ui.line}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: disabled ? ui.faint : ui.sub,
    opacity: disabled ? 0.5 : 1,
    background: '#fff',
  } as const;
  const icon = dir === 'prev' ? <ChevronLeft size={14} /> : <ChevronRight size={14} />;
  if (disabled) return <span style={style} aria-disabled="true">{icon}</span>;
  return (
    <Link href={href} aria-label={dir === 'prev' ? 'Previous page' : 'Next page'} style={style}>
      {icon}
    </Link>
  );
}

export default async function InspectionsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const { status, q, page } = await searchParams;
  const pageNum = Math.max(parseInt(page ?? '1', 10) || 1, 1);

  // Server-side search + pagination (INS-050): forward q/take/skip to the API.
  const apiParams = new URLSearchParams();
  if (status) apiParams.set('status', status);
  if (q) apiParams.set('q', q);
  apiParams.set('take', String(PAGE_SIZE));
  apiParams.set('skip', String((pageNum - 1) * PAGE_SIZE));
  const inspections = await apiGet<ApiInspection[]>(`/inspections?${apiParams.toString()}`).catch(() => []);

  const subLabel = [
    `${inspections.length} shown`,
    status ? `filtered by ${status}` : null,
    q ? `matching “${q}”` : null,
    pageNum > 1 ? `page ${pageNum}` : null,
  ].filter(Boolean).join(' · ');

  const hasPrev = pageNum > 1;
  const hasNext = inspections.length === PAGE_SIZE;

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <ClipboardList size={15} color={ui.sub} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>Inspections</span>
      </div>
      <PageHead
        title="Inspections"
        sub={subLabel}
        actions={
          <>
            {/* Server-side search (INS-050): plain GET form — Enter submits ?q= */}
            <form method="GET" action="/inspections" style={{ position: 'relative' }}>
              {status && <input type="hidden" name="status" value={status} />}
              <Search size={15} color={ui.faint} style={{ position: 'absolute', left: 12, top: 10.5 }} />
              <input
                name="q"
                defaultValue={q ?? ''}
                placeholder="Search PO, buyer, style…"
                style={{ width: 280, height: 36, padding: '0 12px 0 36px', fontSize: 13, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
              />
            </form>
            <Btn kind="primary" href="/inspections/new">New inspection</Btn>
          </>
        }
      />

      {/* Status filter chips (preserve the search term) */}
      <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
        {STATUS_CHIPS.map((chip) => {
          const isActive = chip.value === status || (chip.value === undefined && !status);
          return (
            <Link
              key={chip.label}
              href={hrefFor({ status: chip.value, q })}
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
          {q
            ? `No inspections match “${q}”${status ? ` with status "${status}"` : ''}.`
            : status
              ? `No inspections with status "${status}".`
              : pageNum > 1
                ? 'No more inspections on this page.'
                : 'No inspections yet — create one.'}
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

      {/* Pagination (INS-050): more pages inferred by a full page of rows */}
      {(hasPrev || hasNext) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 12, color: ui.sub, fontSize: 12.5 }}>
          <span>Page <Mono>{pageNum}</Mono></span>
          <PagerLink dir="prev" disabled={!hasPrev} href={hrefFor({ status, q, page: pageNum - 1 })} />
          <PagerLink dir="next" disabled={!hasNext} href={hrefFor({ status, q, page: pageNum + 1 })} />
        </div>
      )}
    </div>
  );
}
