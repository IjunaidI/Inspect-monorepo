import { conclusionFrom, formatGps, formatInspectionType, reportNumber } from '@inspect/domain';
import { apiGet, apiPost, type ApiInspection, type ApiReport } from '@/lib/api';
import { BrandedReport, type BrandedReportData, type ReportPhoto } from '@/components/inspect/branded-report';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function mapToReportData(inspection: ApiInspection, report: ApiReport | null): BrandedReportData {
  const clientName = inspection.clientCompany?.name ?? '—';
  const r = inspection.aqlResult;
  const cs = inspection.computedSampling;

  const classes: BrandedReportData['classes'] = (['critical', 'major', 'minor'] as const).map((sev) => ({
    sev,
    aql: cs?.perClass?.[sev]?.aql ?? 0,
    found: r?.perClass?.[sev]?.found ?? 0,
    ac: r?.perClass?.[sev]?.ac ?? 0,
    re: r?.perClass?.[sev]?.re ?? 0,
  }));

  // INS-081: evidence in CAPTURE order — one row per inspected UNIT (cycleIndex
  // ascending), holding that unit's shots in loop-item position order, each
  // labelled with its item. This mirrors the sequence the signed photoHashes
  // were frozen in (reports.service.generate), so the page reads like the loop
  // was walked. cycleIndex is 0-based in storage and may have gaps after a
  // discard; it is rendered 1-based from the stored value, never re-numbered.
  const itemsByPosition = [...(inspection.items ?? [])].sort((a, b) => a.position - b.position);
  const shotsByUnit = new Map<number, ReportPhoto[]>();
  const majorByUnit = new Map<number, number>();
  for (const item of itemsByPosition) {
    for (const p of item.photos ?? []) {
      shotsByUnit.set(p.cycleIndex, [...(shotsByUnit.get(p.cycleIndex) ?? []), { ...p, label: item.itemName }]);
    }
    for (const d of item.defects ?? []) {
      if (d.severity === 'MAJOR' && d.cycleIndex != null) {
        majorByUnit.set(d.cycleIndex, (majorByUnit.get(d.cycleIndex) ?? 0) + 1);
      }
    }
  }
  const photos: BrandedReportData['photos'] = [...shotsByUnit.keys()]
    .sort((a, b) => a - b)
    .map((cycleIndex) => ({
      loop: `Unit ${cycleIndex + 1}`,
      shots: shotsByUnit.get(cycleIndex) ?? [],
      flaggedCount: majorByUnit.get(cycleIndex) ?? 0,
    }));

  // INS-081: the measurement sheet is loop-global and recorded per UNIT, so it
  // groups by cycle rather than by item.
  const byCycle = new Map<number, NonNullable<typeof inspection.measurements>>();
  for (const m of inspection.measurements ?? []) {
    byCycle.set(m.cycleIndex, [...(byCycle.get(m.cycleIndex) ?? []), m]);
  }
  const measurements: BrandedReportData['measurements'] = [...byCycle.keys()]
    .sort((a, b) => a - b)
    .map((cycleIndex) => ({
      loop: `Unit ${cycleIndex + 1}`,
      items: byCycle.get(cycleIndex) ?? [],
    }));

  return {
    client: {
      name: clientName,
      initials: initials(clientName),
      // Real client brand colour; the token is only the no-colour fallback.
      color: inspection.clientCompany?.primaryColor ?? '#1457A3',
      loc: null,
    },
    meta: {
      // Synthetic display id — no reportNo column exists (documented as synthetic).
      reportNo: report ? reportNumber(report.id) : undefined,
      po: inspection.purchaseOrder?.poNumber ?? '—',
      product: inspection.product?.styleNumber ?? '—',
      factory: inspection.factoryCompany?.name ?? '—',
      type: formatInspectionType(inspection.inspectionType),
      date: report?.generatedAt
        ? new Date(report.generatedAt).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      inspector: inspection.assignedInspector?.name ?? null,
      gps: formatGps(inspection.factoryCompany?.gps),
    },
    conclusion: conclusionFrom(r?.qaDecision),
    qaRemarks: r?.qaRemarks,
    samplingPlan: cs
      ? {
          sampleSize: cs.sampleSize,
          codeLetter: cs.sampleSizeCodeLetter,
          lotSize: inspection.lotSize ?? 0,
        }
      : null,
    classes,
    photos: photos.length > 0 ? photos : undefined,
    measurements: measurements.length > 0 ? measurements : undefined,
    tamperProof: report
      ? {
          contentHash: report.contentHash,
          // INS-089: the person who generated the report (Report.generatedByUserId,
          // resolved by the API). Null — and an honest em-dash — for reports
          // generated before the column existed; they are never backfilled.
          signedBy: report.generatedBy?.name ?? report.generatedBy?.email ?? null,
          signedAt: report.generatedAt,
        }
      : null,
  };
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const inspection = await apiGet<ApiInspection>(`/inspections/${id}`).catch(() => null);
  if (!inspection) {
    return <div style={{ padding: '24px 32px' }}>Inspection not found.</div>;
  }

  let report: ApiReport | null = null;
  if (inspection.status === 'APPROVED' || inspection.status === 'REPORT_ISSUED') {
    try {
      report = await apiPost<ApiReport>(`/inspections/${id}/report`);
    } catch {
      // Status not APPROVED yet, or report generation failed — show banner below
    }
  }

  const data = mapToReportData(inspection, report);

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16, background: '#EEF1F5', minHeight: '100%' }}>
      {!report && (
        <div style={{ background: '#FAF1E2', border: '1px solid #EBD9B4', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#B5791A' }}>
          Report not yet generated. Status must be APPROVED. Current status: <strong>{inspection.status}</strong>
        </div>
      )}
      {report?.pdfStorageKey == null && report && (
        <div style={{ background: '#EAF3FB', border: '1px solid #BDD6EE', borderRadius: 8, padding: '10px 16px', fontSize: 12.5, color: '#1457A3' }}>
          PDF binary not yet rendered (INS-003 pending). Preview shown from live data. Download unavailable.
        </div>
      )}
      <div style={{ maxWidth: 880, margin: '0 auto', width: '100%', boxShadow: '0 4px 24px rgba(11,18,32,0.12)', borderRadius: 8, overflow: 'hidden' }}>
        <BrandedReport data={data} width="100%" />
      </div>
    </div>
  );
}
