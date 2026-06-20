'use client';

import { useActionState, useState, useTransition } from 'react';
import { Lock } from 'lucide-react';
import { severity, ui } from '@/components/inspect/tokens';
import { decideInspection, submitInspection } from '../../actions';

const options = [
  { k: 'PASS', label: 'Pass', desc: 'Release the lot. Overrides the system flag.', color: '#1F8A4C', bg: '#EAF6F0', bd: '#BEE3CD' },
  { k: 'FAIL', label: 'Fail', desc: 'Reject the lot. Matches a system FAIL.', color: severity.critical.fg, bg: severity.critical.bg, bd: '#F1C9C5' },
  { k: 'HOLD', label: 'Hold', desc: 'Pause for clarification or re-inspection.', color: severity.major.fg, bg: severity.major.bg, bd: '#EBD9B4' },
] as const;

export function SubmitForReview({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, color: ui.sub }}>
        This inspection has not been submitted. Submitting locks the audit block and computes the AQL result.
      </div>
      {error && <div style={{ fontSize: 12.5, color: severity.critical.fg }}>{error}</div>}
      <button
        disabled={pending}
        onClick={() => start(async () => { const r = await submitInspection(id); if (r.error) setError(r.error); })}
        style={{ height: 44, background: ui.accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.7 : 1 }}
      >
        {pending ? 'Submitting…' : 'Submit for review'}
      </button>
    </div>
  );
}

export function DecisionForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(decideInspection, {} as { error?: string });
  const [decision, setDecision] = useState<string>('');
  return (
    <form action={action} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" value={decision} />
      {options.map((o) => {
        const sel = o.k === decision;
        return (
          <label key={o.k} onClick={() => setDecision(o.k)} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 10, cursor: 'pointer', background: sel ? o.bg : '#fff', border: `1px solid ${sel ? o.bd : ui.line}` }}>
            <span style={{ width: 18, height: 18, borderRadius: 999, marginTop: 1, border: `1.5px solid ${sel ? o.color : '#C8D0DA'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {sel && <span style={{ width: 8, height: 8, borderRadius: 999, background: o.color }} />}
            </span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: sel ? o.color : ui.ink }}>{o.label}</div>
              <div style={{ fontSize: 12, color: ui.sub, marginTop: 2, lineHeight: 1.45 }}>{o.desc}</div>
            </div>
          </label>
        );
      })}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 550, marginBottom: 6 }}>Decision note <span style={{ color: severity.critical.fg }}>*</span></div>
        <textarea name="remarks" required style={{ width: '100%', height: 76, padding: 12, fontSize: 13, lineHeight: 1.5, resize: 'none', boxSizing: 'border-box', background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 8, fontFamily: 'inherit', color: ui.ink, outline: 'none' }} />
      </div>
      {state?.error && <div style={{ fontSize: 12.5, color: severity.critical.fg }}>{state.error}</div>}
      <button type="submit" disabled={pending} style={{ height: 44, background: ui.accent, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, marginTop: 4, cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.7 : 1 }}>
        {pending ? 'Submitting…' : 'Submit decision'}
      </button>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11.5, color: ui.faint, lineHeight: 1.45 }}>
        <Lock size={13} color={ui.faint} style={{ marginTop: 1, flexShrink: 0 }} />
        Submitting locks the report. Corrections require a new linked re-inspection.
      </div>
    </form>
  );
}
