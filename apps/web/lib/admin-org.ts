import { cookies } from 'next/headers';

/** Cookie holding the org a Platform Admin is currently operating inside (INS-079). */
export const ADMIN_ORG_COOKIE = 'inspect_admin_org';

type AssumedOrg = { id: string; name: string };

/**
 * Parse the cookie's encoded-JSON payload. Never throws — a malformed value (or a
 * legacy plain-id cookie from before this shape existed) must not break console
 * rendering, so any parse failure is treated the same as "no cookie". If the id
 * survives but the name doesn't (partial corruption), fall back to the id as the
 * display name rather than losing the assumption state entirely — the banner
 * must never be silently suppressed just because the name is unrecoverable.
 */
function decodeAssumedOrg(raw: string | undefined): AssumedOrg | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    if (parsed && typeof parsed.id === 'string' && parsed.id) {
      const name = typeof parsed.name === 'string' && parsed.name ? parsed.name : parsed.id;
      return { id: parsed.id, name };
    }
    return null;
  } catch {
    return null;
  }
}

/** Server-only: the assumed org id, or null when the admin is un-assumed. */
export async function getAssumedOrgId(): Promise<string | null> {
  const store = await cookies();
  return decodeAssumedOrg(store.get(ADMIN_ORG_COOKIE)?.value)?.id ?? null;
}

/** Server-only: the assumed org's id + display name, or null when the admin is un-assumed. */
export async function getAssumedOrg(): Promise<AssumedOrg | null> {
  const store = await cookies();
  return decodeAssumedOrg(store.get(ADMIN_ORG_COOKIE)?.value);
}

/**
 * httpOnly so the browser can never read or forge it; the API is the real
 * authority regardless (it ignores the header for any non-PLATFORM_ADMIN token).
 * The name is captured once at enter time so the console layout never needs to
 * re-fetch the org list just to render the assumption banner.
 */
export async function setAssumedOrg(orgId: string, name: string): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_ORG_COOKIE, encodeURIComponent(JSON.stringify({ id: orgId, name })), {
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
