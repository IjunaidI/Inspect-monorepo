import type { CSSProperties } from 'react';
import { Lock } from 'lucide-react';
import { Mono, RoleBadge } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';

const input: CSSProperties = {
  width: '100%', height: 40, padding: '0 12px', fontSize: 13.5, background: '#fff', border: `1px solid ${ui.line}`,
  borderRadius: 8, fontFamily: 'inherit', color: ui.ink, outline: 'none', boxSizing: 'border-box',
};
const lbl: CSSProperties = { fontSize: 12, fontWeight: 550, color: ui.ink, display: 'block', marginBottom: 6 };

export default function InviteAcceptPage() {
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
              <b style={{ color: ui.ink, fontWeight: 600 }}>Riya Saraf</b> invited you to join the{' '}
              <b style={{ color: ui.ink, fontWeight: 600 }}>Asha Inspection Services</b> workspace.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: 12, background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 10 }}>
            <span style={{ fontSize: 12, color: ui.sub }}>Assigned role</span>
            <RoleBadge role="qa" />
            <Mono style={{ marginLeft: 'auto', fontSize: 12, color: ui.faint }}>meera@asha-inspect.com</Mono>
          </div>
        </div>

        <div style={{ padding: '22px 28px' }}>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Full name</label>
            <input style={input} defaultValue="Meera Nair" />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={lbl}>Set a password</label>
            <input style={input} type="password" defaultValue="············" />
            <div style={{ fontSize: 11.5, color: ui.faint, marginTop: 6 }}>At least 12 characters.</div>
          </div>
          <button style={{ width: '100%', height: 44, background: ui.accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
            Accept invitation
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 14, fontSize: 11.5, color: ui.faint }}>
            <Lock size={13} color={ui.faint} /> Onboarding is invite-only · there is no public sign-up.
          </div>
        </div>
      </div>
    </div>
  );
}
