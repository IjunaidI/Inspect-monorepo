import type { CSSProperties } from 'react';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { Lock } from 'lucide-react';
import { signIn } from '@/lib/auth';
import { ui } from '@/components/inspect/tokens';

const input: CSSProperties = {
  width: '100%', height: 40, padding: '0 12px', fontSize: 13.5, background: '#fff', border: `1px solid ${ui.line}`,
  borderRadius: 8, fontFamily: 'inherit', color: ui.ink, outline: 'none', boxSizing: 'border-box'
};
const lbl: CSSProperties = { fontSize: 12, fontWeight: 550, color: ui.ink, display: 'block', marginBottom: 6 };

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; invited?: string; expired?: string }>;
}) {
  const { error, invited, expired } = await searchParams;

  async function login(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    try {
      await signIn('credentials', { email, password, redirectTo: '/dashboard' });
    } catch (e) {
      if (e instanceof AuthError) {
        redirect('/login?error=CredentialsSignin');
      }
      throw e; // re-throw the NEXT_REDIRECT on success
    }
  }

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: ui.bg, fontFamily: ui.font, color: ui.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: 400, maxWidth: '100%', background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 12px 40px rgba(11,18,32,0.10)' }}>
        <div style={{ padding: '26px 28px 22px', borderBottom: `1px solid ${ui.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: ui.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15 }}>I</div>
            <span style={{ fontWeight: 600, fontSize: 16 }}>Inspect</span>
          </div>
          <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: -0.3, marginTop: 18 }}>Sign in</div>
          <div style={{ fontSize: 13, color: ui.sub, marginTop: 6 }}>Use your Inspect workspace credentials.</div>
        </div>

        <form action={login} style={{ padding: '22px 28px' }}>
          {expired && (
            <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 8, background: '#FFF7ED', color: '#92400E', fontSize: 12.5, fontWeight: 500 }}>
              Your session expired. Please sign in again.
            </div>
          )}
          {invited && (
            <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 8, background: '#F0FDF4', color: '#16A34A', fontSize: 12.5, fontWeight: 500 }}>
              Account activated! Sign in with your new password.
            </div>
          )}
          {error && (
            <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 8, background: '#FBEAEA', color: '#B42318', fontSize: 12.5, fontWeight: 500 }}>
              Invalid email or password.
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <label style={lbl} htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required style={input} placeholder="you@org.com" />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={lbl} htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required style={input} placeholder="••••••••" />
          </div>
          <button type="submit" style={{ width: '100%', height: 44, background: ui.accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
            Sign in
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 14, fontSize: 11.5, color: ui.faint }}>
            <Lock size={13} color={ui.faint} /> Invite-only · accounts are provisioned by your Org Owner.
          </div>
        </form>
      </div>
    </div>
  );
}
