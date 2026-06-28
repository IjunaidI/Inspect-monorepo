'use client';

import { useActionState } from 'react';
import { Lock } from 'lucide-react';
import { ui } from '@/components/inspect/tokens';
import { acceptInvitation } from './actions';

const inputStyle = {
  width: '100%',
  height: 40,
  padding: '0 12px',
  fontSize: 13.5,
  background: '#fff',
  border: `1px solid ${ui.line}`,
  borderRadius: 8,
  fontFamily: 'inherit',
  color: ui.ink,
  outline: 'none',
  boxSizing: 'border-box' as const,
};
const lblStyle = { fontSize: 12, fontWeight: 550, color: ui.ink, display: 'block', marginBottom: 6 };

export function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvitation, {});

  return (
    <div style={{ padding: '22px 28px' }}>
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        {state.error && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: '#DC2626' }}>
            {state.error}
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <label style={lblStyle}>Full name</label>
          <input name="name" style={inputStyle} placeholder="Your name" autoComplete="name" />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={lblStyle}>Set a password</label>
          <input name="password" type="password" style={inputStyle} placeholder="At least 8 characters" autoComplete="new-password" required minLength={8} />
          <div style={{ fontSize: 11.5, color: ui.faint, marginTop: 6 }}>At least 8 characters.</div>
        </div>
        <button
          type="submit"
          style={{ width: '100%', height: 44, background: pending ? ui.sub : ui.accent, color: '#fff', borderWidth: 0, borderRadius: 10, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.75 : 1 }}
        >
          {pending ? 'Activating account…' : 'Accept invitation'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 14, fontSize: 11.5, color: ui.faint }}>
          <Lock size={13} color={ui.faint} /> Onboarding is invite-only · there is no public sign-up.
        </div>
      </form>
    </div>
  );
}
