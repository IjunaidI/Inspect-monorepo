import { cookies } from 'next/headers';

/** Cookie holding the org a Platform Admin is currently operating inside (INS-079). */
export const ADMIN_ORG_COOKIE = 'inspect_admin_org';

/** Server-only: the assumed org id, or null when the admin is un-assumed. */
export async function getAssumedOrgId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(ADMIN_ORG_COOKIE)?.value?.trim();
  return value ? value : null;
}

/**
 * httpOnly so the browser can never read or forge it; the API is the real
 * authority regardless (it ignores the header for any non-PLATFORM_ADMIN token).
 */
export async function setAssumedOrgId(orgId: string): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

export async function clearAssumedOrgId(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_ORG_COOKIE);
}
