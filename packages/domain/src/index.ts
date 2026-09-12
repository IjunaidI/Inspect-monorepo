/**
 * `@inspect/domain` — platform-free rules shared by the API, the console and
 * the mobile app (INS-086 Phase 1). No I/O, no React, no platform imports.
 */
export { ROLE_RANK, roleAtLeast } from './roles';
export { hashIndex, initialsFrom } from './text';
export {
  rankCompaniesByActivity,
  type CompanyTradeRole,
  type RankableCompany,
} from './company-ranking';
export { filterOptions } from './filter-options';
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
export { latestPresetPerName } from './presets';
export {
  CAPTURE_POINT_CATEGORY_ORDER,
  CAPTURE_POINT_CATEGORY_LABELS,
  CAPTURE_POINT_CATEGORY_ICONS,
  LOOP_TEMPLATES,
  groupCapturePoints,
  iconForCapturePoint,
  isInLoop,
  draftItemFromCapturePoint,
  moveItem,
  resolveTemplate,
  type CapturePointLike,
  type CapturePointGroup,
  type LoopItemLike,
  type LoopTemplate,
} from './capture-points';
export {
  statusCounts,
  bucketCounts,
  nextForInspector,
  type NextForInspector,
  type StatusBucketKey,
} from './home';
