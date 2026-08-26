import { notFound } from 'next/navigation';
import { apiGet, type ApiCompany, type ApiCompanyGuest } from '@/lib/api';
import { Btn, PageHead } from '@/components/inspect/shell';
import { GuestsClient } from './guests-client';

export const dynamic = 'force-dynamic';

export default async function CompanyGuestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let company: ApiCompany;
  let guests: ApiCompanyGuest[] = [];
  try {
    [company, guests] = await Promise.all([
      apiGet<ApiCompany>(`/companies/${id}`),
      apiGet<ApiCompanyGuest[]>(`/companies/${id}/guests`).catch(() => []),
    ]);
  } catch {
    notFound();
  }

  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <PageHead
        title={`${company.name} — Guest Access`}
        sub="Guests receive a time-limited link to the reports where this company is the CLIENT. Reports naming it as the factory are never shown."
        actions={<Btn kind="ghost" href={`/companies/${id}`}>← Back to company</Btn>}
      />
      <GuestsClient companyId={id} initialGuests={guests} />
    </div>
  );
}
