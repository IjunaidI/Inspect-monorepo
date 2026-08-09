'use client';

import { Component, type ReactNode } from 'react';
import { ui } from './tokens';

/**
 * Section-scoped client error boundary. The route-level `error.tsx` files
 * replace the ENTIRE screen, so one failing widget blanks everything around it.
 * Wrapping independent sections keeps the rest of the page usable.
 *
 * Only catches client render errors — Server Component failures still surface
 * through the route boundary.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', this.props.label ?? 'section', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        style={{
          background: ui.panel,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: ui.line,
          borderRadius: 10,
          padding: 20,
          fontSize: 13,
          color: ui.sub,
        }}
      >
        {this.props.label ?? 'This section'} could not be displayed. The rest of the page is unaffected.
      </div>
    );
  }
}
