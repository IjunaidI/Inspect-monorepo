'use client';

import { useActionState, useTransition, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Btn, Mono } from '@/components/inspect/shell';
import { ui } from '@/components/inspect/tokens';
import type { ApiBuyerGuest } from '@/lib/api';
import { inviteBuyerGuest, revokeBuyerGuest } from './actions';

const label = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.4 };
const input = { height: 36, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '4px 10px', border: `1px solid ${ui.line}`, borderRadius: 6, background: '#fff', cursor: 'pointer', color: copied ? '#16A34A' : ui.sub }}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

const guestStatusStyle: Record<string, { label: string; fg: string; dot: string }> = {
  ACTIVE: { label: 'Active', fg: '#1F6B43', dot: '#1F8A4C' },
  SUSPENDED: { label: 'Revoked', fg: '#DC2626', dot: '#DC2626' },
};

function GuestRow({ guest, buyerId }: { guest: ApiBuyerGuest; buyerId: string }) {
  const [pending, start] = useTransition();
  const expired = new Date(guest.tokenExpiresAt) < new Date();
  const ss = guestStatusStyle[guest.status] ?? { label: guest.status, fg: ui.sub, dot: ui.faint };

  return (
    <tr style={{ borderBottom: `1px solid ${ui.lineSoft}` }}>
      <td style={{ padding: '12px 20px', fontSize: 13 }}>{guest.email}</td>
      <td style={{ padding: '12px 20px', fontSize: 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: ss.fg, fontWeight: 500 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: ss.dot }} /> {ss.label}
        </span>
      </td>
      <td style={{ padding: '12px 20px', fontSize: 12, color: expired ? '#DC2626' : ui.sub }}>
        {expired ? 'Expired' : `Expires ${new Date(guest.tokenExpiresAt).toLocaleDateString()}`}
      </td>
      <td style={{ padding: '12px 20px', fontSize: 12, color: ui.sub }}>
        {guest.lastAccessAt ? new Date(guest.lastAccessAt).toLocaleDateString() : '—'}
      </td>
      <td style={{ padding: '12px 20px', fontSize: 12, color: ui.faint }}>
        {new Date(guest.createdAt).toLocaleDateString()}
      </td>
      <td style={{ padding: '12px 20px', textAlign: 'right' }}>
        {/* No per-row magic-link copy: the list endpoint deliberately never returns
            the token — a fresh link exists only in the invite-success state above. */}
        <button onClick={() => start(async () => { await revokeBuyerGuest(buyerId, guest.id); })} disabled={pending}
          style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #FECACA', borderRadius: 6, background: '#FEF2F2', color: '#DC2626', cursor: pending ? 'default' : 'pointer', fontFamily: 'inherit', opacity: pending ? 0.6 : 1 }}>
          {pending ? '…' : 'Revoke'}
        </button>
      </td>
    </tr>
  );
}

export function GuestsClient({ buyerId, initialGuests }: { buyerId: string; initialGuests: ApiBuyerGuest[] }) {
  const boundInvite = inviteBuyerGuest.bind(null, buyerId);
  const [state, action, pending] = useActionState(boundInvite, {});

  return (
    <div style={{ marginTop: 24 }}>
      {/* Invite form */}
      <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '20px 24px', maxWidth: 540, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Invite a guest</div>
        <form action={action}>
          {state.error && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: '#DC2626' }}>{state.error}</div>
          )}
          {state.data && (
            <div style={{ marginBottom: 12, padding: '10px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8 }}>
              <div style={{ fontSize: 12.5, color: '#16A34A', marginBottom: 6 }}>
                {state.data.emailSent
                  ? 'Magic link emailed — link below as backup.'
                  : 'Email could not be sent — share this link manually:'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Mono style={{ fontSize: 11.5, wordBreak: 'break-all', flex: 1, color: ui.ink }}>{`/portal?token=${state.data.token}`}</Mono>
                <CopyButton text={`${typeof window !== 'undefined' ? window.location.origin : ''}/portal?token=${state.data.token}`} />
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'flex-end' }}>
            <div>
              <label style={label}>Email *</label>
              <input name="email" type="email" required style={{ ...input, width: '100%' }} placeholder="buyer@example.com" />
            </div>
            <div>
              <label style={label}>Expires in</label>
              <select name="expiresInDays" defaultValue="30" style={{ ...input, width: 120 }}>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </select>
            </div>
            <Btn kind="primary" type="submit" style={{ opacity: pending ? 0.65 : 1, marginBottom: 1 }}>
              {pending ? 'Sending…' : 'Invite'}
            </Btn>
          </div>
        </form>
      </div>

      {/* Guest list */}
      {initialGuests.length > 0 && (
        <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Email', 'Status', 'Expires', 'Last access', 'Created', ''].map((h) => (
                  <th key={h} style={{ fontSize: 11, fontWeight: 550, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, padding: '11px 20px', textAlign: h === '' ? 'right' : 'left', borderBottom: `1px solid ${ui.line}`, background: ui.fill }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {initialGuests.map((g) => <GuestRow key={g.id} guest={g} buyerId={buyerId} />)}
            </tbody>
          </table>
        </div>
      )}
      {initialGuests.length === 0 && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: ui.faint, fontSize: 13 }}>No guests yet. Invite someone above.</div>
      )}
    </div>
  );
}
