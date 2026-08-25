import { auth } from '@/lib/auth';
import { apiGet, type ApiInspection, type ApiDefectCatalogItem } from '@/lib/api';
import { apiRoleAtLeast } from '@/lib/roles';
import { PopulateWorkspace } from './populate-workspace';

export default async function PopulatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // INS-083: capture belongs to the inspector, so the floor here mirrors the
  // API's (INSPECTOR). This gate only hides a screen — the real boundary is the
  // API's row-level scope, which resolves an inspection the caller may not see
  // to a 404 and lands on the "not found" branch below.
  const session = (await auth()) as { role?: string } | null;
  if (!apiRoleAtLeast(session?.role, 'INSPECTOR')) {
    return <div style={{ padding: '24px 32px' }}>Sign in to populate an inspection.</div>;
  }

  let inspection: ApiInspection | null = null;
  try {
    inspection = await apiGet<ApiInspection>(`/inspections/${id}/populate`);
  } catch {
    inspection = null;
  }
  if (!inspection) {
    return <div style={{ padding: '24px 32px' }}>Inspection not found.</div>;
  }

  const catalog = await apiGet<ApiDefectCatalogItem[]>('/defect-catalog').catch(() => []);

  return <PopulateWorkspace inspection={inspection} catalog={catalog} />;
}
