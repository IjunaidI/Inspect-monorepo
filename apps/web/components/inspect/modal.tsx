'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ui } from './tokens';

/**
 * The design system's modal shell (INS-091). Generalised from ConfirmDialog so
 * a FORM can live in it: portal to <body> (a form inside a form is invalid
 * HTML, and quick-create dialogs open from inside forms), focus trap, body
 * scroll lock, and a stack so Escape / backdrop close only the topmost layer
 * when a quick-create opens a nested quick-create.
 */
const stack: symbol[] = [];
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const subscribeNoop = () => () => {};

export function Modal({
  title,
  onClose,
  width = 480,
  children,
}: {
  title: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [me] = useState(() => Symbol('modal'));
  const [depth, setDepth] = useState(0);

  // Register on the stack; lock scroll while any modal is open.
  useEffect(() => {
    stack.push(me);
    setDepth(stack.length - 1);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) document.body.style.overflow = prevOverflow;
    };
  }, [me]);

  // Initial focus + Escape (topmost only) + Tab trap.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel).focus();

    function onKey(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (nodes.length === 0) return;
        const firstEl = nodes[0];
        const lastEl = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [me, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      data-testid="modal-backdrop"
      onClick={() => {
        if (stack[stack.length - 1] === me) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(11,18,32,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100 + depth,
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          width,
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          border: `1px solid ${ui.line}`,
          fontFamily: ui.font,
          outline: 'none',
        }}
      >
        <div id={titleId} style={{ fontSize: 15, fontWeight: 600, color: ui.ink }}>
          {title}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
