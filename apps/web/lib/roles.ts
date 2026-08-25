import type { RoleKey } from '@/components/inspect/tokens';
import type { InvitableRole } from '@inspect/shared-types';

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

/** Two-letter initials from a name or email local-part. */
export function initialsFrom(label: string): string {
  const base = label.replace(/@.*/, '');
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? base[0] ?? '?';
  const b = parts[1]?.[0] ?? '';
  return (a + b).toUpperCase();
}

const API_ROLE_RANK: Record<string, number> = {
  INSPECTOR: 1,
  QA_MANAGER: 2,
  ORG_OWNER: 3,
  PLATFORM_ADMIN: 4,
};

/** Additive-hierarchy check on API role strings; unknown/missing role fails closed. */
export function apiRoleAtLeast(role: string | undefined, min: InvitableRole): boolean {
  return (API_ROLE_RANK[role ?? ''] ?? 0) >= API_ROLE_RANK[min];
}
