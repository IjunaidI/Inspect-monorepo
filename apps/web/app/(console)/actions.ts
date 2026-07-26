'use server';

import { signOut } from '@/lib/auth';
import { clearAssumedOrgId } from '@/lib/admin-org';

/**
 * Sign-out must also drop any assumed-org state (INS-079 final review, finding
 * 2): NextAuth's signOut() only clears its own session cookies, never
 * `inspect_admin_org`. Left uncleared, the cookie survives into the next
 * session on a shared browser and authHeaders() would carry it forward.
 */
export async function signOutAction() {
  await clearAssumedOrgId();
  await signOut({ redirectTo: '/login' });
}
