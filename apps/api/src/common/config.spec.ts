import { clampGuestTtlDays, inviteTtlMs } from './config';

describe('config helpers (INS-053)', () => {
  const OLD_ENV = process.env;
  afterEach(() => {
    process.env = OLD_ENV;
  });

  describe('inviteTtlMs', () => {
    it('defaults to 14 days', () => {
      process.env = { ...OLD_ENV };
      delete process.env.INVITE_TTL_DAYS;
      expect(inviteTtlMs()).toBe(14 * 24 * 60 * 60 * 1000);
    });

    it('reads INVITE_TTL_DAYS', () => {
      process.env = { ...OLD_ENV, INVITE_TTL_DAYS: '3' };
      expect(inviteTtlMs()).toBe(3 * 24 * 60 * 60 * 1000);
    });

    it('falls back on garbage or non-positive values', () => {
      process.env = { ...OLD_ENV, INVITE_TTL_DAYS: 'soon' };
      expect(inviteTtlMs()).toBe(14 * 24 * 60 * 60 * 1000);
      process.env = { ...OLD_ENV, INVITE_TTL_DAYS: '-2' };
      expect(inviteTtlMs()).toBe(14 * 24 * 60 * 60 * 1000);
    });
  });

  describe('clampGuestTtlDays', () => {
    it('clamps to 1..365', () => {
      expect(clampGuestTtlDays(0)).toBe(1);
      expect(clampGuestTtlDays(-10)).toBe(1);
      expect(clampGuestTtlDays(9999)).toBe(365);
      expect(clampGuestTtlDays(45)).toBe(45);
    });

    it('uses the GUEST_TTL_DAYS default when unset/garbage', () => {
      process.env = { ...OLD_ENV };
      delete process.env.GUEST_TTL_DAYS;
      expect(clampGuestTtlDays(undefined)).toBe(30);
      process.env = { ...OLD_ENV, GUEST_TTL_DAYS: '60' };
      expect(clampGuestTtlDays(undefined)).toBe(60);
      expect(clampGuestTtlDays(Number.NaN)).toBe(60);
    });
  });
});
