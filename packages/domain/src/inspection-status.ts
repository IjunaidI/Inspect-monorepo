import type { InspectionStatus } from '@inspect/shared-types';

/**
 * Inspection status transition rules (spec §9) — the SINGLE declaration.
 *
 * Once submitted, an inspection is immutable; corrections require a new linked
 * re-inspection. The API's populate/submit/decision guards read these sets, and
 * the clients read them to render a locked inspection read-only instead of
 * letting every action fail server-side. The API stays the authority on every
 * request; what a client does with these is decide what to render.
 */

/** Statuses in which populate writes are refused — the immutability boundary. */
export const LOCKED_STATUSES: readonly InspectionStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REPORT_ISSUED',
  'REJECTED',
  'HOLD',
];

/** Statuses from which POST /inspections/:id/submit is legal. */
export const SUBMITTABLE_STATUSES: readonly InspectionStatus[] = [
  'DRAFT',
  'ASSIGNED',
  'IN_PROGRESS',
];

/** Statuses from which a QA decision is legal. */
export const DECIDABLE_STATUSES: readonly InspectionStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'HOLD',
];

/** Statuses in which the signed report exists (or can be generated). */
export const REPORTABLE_STATUSES: readonly InspectionStatus[] = ['APPROVED', 'REPORT_ISSUED'];

/**
 * Statuses from which a linked re-inspection (`supersedesInspectionId`) is the
 * correction path — the immutability rule's other half.
 */
export const REINSPECTABLE_STATUSES: readonly InspectionStatus[] = ['REJECTED', 'HOLD'];

/**
 * The nine InspectionStatus values folded into the four states a QA manager
 * actually acts on (INS-068) — the dashboard's KPI partition. Every status
 * belongs to exactly one bucket, so the four tiles always sum to the org's
 * total inspections. Composed from the transition sets above so the two
 * tables cannot drift: "in progress" IS submittable, "awaiting review" IS
 * decidable, "passed" IS reportable.
 */
export const STATUS_BUCKETS: readonly {
  key: 'inProgress' | 'awaitingReview' | 'passed' | 'failed';
  label: string;
  statuses: readonly InspectionStatus[];
}[] = [
  { key: 'inProgress', label: 'In progress', statuses: SUBMITTABLE_STATUSES },
  { key: 'awaitingReview', label: 'Awaiting review', statuses: DECIDABLE_STATUSES },
  { key: 'passed', label: 'Passed', statuses: REPORTABLE_STATUSES },
  { key: 'failed', label: 'Failed', statuses: ['REJECTED'] },
];

/**
 * True when the inspection can no longer be populated. Takes a loose string on
 * purpose — status comes off a wire DTO; an unknown value locks (fail closed).
 */
export function isLockedStatus(status: string | undefined | null): boolean {
  if (!status) return true;
  if ((SUBMITTABLE_STATUSES as readonly string[]).includes(status)) return false;
  return true;
}
