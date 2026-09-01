import { describe, expect, it } from 'vitest';
import { INSPECTION_STATUSES } from '@inspect/shared-types';
import {
  DECIDABLE_STATUSES,
  LOCKED_STATUSES,
  REINSPECTABLE_STATUSES,
  REPORTABLE_STATUSES,
  STATUS_BUCKETS,
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

  it('reportable and re-inspectable statuses are locked, post-decision states', () => {
    for (const s of [...REPORTABLE_STATUSES, ...REINSPECTABLE_STATUSES]) {
      expect(LOCKED_STATUSES).toContain(s);
      // Neither overlaps SUBMITTABLE — a report or correction never exists
      // while the loop can still be populated.
      expect(SUBMITTABLE_STATUSES).not.toContain(s);
    }
    // A reportable inspection is decided; it is never simultaneously the
    // correction path (REJECTED/HOLD).
    for (const s of REPORTABLE_STATUSES) {
      expect(REINSPECTABLE_STATUSES).not.toContain(s);
    }
  });

  it('isLockedStatus is false exactly for the submittable statuses', () => {
    for (const s of SUBMITTABLE_STATUSES) expect(isLockedStatus(s)).toBe(false);
    for (const s of LOCKED_STATUSES) expect(isLockedStatus(s)).toBe(true);
  });

  it('STATUS_BUCKETS partition the full status enum exactly once each', () => {
    // The dashboard's four tiles must always sum to the org's total
    // inspections — a status in zero buckets undercounts, in two overcounts.
    const all = STATUS_BUCKETS.flatMap((b) => [...b.statuses]);
    expect(all.length).toBe(INSPECTION_STATUSES.length);
    expect(new Set(all).size).toBe(INSPECTION_STATUSES.length);
    for (const s of INSPECTION_STATUSES) expect(all).toContain(s);
  });

  it('fails closed on unknown, empty and missing status', () => {
    expect(isLockedStatus('SOME_FUTURE_STATUS')).toBe(true);
    expect(isLockedStatus('')).toBe(true);
    expect(isLockedStatus(undefined)).toBe(true);
    expect(isLockedStatus(null)).toBe(true);
  });
});
