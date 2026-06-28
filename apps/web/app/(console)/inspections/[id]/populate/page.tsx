import { auth } from '@/lib/auth';
import { apiGet, type ApiInspection, type ApiDefectCatalogItem } from '@/lib/api';
import { PopulateWorkspace } from './populate-workspace';

export default async function PopulatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = (await auth()) as { role?: string } | null;
  if (session?.role !== 'PLATFORM_ADMIN') {
    return <div style={{ padding: '24px 32px' }}>Access restricted to Platform Admin.</div>;
  }

  let inspection: ApiInspection | null = null;
  try {
    inspection = await apiGet<ApiInspection>(`/inspections/${id}`);
  } catch {
    inspection = null;
  }
  if (!inspection) {
    return <div style={{ padding: '24px 32px' }}>Inspection not found.</div>;
  }

  const catalog = await apiGet<ApiDefectCatalogItem[]>('/defect-catalog').catch(() => []);

  return <PopulateWorkspace inspection={inspection} catalog={catalog} />;
}
