'use client';

import { ui } from '@/components/inspect/tokens';

/**
 * Console-wide safety net (INS-079). Org-scoped API reads throw on 401/403 by
 * design (lib/api.ts loadOrFallback); before this existed a no-org Platform
 * Admin hitting an org screen produced an unhandled render error.
 *
 * This stays a plain generic screen and does not attempt to identify the
 * error from `error.message`: Next.js strips Server Component error messages
 * in production builds (only `digest` survives), so message-based
 * discrimination here would work in dev and silently fail in prod. The one
 * error this boundary used to special-case — the no-org-context 403 — is now
 * handled deterministically before it ever reaches a client boundary: it is
 * redirected server-side in `loadOrFallback` (lib/api.ts), which still has
 * the real message intact.
 */
export default function ConsoleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ padding: '48px 32px', maxWidth: 560 }}>
      <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Something went wrong</h2>
      <p style={{ fontSize: 13, color: ui.sub, lineHeight: 1.5 }}>This screen could not be loaded.</p>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: '7px 12px', borderRadius: 7, border: `1px solid ${ui.line}`,
            background: ui.panel, fontSize: 12.5, fontWeight: 550, cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
