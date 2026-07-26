'use client';

import Link from 'next/link';
import { ui } from '@/components/inspect/tokens';

/**
 * Console-wide safety net (INS-079). Org-scoped API reads throw on 401/403 by
 * design (lib/api.ts loadOrFallback); before this existed a no-org Platform
 * Admin hitting an org screen produced an unhandled render error.
 */
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const noOrgContext = /organization context/i.test(error.message);

  return (
    <div style={{ padding: '48px 32px', maxWidth: 560 }}>
      <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
        {noOrgContext ? 'No organization context' : 'Something went wrong'}
      </h2>
      <p style={{ fontSize: 13, color: ui.sub, lineHeight: 1.5 }}>
        {noOrgContext
          ? 'This screen belongs to an organization workspace, and your account is not currently operating inside one. Choose an organization to enter.'
          : 'This screen could not be loaded.'}
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        {noOrgContext && (
          <Link
            href="/admin/orgs"
            style={{
              padding: '7px 12px', borderRadius: 7, border: `1px solid ${ui.line}`,
              background: ui.panel, fontSize: 12.5, fontWeight: 550, textDecoration: 'none', color: ui.ink,
            }}
          >
            Go to Organizations
          </Link>
        )}
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
