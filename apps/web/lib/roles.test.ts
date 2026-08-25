import { describe, expect, test } from 'vitest';
import { apiRoleAtLeast, apiRoleToRoleKey, initialsFrom } from './roles';

/**
 * Characterization tests for the console's role helpers (INS-082).
 *
 * `apiRoleAtLeast` mirrors the API's additive hierarchy
 * (`apps/api/src/auth/rbac.ts`). It is a convenience gate for hiding UI, never
 * an authorization decision — the API is the authority — but a wrong answer
 * here still shows an operator controls that will 403, so the fail-closed
 * behaviour matters. This helper is bound for `@inspect/domain`.
 */
describe('apiRoleAtLeast', () => {
  test('a role meets its own floor', () => {
    expect(apiRoleAtLeast('INSPECTOR', 'INSPECTOR')).toBe(true);
    expect(apiRoleAtLeast('QA_MANAGER', 'QA_MANAGER')).toBe(true);
    expect(apiRoleAtLeast('ORG_OWNER', 'ORG_OWNER')).toBe(true);
  });

  test('a higher role clears a lower floor', () => {
    expect(apiRoleAtLeast('QA_MANAGER', 'INSPECTOR')).toBe(true);
    expect(apiRoleAtLeast('ORG_OWNER', 'QA_MANAGER')).toBe(true);
    expect(apiRoleAtLeast('PLATFORM_ADMIN', 'INSPECTOR')).toBe(true);
  });

  test('a lower role does not clear a higher floor', () => {
    expect(apiRoleAtLeast('INSPECTOR', 'QA_MANAGER')).toBe(false);
    expect(apiRoleAtLeast('QA_MANAGER', 'ORG_OWNER')).toBe(false);
  });

  test('an unrecognized role fails closed', () => {
    expect(apiRoleAtLeast('SUPERUSER', 'INSPECTOR')).toBe(false);
    expect(apiRoleAtLeast('', 'INSPECTOR')).toBe(false);
  });

  test('a missing role fails closed', () => {
    expect(apiRoleAtLeast(undefined, 'INSPECTOR')).toBe(false);
  });
});

describe('apiRoleToRoleKey', () => {
  test('maps each API role to its display key', () => {
    expect(apiRoleToRoleKey('PLATFORM_ADMIN')).toBe('platform');
    expect(apiRoleToRoleKey('ORG_OWNER')).toBe('owner');
    expect(apiRoleToRoleKey('QA_MANAGER')).toBe('qa');
    expect(apiRoleToRoleKey('INSPECTOR')).toBe('inspector');
  });

  test('falls back to the least-privileged display key for unknown or missing roles', () => {
    expect(apiRoleToRoleKey('SUPERUSER')).toBe('inspector');
    expect(apiRoleToRoleKey(undefined)).toBe('inspector');
  });
});

describe('initialsFrom', () => {
  test('takes the first letter of the first two words', () => {
    expect(initialsFrom('Jane Doe')).toBe('JD');
  });

  test('ignores the domain of an email address', () => {
    expect(initialsFrom('jane.doe@example.com')).toBe('JD');
  });

  test('treats dots, underscores, hyphens and spaces as separators', () => {
    expect(initialsFrom('jane_doe')).toBe('JD');
    expect(initialsFrom('jane-doe')).toBe('JD');
    expect(initialsFrom('jane.doe')).toBe('JD');
  });

  test('returns a single initial when there is only one word', () => {
    expect(initialsFrom('Jane')).toBe('J');
  });

  test('never returns an empty string', () => {
    expect(initialsFrom('')).toBe('?');
  });
});
