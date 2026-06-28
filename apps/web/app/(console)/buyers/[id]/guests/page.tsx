import { notFound } from 'next/navigation';
import { apiGet, type ApiBuyer, type ApiBuyerGuest } from '@/lib/api';
import { Btn, PageHead } from '@/components/inspect/shell';
import { GuestsClient } from './guests-client';

export const dynamic = 'force-dynamic';

export default async function BuyerGuestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let buyer: ApiBuyer;
  let guests: ApiBuyerGuest[] = [];
  try {
    [buyer, guests] = await Promise.all([
      apiGet<ApiBuyer>(`/buyers/${id}`),
      apiGet<ApiBuyerGuest[]>(`/buyers/${id}/guests`).catch(() => []),
    ]);
  } catch {
    notFound();
  }

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <PageHead
        title={`${buyer.name} — Guest Access`}
        sub="Guests receive a time-limited link to view reports for this buyer."
        actions={<Btn kind="ghost" href={`/buyers/${id}`}>← Back to buyer</Btn>}
      />
      <GuestsClient buyerId={id} initialGuests={guests} />
    </div>
  );
}
