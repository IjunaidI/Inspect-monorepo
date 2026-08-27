import { describe, expect, test } from 'vitest';
import { ROLE_RANK, roleAtLeast } from './roles';

/**
 * The additive role hierarchy (spec §4): INSPECTOR < QA_MANAGER < ORG_OWNER <
 * PLATFORM_ADMIN, each inheriting everything below.
 *
 * This is a convenience gate for hiding UI, never an authorization decision —
 * the API is the authority. But a wrong answer still renders operator controls
 * that will 403, so the fail-closed branch is the one that matters most: an
 * unknown role must be treated as no role, never as a match.
 */
describe('roleAtLeast', () => {
  test('a role meets its own floor', () => {
    expect(roleAtLeast('INSPECTOR', 'INSPECTOR')).toBe(true);
    expect(roleAtLeast('QA_MANAGER', 'QA_MANAGER')).toBe(true);
    expect(roleAtLeast('ORG_OWNER', 'ORG_OWNER')).toBe(true);
  });

  test('a higher role clears a lower floor', () => {
    expect(roleAtLeast('QA_MANAGER', 'INSPECTOR')).toBe(true);
    expect(roleAtLeast('ORG_OWNER', 'QA_MANAGER')).toBe(true);
    expect(roleAtLeast('PLATFORM_ADMIN', 'INSPECTOR')).toBe(true);
  });

  test('a lower role does not clear a higher floor', () => {
    expect(roleAtLeast('INSPECTOR', 'QA_MANAGER')).toBe(false);
    expect(roleAtLeast('QA_MANAGER', 'ORG_OWNER')).toBe(false);
  });

  test('an unrecognized role fails closed', () => {
    expect(roleAtLeast('SUPERUSER', 'INSPECTOR')).toBe(false);
    expect(roleAtLeast('', 'INSPECTOR')).toBe(false);
  });

  test('a missing role fails closed', () => {
    expect(roleAtLeast(undefined, 'INSPECTOR')).toBe(false);
  });

  test('the rank table is the one the API authority also reads', () => {
    // apps/api/src/auth/rbac.ts imports ROLE_RANK from here (INS-086 Phase 1),
    // so this asserts the shape of the single shared table. If the console and
    // the API ever disagree on it, the console hides controls the API allows —
    // or renders controls it refuses.
    expect(ROLE_RANK).toEqual({
      INSPECTOR: 1,
      QA_MANAGER: 2,
      ORG_OWNER: 3,
      PLATFORM_ADMIN: 4,
    });
  });
});
