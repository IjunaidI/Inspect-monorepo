'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ui } from './tokens';

/** The design system's modal confirm (first consumer: archive + start-inspection). */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // First modal in the design system: Escape cancels, and focus lands on the
  // confirm action so the dialog is operable without a mouse.
  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,18,32,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw', border: `1px solid ${ui.line}`, fontFamily: ui.font }}
      >
        <div id="confirm-dialog-title" style={{ fontSize: 15, fontWeight: 600, color: ui.ink }}>{title}</div>
        <div style={{ fontSize: 13, color: ui.sub, marginTop: 8, lineHeight: 1.5 }}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            onClick={onCancel}
            style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: ui.ink, border: `1px solid ${ui.line}`, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 550, fontFamily: 'inherit', background: danger ? ui.danger : ui.accent, color: '#fff', border: '1px solid transparent', cursor: 'pointer' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
