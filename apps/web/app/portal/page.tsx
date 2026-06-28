import { Lock } from 'lucide-react';
import { apiGetPublic, type ApiGuestReport } from '@/lib/api';
import { ui } from '@/components/inspect/tokens';
import { PortalClient } from './portal-client';

export const dynamic = 'force-dynamic';

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ minHeight: '100vh', background: ui.bg, fontFamily: ui.font, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, width: '100%', background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 16, padding: '32px 36px', textAlign: 'center', boxShadow: '0 8px 32px rgba(11,18,32,0.08)' }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <Lock size={22} color="#DC2626" />
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: ui.sub, lineHeight: 1.6 }}>{body}</div>
        <div style={{ marginTop: 20, fontSize: 11.5, color: ui.faint }}>Contact your QA manager if you believe this is an error.</div>
      </div>
    </div>
  );
}

export default async function GuestPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <ErrorCard
        title="No access token"
        body="This page requires a guest token. Please use the link sent to you by your QA manager."
      />
    );
  }

  let reports: ApiGuestReport[] = [];
  let errorMsg: string | null = null;

  try {
    reports = await apiGetPublic<ApiGuestReport[]>(`/guest/reports?token=${encodeURIComponent(token)}`);
  } catch (e) {
    errorMsg = e instanceof Error && e.message.includes('401')
      ? 'Your guest link has expired or is invalid.'
      : 'Unable to load reports. Please try again later.';
  }

  if (errorMsg) {
    return <ErrorCard title="Access denied" body={errorMsg} />;
  }

  // Derive buyer identity from the first report's snapshot/branding
  const first = reports[0];
  const canonical = (first?.canonicalSnapshot ?? {}) as { buyer?: { name?: string } };
  const branding = (first?.brandingSnapshot ?? {}) as { primaryColor?: string };
  const buyerName = canonical?.buyer?.name ?? 'Buyer';
  const buyer = {
    name: buyerName,
    initials: initialsOf(buyerName),
    color: branding?.primaryColor ?? '#037BF4',
  };

  return <PortalClient token={token} reports={reports} buyer={buyer} />;
}
