import { describe, expect, it } from 'vitest';
import { INSPECTION_STATUSES } from '@inspect/shared-types';
import {
  DECIDABLE_STATUSES,
  LOCKED_STATUSES,
  SUBMITTABLE_STATUSES,
  isLockedStatus,
} from './inspection-status';

describe('inspection status rules', () => {
  it('LOCKED and SUBMITTABLE partition the full status enum exactly', () => {
    const union = new Set([...LOCKED_STATUSES, ...SUBMITTABLE_STATUSES]);
    expect(union.size).toBe(INSPECTION_STATUSES.length);
    for (const s of INSPECTION_STATUSES) expect(union.has(s)).toBe(true);
    for (const s of LOCKED_STATUSES) {
      expect(SUBMITTABLE_STATUSES).not.toContain(s);
    }
  });

  it('every decidable status is a locked one (decision happens after submit)', () => {
    for (const s of DECIDABLE_STATUSES) expect(LOCKED_STATUSES).toContain(s);
  });

  it('isLockedStatus is false exactly for the submittable statuses', () => {
    for (const s of SUBMITTABLE_STATUSES) expect(isLockedStatus(s)).toBe(false);
    for (const s of LOCKED_STATUSES) expect(isLockedStatus(s)).toBe(true);
  });

  it('fails closed on unknown, empty and missing status', () => {
    expect(isLockedStatus('SOME_FUTURE_STATUS')).toBe(true);
    expect(isLockedStatus('')).toBe(true);
    expect(isLockedStatus(undefined)).toBe(true);
    expect(isLockedStatus(null)).toBe(true);
  });
});
