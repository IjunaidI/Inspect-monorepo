import type { InvitableRole, UserRole } from '@inspect/shared-types';

/**
 * The additive role hierarchy (spec §4), shared by every consumer.
 *
 * INSPECTOR < QA_MANAGER < ORG_OWNER < PLATFORM_ADMIN, each inheriting
 * everything below. This is the SINGLE declaration of the table: the API's
 * `RolesGuard` reads it through `apps/api/src/auth/rbac.ts`, and the console
 * reads it through `apps/web/lib/roles.ts`. Neither keeps a copy (spec §4.4 —
 * every migration must reduce total logic).
 *
 * The API is still the authority on every request; what the clients do with
 * this table is decide whether to render a control at all.
 */
export const ROLE_RANK: Readonly<Record<UserRole, number>> = {
  INSPECTOR: 1,
  QA_MANAGER: 2,
  ORG_OWNER: 3,
  PLATFORM_ADMIN: 4,
};

/**
 * True when `role` meets or exceeds `min`.
 *
 * Takes a loose `string | undefined` on purpose: the value comes off a session
 * object and may be absent or unrecognized. Anything not in the table ranks 0
 * and therefore clears no floor — fail closed, never fail open. The API's
 * `hasAtLeast` keeps a strict `UserRole`-typed signature instead, because there
 * the role has already been verified out of a signed token.
 */
export function roleAtLeast(role: string | undefined, min: InvitableRole): boolean {
  return ((ROLE_RANK as Record<string, number>)[role ?? ''] ?? 0) >= ROLE_RANK[min];
}
