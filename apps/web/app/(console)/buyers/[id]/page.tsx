import { notFound } from 'next/navigation';
import { apiGet, type ApiBuyer, type ApiLoopPreset } from '@/lib/api';
import { Btn, PageHead } from '@/components/inspect/shell';
import { EditBuyerForm } from './edit-form';

export const dynamic = 'force-dynamic';

export default async function BuyerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let buyer: ApiBuyer;
  let presets: ApiLoopPreset[] = [];
  try {
    [buyer, presets] = await Promise.all([
      apiGet<ApiBuyer>(`/buyers/${id}`),
      apiGet<ApiLoopPreset[]>('/loop-presets').catch(() => []),
    ]);
  } catch {
    notFound();
  }

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <PageHead
        title={buyer.name}
        sub="Buyer configuration"
        actions={<Btn kind="ghost" href={`/buyers/${id}/guests`}>Manage guests</Btn>}
      />
      <EditBuyerForm buyer={buyer} presets={presets} />
    </div>
  );
}
