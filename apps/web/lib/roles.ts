import type { RoleKey } from '@/components/inspect/tokens';

/**
 * The console's role helpers (INS-086 Phase 1).
 *
 * The hierarchy check and the initials helper are platform-free and now live in
 * `@inspect/domain`; they are re-exported here so the ~8 call sites that import
 * from this module are untouched. `apiRoleAtLeast` keeps its name for the same
 * reason.
 *
 * `apiRoleToRoleKey` stays: it maps an API role onto a BADGE key from the design
 * tokens, which is presentation, not domain. Putting it in `@inspect/domain`
 * would make the domain layer depend on the design layer.
 */
export { initialsFrom, roleAtLeast as apiRoleAtLeast } from '@inspect/domain';

export function apiRoleToRoleKey(role?: string): RoleKey {
  switch (role) {
    case 'PLATFORM_ADMIN':
      return 'platform';
    case 'ORG_OWNER':
      return 'owner';
    case 'QA_MANAGER':
      return 'qa';
    default:
      return 'inspector';
  }
}
