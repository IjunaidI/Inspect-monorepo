'use client';

import { useState, useTransition } from 'react';
import { severity, ui } from '@/components/inspect/tokens';
import { reInspection } from '../../actions';

export function ReInspectButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {error && <div style={{ fontSize: 12, color: severity.critical.fg }}>{error}</div>}
      <button
        onClick={() =>
          start(async () => {
            const r = await reInspection(id);
            if (r?.error) setError(r.error);
          })
        }
        style={{
          height: 36,
          background: '#fff',
          border: `1px solid ${ui.line}`,
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 500,
          color: ui.ink,
          cursor: pending ? 'default' : 'pointer',
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? 'Creating…' : 'Start re-inspection'}
      </button>
    </div>
  );
}
