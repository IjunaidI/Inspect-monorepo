import { BrandedReport, type BrandedReportData } from '@/components/inspect/branded-report';

const previewData: BrandedReportData = {
  buyer: { name: 'Nordvik Retail Group', initials: 'NV', color: '#1457A3', loc: 'Oslo, Norway' },
  meta: {
    reportNo: 'IR-2026-04812-F',
    po: 'PO-2026-04812',
    product: "Men's Knit Polo Shirt",
    sku: 'NV-KP-2241',
    supplier: 'Tirupur Knits Unit-3',
    supplierLoc: 'Tirupur, India',
    inspector: 'Deepak Menon',
    type: 'Pre-shipment (FRI)',
    date: '2026-05-09',
    gps: '11.1085° N, 77.3411° E',
  },
  conclusion: 'fail',
  classes: [
    { sev: 'critical', aql: 0, found: 0, ac: 0, re: 1 },
    { sev: 'major', aql: 2.5, found: 9, ac: 7, re: 8 },
    { sev: 'minor', aql: 4.0, found: 6, ac: 10, re: 11 },
  ],
};

export default function ReportPage() {
  return (
    <div style={{ padding: 28, display: 'flex', justifyContent: 'center', background: '#EEF1F5', minHeight: '100%' }}>
      <div style={{ width: 880, maxWidth: '100%', boxShadow: '0 4px 24px rgba(11,18,32,0.12)', borderRadius: 8, overflow: 'hidden', height: 'fit-content' }}>
        <BrandedReport data={previewData} width="100%" />
      </div>
    </div>
  );
}
