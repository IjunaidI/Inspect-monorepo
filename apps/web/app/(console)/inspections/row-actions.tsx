'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MoreVertical } from 'lucide-react';
import { ConfirmDialog } from '@/components/inspect/confirm-dialog';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { ui } from '@/components/inspect/tokens';
import { reassignInspection, resetInspection, startInspection } from './actions';

const PRE_SUBMISSION = new Set(['DRAFT', 'ASSIGNED', 'IN_PROGRESS']);

export function RowActions({
  id,
  status,
  assignedInspectorId,
  currentUserId,
  canManage,
  inspectors,
}: {
  id: string;
  status: string;
  assignedInspectorId?: string | null;
  currentUserId?: string;
  canManage: boolean;
  inspectors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmingStart, setConfirmingStart] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setReassigning(false); }
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const canAct = canManage || (!!currentUserId && assignedInspectorId === currentUserId);
  const item: React.CSSProperties = {
    display: 'block', width: '100%', padding: '10px 14px', fontSize: 13, color: ui.ink,
    background: 'transparent', borderWidth: '1px 0 0 0', borderStyle: 'solid', borderColor: ui.lineSoft,
    fontFamily: 'inherit', textAlign: 'left', cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1,
  };

  function run(fn: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const r = await fn();
      if (r.error) {
        setError(r.error);
        return;
      }
      router.refresh();
      setOpen(false);
      setReassigning(false);
    });
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => { setOpen(!open); setError(null); }}
        aria-label="Inspection actions"
        style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ui.faint, background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 32, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 50, minWidth: 200, overflow: 'hidden' }}>
          <button onClick={() => { router.push(`/inspections/${id}/review`); setOpen(false); }} style={{ ...item, borderWidth: 0 }}>
            Open
          </button>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${window.location.origin}/inspections/${id}/review`);
                setOpen(false);
              } catch {
                setError('Could not copy the link — copy it from the address bar after opening the inspection.');
              }
            }}
            style={item}
          >
            Copy link
          </button>
          {status === 'ASSIGNED' && canAct && (
            <button disabled={pending} onClick={() => setConfirmingStart(true)} style={item}>Start inspection</button>
          )}
          {status === 'IN_PROGRESS' && canAct && (
            <button disabled={pending} onClick={() => run(() => resetInspection(id))} style={item}>Reset to assigned</button>
          )}
          {canManage && PRE_SUBMISSION.has(status) && inspectors.length > 0 && (
            reassigning ? (
              <div style={{ padding: '10px 14px', borderTop: `1px solid ${ui.lineSoft}` }}>
                <select
                  autoFocus
                  defaultValue=""
                  disabled={pending}
                  onChange={(e) => { if (e.target.value) run(() => reassignInspection(id, e.target.value)); }}
                  style={{ width: '100%', height: 30, fontSize: 12.5, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 6 }}
                >
                  <option value="" disabled>Assign to…</option>
                  {inspectors.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <button disabled={pending} onClick={() => setReassigning(true)} style={item}>Reassign…</button>
            )
          )}
          {error && <ErrorBanner style={{ margin: 8, padding: '8px 10px', fontSize: 12 }}>{error}</ErrorBanner>}
        </div>
      )}
      {confirmingStart && (
        <ConfirmDialog
          title="Start this inspection?"
          body="Starting cannot be stopped — only reset and restarted. Photos and defects recorded while in progress stay attached."
          confirmLabel="Start"
          onConfirm={() => { setConfirmingStart(false); run(() => startInspection(id)); }}
          onCancel={() => setConfirmingStart(false)}
        />
      )}
    </div>
  );
}
