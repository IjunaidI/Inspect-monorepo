/**
 * `@inspect/domain` — platform-free rules shared by the API, the console and
 * the mobile app (INS-086 Phase 1). No I/O, no React, no platform imports.
 */
export { ROLE_RANK, roleAtLeast } from './roles';
export { hashIndex, initialsFrom } from './text';
export { reportNumber } from './report-number';
export {
  conclusionFrom,
  formatGps,
  formatInspectionType,
  type ReportConclusion,
} from './report-display';
export {
  LOCKED_STATUSES,
  SUBMITTABLE_STATUSES,
  DECIDABLE_STATUSES,
  REPORTABLE_STATUSES,
  REINSPECTABLE_STATUSES,
  STATUS_BUCKETS,
  isLockedStatus,
} from './inspection-status';
