import { ChevronRight, ClipboardList } from 'lucide-react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { apiRoleAtLeast } from '@/lib/roles';
import { apiGet, type ApiPurchaseOrder, type ApiLoopPreset, type ApiUser, type ApiCompany, type ApiProduct } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { CreateInspectionForm } from './create-form';

export default async function CreateInspectionPage() {
  const session = (await auth()) as unknown as { role?: string } | null;
  // Web-side UX gate only (INS-065) — the API's QA floor on POST /inspections is the authority.
  if (!apiRoleAtLeast(session?.role, 'QA_MANAGER')) redirect('/inspections');

  // INS-091: companies + products feed the PO quick-create dialog, so a fresh
  // org can go from nothing to a created inspection on this one screen.
  const [pos, presets, users, companies, products] = await Promise.all([
    apiGet<ApiPurchaseOrder[]>('/purchase-orders').catch(() => []),
    apiGet<ApiLoopPreset[]>('/loop-presets').catch(() => []),
    apiGet<ApiUser[]>('/users').catch(() => []),
    apiGet<ApiCompany[]>('/companies').catch(() => []),
    apiGet<ApiProduct[]>('/products').catch(() => []),
  ]);
  const inspectors = users.filter((u) => u.role === 'INSPECTOR' && u.status === 'ACTIVE');

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13, marginBottom: 14 }}>
        <ClipboardList size={15} color={ui.sub} />
        <span>Inspections</span>
        <ChevronRight size={14} color={ui.faint} />
        <span style={{ color: ui.ink, fontWeight: 550 }}>New inspection</span>
      </div>
      <PageHead title="Create inspection" sub="Set the per-class AQL; the Level II sampling plan is computed from it and the lot size, then frozen onto the inspection." />
      <div style={{ marginTop: 24 }}>
        <CreateInspectionForm pos={pos} presets={presets} inspectors={inspectors} companies={companies} products={products} />
      </div>
    </div>
  );
}
