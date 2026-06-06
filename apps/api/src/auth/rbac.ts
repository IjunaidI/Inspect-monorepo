/**
 * Additive role hierarchy (spec §4): each higher role inherits everything below.
 *
 * INSPECTOR < QA_MANAGER < ORG_OWNER < PLATFORM_ADMIN.
 *
 * Pure logic — used by RolesGuard. `Role` is defined locally for now; it aligns
 * with the Prisma `UserRole` enum and `@inspect/shared-types` (link in Task 5).
 */
export type Role = 'INSPECTOR' | 'QA_MANAGER' | 'ORG_OWNER' | 'PLATFORM_ADMIN';

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
