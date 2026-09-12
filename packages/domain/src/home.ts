import type { InspectionStatus } from '@inspect/shared-types';
import { STATUS_BUCKETS } from './inspection-status';

/**
 * Home-screen rules (INS-099) — the counts and the "what should I do next"
 * pick, shared by the mobile Home tab and the web dashboard so both platforms
 * fold the nine statuses the same way. Pure: rows in, numbers out.
 */

export type StatusBucketKey = (typeof STATUS_BUCKETS)[number]['key'];

/** Count rows per raw status. Unknown statuses are counted under their own key, never dropped. */
export function statusCounts(
  rows: readonly { status: string }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

/**
 * Fold a per-status count map (the dashboard DTO's `inspectionsByStatus`, or
 * `statusCounts()` of a list) into the four `STATUS_BUCKETS`. Every bucket key
 * is present, so a tile never reads `undefined`.
 */
export function bucketCounts(
  byStatus: Readonly<Record<string, number>>,
): Record<StatusBucketKey, number> {
  const out = {} as Record<StatusBucketKey, number>;
  for (const bucket of STATUS_BUCKETS) {
    out[bucket.key] = bucket.statuses.reduce(
      (sum, s) => sum + (byStatus[s] ?? 0),
      0,
    );
  }
  return out;
}

export interface NextForInspector<T> {
  kind: 'continue' | 'start';
  inspection: T;
}

/**
 * The inspector's "Continue" / "Start" target: the first IN_PROGRESS inspection
 * assigned to them, else the first ASSIGNED one, else null. Rows are expected
 * in the API's createdAt-desc order, so "first" is the most recent. Rows with
 * no `assignedInspectorId` (an older fixture) count as theirs only when the
 * list itself is already inspector-scoped — pass `userId: null` for that case.
 */
export function nextForInspector<
  T extends { status: string; assignedInspectorId?: string | null },
>(rows: readonly T[], userId: string | null): NextForInspector<T> | null {
  const mine = rows.filter(
    (r) => userId === null || r.assignedInspectorId === userId,
  );
  const inProgress = mine.find(
    (r) => (r.status as InspectionStatus) === 'IN_PROGRESS',
  );
  if (inProgress) return { kind: 'continue', inspection: inProgress };
  const assigned = mine.find(
    (r) => (r.status as InspectionStatus) === 'ASSIGNED',
  );
  if (assigned) return { kind: 'start', inspection: assigned };
  return null;
}
