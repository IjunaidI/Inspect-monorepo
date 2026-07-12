import { Mono, RoleBadge } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import { ApiError, apiGetPublic, type ApiInvitationLookup } from '@/lib/api';
import { AcceptForm } from './accept-form';

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  INSPECTOR: 'Inspector',
  QA_MANAGER: 'QA Manager',
  ORG_OWNER: 'Org Owner',
};
const ROLE_KEY: Record<string, 'inspector' | 'qa' | 'owner'> = {
  INSPECTOR: 'inspector',
  QA_MANAGER: 'qa',
  ORG_OWNER: 'owner',
};

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ minHeight: '100vh', background: ui.bg, fontFamily: ui.font, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 16, padding: '32px 36px', textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: ui.sub, lineHeight: 1.6 }}>{body}</div>
      </div>
    </div>
  );
}

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <ErrorCard
        title="Invalid invitation link"
        body="This link is missing a token. Please use the full link from your invitation email."
      />
    );
  }

  // Resolve the invitation server-side (INS-054): the page renders VERIFIED
  // email/role/org from the API, never the spoofable query params.
  let invitation: ApiInvitationLookup;
  try {
    invitation = await apiGetPublic<ApiInvitationLookup>(`/invitations/${encodeURIComponent(token)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return (
        <ErrorCard
          title="Invitation not found"
          body="This invitation link isn't recognized. Check that you used the full link from your invitation email, or ask your Org Owner to send a new invite."
        />
      );
    }
    if (e instanceof ApiError && e.status === 410) {
      return (
        <ErrorCard
          title="Invitation no longer valid"
          body="This invitation was already used or has expired. Ask your Org Owner to send you a new invite."
        />
      );
    }
    return (
      <ErrorCard
        title="Could not verify the invitation"
        body="The invitation service did not respond. Please try again shortly."
      />
    );
  }

  const roleKey = ROLE_KEY[invitation.role] ?? 'inspector';

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: ui.bg, fontFamily: ui.font, color: ui.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: 460, maxWidth: '100%', background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 12px 40px rgba(11,18,32,0.10)' }}>
        <div style={{ padding: '26px 28px 22px', borderBottom: `1px solid ${ui.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: ui.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15 }}>I</div>
            <span style={{ fontWeight: 600, fontSize: 16 }}>Inspect</span>
          </div>
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: -0.3 }}>You&apos;ve been invited</div>
            <div style={{ fontSize: 13.5, color: ui.sub, marginTop: 6, lineHeight: 1.5 }}>
              {invitation.orgName ? (
                <>You&apos;ve been invited to join <b style={{ color: ui.ink, fontWeight: 600 }}>{invitation.orgName}</b> on Inspect.</>
              ) : (
                'You\'ve been invited to join an Inspect workspace.'
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: 12, background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 10 }}>
            <span style={{ fontSize: 12, color: ui.sub }}>Assigned role</span>
            <RoleBadge role={roleKey} />
            <span style={{ fontSize: 12, color: ui.sub }}>{ROLE_LABEL[invitation.role] ?? invitation.role}</span>
            <Mono style={{ marginLeft: 'auto', fontSize: 12, color: ui.faint }}>{invitation.email}</Mono>
          </div>
        </div>
        <AcceptForm token={token} />
      </div>
    </div>
  );
}
