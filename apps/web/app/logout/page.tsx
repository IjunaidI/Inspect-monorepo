'use client';

import { useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { ui } from '@/components/inspect/tokens';

export default function LogoutPage() {
  useEffect(() => {
    void signOut({ callbackUrl: '/login?expired=1' });
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: ui.bg, fontFamily: ui.font, color: ui.sub, fontSize: 14 }}>
      Session expired — signing out…
    </div>
  );
}
