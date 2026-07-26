import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { apiGet, type ApiOrganization } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { OrgsClient } from './orgs-client';

export const dynamic = 'force-dynamic';

export default async function AdminOrgsPage() {
  const session = (await auth()) as unknown as { role?: string } | null;
  // Middleware already routes non-admins away; this is the server-side backstop.
  if (session?.role !== 'PLATFORM_ADMIN') redirect('/dashboard');

  const orgs = await apiGet<ApiOrganization[]>('/admin/orgs').catch(() => [] as ApiOrganization[]);

  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title="Organizations"
        sub="Every tenant on the platform. Create one to onboard its first Org Owner, or enter a workspace to operate inside it."
      />
      <OrgsClient orgs={orgs} />
    </div>
  );
}
