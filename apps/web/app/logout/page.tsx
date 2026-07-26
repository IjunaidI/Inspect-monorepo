'use client';

import { useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { ui } from '@/components/inspect/tokens';
import { clearAssumedOrgOnLogout } from './actions';

export default function LogoutPage() {
  useEffect(() => {
    // Clear the assumed-org cookie (server-only) before handing off to
    // NextAuth's client-side signOut, which only clears its own session
    // cookies (INS-079 final review, finding 2).
    void clearAssumedOrgOnLogout().finally(() => {
      void signOut({ callbackUrl: '/login?expired=1' });
    });
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: ui.bg, fontFamily: ui.font, color: ui.sub, fontSize: 14 }}>
      Session expired — signing out…
    </div>
  );
}
