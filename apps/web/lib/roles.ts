import type { RoleKey } from '@/components/inspect/tokens';

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
