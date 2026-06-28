import { Mono, RoleBadge } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
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

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string; role?: string; org?: string }>;
}) {
  const { token, email, role, org } = await searchParams;

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', background: ui.bg, fontFamily: ui.font, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 16, padding: '32px 36px', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Invalid invitation link</div>
          <div style={{ fontSize: 13.5, color: ui.sub }}>This link is missing a token. Please use the full link from your invitation email.</div>
        </div>
      </div>
    );
  }

  const roleKey = ROLE_KEY[role ?? ''] ?? 'inspector';

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
              {org ? (
                <>You&apos;ve been invited to join <b style={{ color: ui.ink, fontWeight: 600 }}>{org}</b> on Inspect.</>
              ) : (
                'You\'ve been invited to join an Inspect workspace.'
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: 12, background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 10 }}>
            <span style={{ fontSize: 12, color: ui.sub }}>Assigned role</span>
            <RoleBadge role={roleKey} />
            {role && <span style={{ fontSize: 12, color: ui.sub }}>{ROLE_LABEL[role] ?? role}</span>}
            {email && <Mono style={{ marginLeft: 'auto', fontSize: 12, color: ui.faint }}>{email}</Mono>}
          </div>
        </div>
        <AcceptForm token={token} />
      </div>
    </div>
  );
}
