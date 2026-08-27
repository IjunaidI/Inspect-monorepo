/**
 * The credential exchange (INS-088).
 *
 * These three calls sit outside the injected auth provider by nature: `login`
 * and `refresh` are what PRODUCE credentials, and `me` is handed a token
 * explicitly because at that moment no session exists to read one from.
 *
 * They live in the shared package because they are the first endpoints any
 * client needs, so leaving them in `apps/web` guaranteed the mobile app would
 * implement the same exchange a second time — the drift the two-platform
 * decision cannot survive.
 */

/** `POST /auth/login` — the issued token pair. */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

/** `GET /auth/me` — identity for the caller of the supplied token. */
export interface MeResult {
  userId?: string;
  email?: string;
  role?: string;
  orgId?: string | null;
  /** INS-080: the real workspace name; null for the cross-tenant Platform Admin. */
  orgName?: string | null;
  [key: string]: unknown;
}

/** A refreshed pair plus the absolute expiry (ms) derived from the access token. */
export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpires: number;
}

/** Used when a token carries no readable `exp`, matching the API's access TTL. */
export const DEFAULT_ACCESS_TTL_MS = 15 * 60 * 1000;

/**
 * Decode a base64url segment to a string.
 *
 * Deliberately built on `atob` + `decodeURIComponent` rather than `Buffer`:
 * this module is bundled for React Native, where `Buffer` does not exist
 * without a polyfill, and it is also loaded into Next's edge runtime through
 * `middleware.ts`. `atob` is present in all three.
 *
 * The percent-encoding step is not decoration — `atob` yields a BINARY string,
 * one char per byte, so a multi-byte UTF-8 character (an org name with an
 * accent, say) would be corrupted and can make `JSON.parse` throw. Padding is
 * restored because `atob` is stricter about it than `Buffer.from` was.
 */
function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  let percent = '';
  for (let i = 0; i < binary.length; i += 1) {
    percent += `%${binary.charCodeAt(i).toString(16).padStart(2, '0')}`;
  }
  return decodeURIComponent(percent);
}

/**
 * The absolute expiry (ms since epoch) encoded in a JWT's `exp`, or null when
 * the token is unreadable. Never throws — a malformed token is an expiry we do
 * not know, not an error the caller should handle.
 */
export function decodeJwtExp(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const parsed = JSON.parse(base64UrlDecode(payload)) as { exp?: unknown };
    return typeof parsed.exp === 'number' ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}
