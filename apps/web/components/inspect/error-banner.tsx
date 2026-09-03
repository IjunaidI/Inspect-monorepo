import type { CSSProperties, ReactNode } from 'react';
import { ui } from './tokens';

/**
 * The console's one error banner (INS-091). Replaces the copy-pasted
 * #FEF2F2/#FECACA panel and every `alert()` — errors render next to the
 * control that failed, dismiss with the next attempt, and never block.
 */
export function ErrorBanner({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      role="alert"
      style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12.5, color: ui.danger, lineHeight: 1.45, ...style }}
    >
      {children}
    </div>
  );
}
