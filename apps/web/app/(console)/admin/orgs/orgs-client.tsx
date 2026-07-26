'use client';

import { useActionState, useState } from 'react';
import { ui } from '@/components/inspect/tokens';
import { Mono } from '@/components/inspect/shell';
import { createOrg, enterOrg, type CreateOrgState } from '../actions';
import type { ApiOrganization } from '@/lib/api';

const INITIAL: CreateOrgState = { ok: false };

export function OrgsClient({ orgs }: { orgs: ApiOrganization[] }) {
  const [state, formAction, pending] = useActionState(createOrg, INITIAL);
  const [copied, setCopied] = useState(false);

  const inviteUrl = state.created
    ? `${typeof window === 'undefined' ? '' : window.location.origin}/invite?token=${state.created.token}`
    : '';

  return (
    <>
      <form
        action={formAction}
        style={{
          marginTop: 20, padding: 16, background: '#fff',
          border: `1px solid ${ui.line}`, borderRadius: 10,
          display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
        }}
      >
        <label style={{ flex: '1 1 220px', fontSize: 11.5, color: ui.sub }}>
          Organization name
          <input name="name" required style={inputStyle} />
        </label>
        <label style={{ flex: '1 1 180px', fontSize: 11.5, color: ui.sub }}>
          Type
          <select name="type" defaultValue="INSPECTION_COMPANY" style={inputStyle}>
            <option value="INSPECTION_COMPANY">Inspection company</option>
            <option value="MANUFACTURER">Manufacturer</option>
          </select>
        </label>
        <label style={{ flex: '1 1 240px', fontSize: 11.5, color: ui.sub }}>
          First Org Owner email
          <input name="ownerEmail" type="email" required style={inputStyle} />
        </label>
        <button type="submit" disabled={pending} style={buttonStyle}>
          {pending ? 'Creating…' : 'Create organization'}
        </button>
      </form>

      {state.error && (
        <p style={{ marginTop: 10, fontSize: 12, color: ui.danger }}>{state.error}</p>
      )}

      {state.created && (
        <div style={{ marginTop: 12, padding: 14, background: '#F0F7FF', border: `1px solid ${ui.line}`, borderRadius: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
            {state.created.orgName} created.{' '}
            {state.created.emailSent
              ? `Invitation emailed to ${state.created.email}.`
              : `Email could not be sent — share this link with ${state.created.email} manually.`}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <Mono style={{ fontSize: 11, wordBreak: 'break-all', flex: 1 }}>{inviteUrl}</Mono>
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(inviteUrl); setCopied(true); }}
              style={buttonStyle}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10 }}>
        {orgs.length === 0 && (
          <div style={{ padding: 20, fontSize: 12.5, color: ui.sub }}>
            No organizations yet — create the first one above.
          </div>
        )}
        {orgs.map((o, i) => (
          <div
            key={o.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
              borderTop: i === 0 ? 'none' : `1px solid ${ui.line}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 550 }}>{o.name}</div>
              <div style={{ fontSize: 11, color: ui.faint }}>
                {o.type === 'INSPECTION_COMPANY' ? 'Inspection company' : 'Manufacturer'}
              </div>
            </div>
            <form action={enterOrg.bind(null, o.id)}>
              <button type="submit" style={buttonStyle}>Enter workspace</button>
            </form>
          </div>
        ))}
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 4, padding: '7px 9px',
  border: `1px solid ${ui.line}`, borderRadius: 7, fontSize: 13, fontFamily: 'inherit',
};

const buttonStyle: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 7, border: `1px solid ${ui.line}`,
  background: '#fff', fontSize: 12.5, fontWeight: 550, cursor: 'pointer',
};
