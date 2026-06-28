import { apiGet, apiPost, type ApiInspection, type ApiReport } from '@/lib/api';
import { BrandedReport, type BrandedReportData } from '@/components/inspect/branded-report';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function mapConclusion(decision?: string | null): 'pass' | 'fail' | 'hold' {
  if (decision === 'PASS') return 'pass';
  if (decision === 'HOLD') return 'hold';
  return 'fail';
}

function mapToReportData(inspection: ApiInspection, report: ApiReport | null): BrandedReportData {
  const buyerName = inspection.buyer?.name ?? '—';
  const r = inspection.aqlResult;
  const cs = inspection.computedSampling;

  const classes: BrandedReportData['classes'] = (['critical', 'major', 'minor'] as const).map((sev) => ({
    sev,
    aql: cs?.perClass?.[sev]?.aql ?? 0,
    found: r?.perClass?.[sev]?.found ?? 0,
    ac: r?.perClass?.[sev]?.ac ?? 0,
    re: r?.perClass?.[sev]?.re ?? 0,
  }));

  const photos: BrandedReportData['photos'] = (inspection.loops ?? [])
    .filter((l) => (l.photos?.length ?? 0) > 0)
    .map((l) => ({
      loop: l.name,
      shots: l.photos ?? [],
      flaggedCount: (l.defects ?? []).filter((d) => d.severity === 'MAJOR').length,
    }));

  const measurements: BrandedReportData['measurements'] = (inspection.loops ?? [])
    .filter((l) => (l.measurements?.length ?? 0) > 0)
    .map((l) => ({
      loop: l.name,
      items: l.measurements ?? [],
    }));

  return {
    buyer: {
      name: buyerName,
      initials: initials(buyerName),
      color: '#1457A3',
      loc: null,
    },
    meta: {
      reportNo: report?.reportNo,
      po: inspection.purchaseOrder?.poNumber ?? '—',
      product: inspection.product?.styleNumber ?? '—',
      supplier: inspection.supplier?.name ?? '—',
      type: 'Pre-shipment (FRI)',
      date: report?.generatedAt
        ? new Date(report.generatedAt).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      inspector: null,
    },
    conclusion: mapConclusion(r?.qaDecision),
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
          signedBy: report.generatedBy?.name,
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
