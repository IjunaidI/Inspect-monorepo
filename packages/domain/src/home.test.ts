import { describe, expect, it } from 'vitest';
import { INSPECTION_STATUSES } from '@inspect/shared-types';
import { STATUS_BUCKETS } from './inspection-status';
import { bucketCounts, nextForInspector, statusCounts } from './home';

describe('statusCounts', () => {
  it('counts rows per status and keeps unknown statuses', () => {
    expect(
      statusCounts([
        { status: 'DRAFT' },
        { status: 'DRAFT' },
        { status: 'WEIRD' },
      ]),
    ).toEqual({
      DRAFT: 2,
      WEIRD: 1,
    });
    expect(statusCounts([])).toEqual({});
  });
});

describe('bucketCounts', () => {
  it('sums each bucket from the status map and always returns every bucket key', () => {
    const out = bucketCounts({
      DRAFT: 1,
      ASSIGNED: 2,
      IN_PROGRESS: 3,
      SUBMITTED: 1,
      HOLD: 1,
      APPROVED: 4,
      REJECTED: 2,
    });
    expect(out).toEqual({
      inProgress: 6,
      awaitingReview: 2,
      passed: 4,
      failed: 2,
    });
    expect(Object.keys(bucketCounts({})).sort()).toEqual(
      STATUS_BUCKETS.map((b) => b.key).sort(),
    );
  });

  it('the four buckets sum to the total — every status belongs to exactly one bucket', () => {
    const one: Record<string, number> = {};
    for (const s of INSPECTION_STATUSES) one[s] = 1;
    const out = bucketCounts(one);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(
      INSPECTION_STATUSES.length,
    );
  });
});

describe('nextForInspector', () => {
  const rows = [
    { id: 'a', status: 'SUBMITTED', assignedInspectorId: 'me' },
    { id: 'b', status: 'ASSIGNED', assignedInspectorId: 'me' },
    { id: 'c', status: 'IN_PROGRESS', assignedInspectorId: 'someone-else' },
    { id: 'd', status: 'IN_PROGRESS', assignedInspectorId: 'me' },
    { id: 'e', status: 'ASSIGNED', assignedInspectorId: 'me' },
  ];

  it('prefers my first IN_PROGRESS row, ignoring other inspectors', () => {
    expect(nextForInspector(rows, 'me')).toEqual({
      kind: 'continue',
      inspection: rows[3],
    });
  });

  it('falls back to my first ASSIGNED row, then to null', () => {
    expect(
      nextForInspector(
        rows.filter((r) => r.id !== 'd'),
        'me',
      ),
    ).toEqual({ kind: 'start', inspection: rows[1] });
    expect(
      nextForInspector(
        rows.filter((r) => r.id === 'a'),
        'me',
      ),
    ).toBeNull();
    expect(nextForInspector([], 'me')).toBeNull();
  });

  it('treats an already inspector-scoped list as all mine when userId is null', () => {
    expect(nextForInspector([{ status: 'IN_PROGRESS' }], null)?.kind).toBe(
      'continue',
    );
  });
});
