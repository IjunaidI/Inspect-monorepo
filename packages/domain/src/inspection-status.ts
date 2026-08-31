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

/**
 * True when the inspection can no longer be populated. Takes a loose string on
 * purpose — status comes off a wire DTO; an unknown value locks (fail closed).
 */
export function isLockedStatus(status: string | undefined | null): boolean {
  if (!status) return true;
  if ((SUBMITTABLE_STATUSES as readonly string[]).includes(status)) return false;
  return true;
}
