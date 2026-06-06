import { hasAtLeast, isPlatformAdmin, ROLE_RANK } from './rbac';

describe('additive role hierarchy (spec §4)', () => {
  it('ranks roles INSPECTOR < QA_MANAGER < ORG_OWNER < PLATFORM_ADMIN', () => {
    expect(ROLE_RANK.INSPECTOR).toBeLessThan(ROLE_RANK.QA_MANAGER);
    expect(ROLE_RANK.QA_MANAGER).toBeLessThan(ROLE_RANK.ORG_OWNER);
    expect(ROLE_RANK.ORG_OWNER).toBeLessThan(ROLE_RANK.PLATFORM_ADMIN);
  });

  it('a higher role satisfies a lower requirement', () => {
    expect(hasAtLeast('QA_MANAGER', 'INSPECTOR')).toBe(true);
    expect(hasAtLeast('PLATFORM_ADMIN', 'ORG_OWNER')).toBe(true);
  });

  it('a lower role does NOT satisfy a higher requirement', () => {
    expect(hasAtLeast('INSPECTOR', 'QA_MANAGER')).toBe(false);
    expect(hasAtLeast('ORG_OWNER', 'PLATFORM_ADMIN')).toBe(false);
  });

  it('an equal role satisfies the requirement', () => {
    expect(hasAtLeast('QA_MANAGER', 'QA_MANAGER')).toBe(true);
  });

  it('identifies the platform admin', () => {
    expect(isPlatformAdmin('PLATFORM_ADMIN')).toBe(true);
    expect(isPlatformAdmin('ORG_OWNER')).toBe(false);
  });
});
