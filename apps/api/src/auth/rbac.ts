import type { UserRole } from '@inspect/shared-types';

/**
 * Additive role hierarchy (spec §4): each higher role inherits everything below.
 *
 * INSPECTOR < QA_MANAGER < ORG_OWNER < PLATFORM_ADMIN.
 *
 * Pure logic — used by RolesGuard. `Role` is an alias of `UserRole` from
 * `@inspect/shared-types` (INS-008), which is the single source of truth for the
 * union and mirrors the Prisma `UserRole` enum. The local name is kept because
 * ~40 call sites across the API read `Role`, and renaming them would be churn
 * without benefit — what matters is that the members are declared exactly once.
 */
export type Role = UserRole;

export const ROLE_RANK: Readonly<Record<Role, number>> = {
  INSPECTOR: 1,
  QA_MANAGER: 2,
  ORG_OWNER: 3,
  PLATFORM_ADMIN: 4,
};

/** True if `userRole` meets or exceeds `requiredRole` in the additive hierarchy. */
export function hasAtLeast(userRole: Role, requiredRole: Role): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

/** The only cross-tenant principal (spec §2/§4). */
export function isPlatformAdmin(role: Role): boolean {
  return role === 'PLATFORM_ADMIN';
}
