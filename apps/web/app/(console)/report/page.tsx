import { BrandedReport } from '@/components/inspect/branded-report';

export default function ReportPage() {
  return (
    <div style={{ padding: 28, display: 'flex', justifyContent: 'center', background: '#EEF1F5', minHeight: '100%' }}>
      <div style={{ width: 880, maxWidth: '100%', boxShadow: '0 4px 24px rgba(11,18,32,0.12)', borderRadius: 8, overflow: 'hidden', height: 'fit-content' }}>
        <BrandedReport width="100%" />
      </div>
    </div>
  );
}
