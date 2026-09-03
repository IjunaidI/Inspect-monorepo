'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Modal } from './modal';
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
  // Focus lands on the confirm action (Modal focuses the FIRST focusable,
  // which here is Cancel) so the dialog keeps its keyboard-first behaviour.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <Modal title={title} onClose={onCancel} width={420}>
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
    </Modal>
  );
}
