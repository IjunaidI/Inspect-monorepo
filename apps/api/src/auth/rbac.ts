import { ROLE_RANK } from '@inspect/domain';
import type { UserRole } from '@inspect/shared-types';

/**
 * Additive role hierarchy (spec §4): each higher role inherits everything below.
 *
 * INSPECTOR < QA_MANAGER < ORG_OWNER < PLATFORM_ADMIN.
 *
 * INS-086 Phase 1: the rank table itself now lives in `@inspect/domain`, shared
 * with the console and the mobile app, so the hierarchy is declared exactly once
 * (spec §4.4 — every migration must reduce total logic). This module stays the
 * API's authority: it is what `RolesGuard` calls, and it keeps the strict
 * `Role`-typed signature that ~40 call sites depend on, where the shared helper
 * deliberately takes a loose `string | undefined` for client-side session data.
 *
 * Pure logic — used by RolesGuard. `Role` is an alias of `UserRole` from
 * `@inspect/shared-types` (INS-008), which is the single source of truth for the
 * union and mirrors the Prisma `UserRole` enum. The local name is kept because
 * ~40 call sites across the API read `Role`, and renaming them would be churn
 * without benefit — what matters is that the members are declared exactly once.
 */
export type Role = UserRole;

export { ROLE_RANK };

/** True if `userRole` meets or exceeds `requiredRole` in the additive hierarchy. */
export function hasAtLeast(userRole: Role, requiredRole: Role): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

/** The only cross-tenant principal (spec §2/§4). */
export function isPlatformAdmin(role: Role): boolean {
  return role === 'PLATFORM_ADMIN';
}
