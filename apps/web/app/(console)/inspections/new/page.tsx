import { ChevronRight, ClipboardList } from 'lucide-react';
import { apiGet, type ApiPurchaseOrder, type ApiLoopPreset, type ApiUser } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { CreateInspectionForm } from './create-form';

export default async function CreateInspectionPage() {
  const [pos, presets, users] = await Promise.all([
    apiGet<ApiPurchaseOrder[]>('/purchase-orders').catch(() => []),
    apiGet<ApiLoopPreset[]>('/loop-presets').catch(() => []),
    apiGet<ApiUser[]>('/users').catch(() => []),
  ]);
  const inspectors = users.filter((u) => u.role === 'INSPECTOR');

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <ClipboardList size={15} color={ui.sub} />
        <span>Inspections</span>
        <ChevronRight size={14} color={ui.faint} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>New inspection</span>
      </div>
      <PageHead title="Create inspection" sub="The AQL sampling plan is computed automatically from lot size." />
      <div style={{ marginTop: 24 }}>
        <CreateInspectionForm pos={pos} presets={presets} inspectors={inspectors} />
      </div>
    </div>
  );
}
