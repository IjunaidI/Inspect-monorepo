'use server';

import { clearAssumedOrgId } from '@/lib/admin-org';

/**
 * `/logout` is a separate sign-out path from the topbar's `signOutAction`
 * (`app/(console)/actions.ts`): it's reached when the console layout detects a
 * dead refresh token and redirects here for a Client Component to call
 * next-auth/react's `signOut()`. That client call clears only NextAuth's own
 * cookies, so this route needs its own server action to drop the assumed-org
 * cookie (INS-079 final review, finding 2) — otherwise it survives into
 * whatever session logs in next on this browser.
 */
export async function clearAssumedOrgOnLogout(): Promise<void> {
  await clearAssumedOrgId();
}
