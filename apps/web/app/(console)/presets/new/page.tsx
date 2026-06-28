import { loadOrFallback, apiGet, type ApiDefectCatalog, type ApiLoopPresetDetail } from '@/lib/api';
import PresetBuilder from './builder';

export const dynamic = 'force-dynamic';

export default async function PresetBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  const { data: catalog } = await loadOrFallback<ApiDefectCatalog[]>('/defect-catalog', []);

  let seed: ApiLoopPresetDetail | undefined;
  if (from) {
    try {
      seed = await apiGet<ApiLoopPresetDetail>(`/loop-presets/${from}`);
    } catch {
      // Preset not found or not accessible — proceed as new
    }
  }

  return <PresetBuilder catalog={catalog} seed={seed} />;
}
