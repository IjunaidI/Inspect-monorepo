/**
 * Small env-backed config helpers (INS-053) so token lifetimes stop being
 * duplicated magic numbers spread across services.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function positiveIntEnv(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Invitation lifetime (users + org-owner invites). Env: INVITE_TTL_DAYS, default 14. */
export function inviteTtlMs(): number {
  return positiveIntEnv('INVITE_TTL_DAYS', 14) * DAY_MS;
}

/**
 * Buyer-guest magic-link lifetime in days: caller-supplied value clamped to
 * 1..365; when absent, the GUEST_TTL_DAYS env default (30) applies.
 */
export function clampGuestTtlDays(requested?: number): number {
  const fallback = positiveIntEnv('GUEST_TTL_DAYS', 30);
  const value = Number.isFinite(requested as number) ? (requested as number) : fallback;
  return Math.min(Math.max(Math.trunc(value), 1), 365);
}
