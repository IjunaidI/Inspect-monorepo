/**
 * Domain enums mirroring the Prisma schema (apps/api/prisma/schema.prisma).
 * Defined here independently so the console and future mobile app can share the
 * contract WITHOUT importing the Prisma client. The API maps Prisma <-> these.
 *
 * Each enum is a readonly tuple (for runtime iteration) plus a derived union type.
 */

export const ORG_TYPES = ['INSPECTION_COMPANY', 'MANUFACTURER'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const ORG_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const USER_ROLES = [
  'INSPECTOR',
  'QA_MANAGER',
  'ORG_OWNER',
  'PLATFORM_ADMIN',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Roles a person can be invited or directly added as. `PLATFORM_ADMIN` is
 * excluded deliberately — the API refuses to mint one through the invite and
 * direct-add paths, so no client should offer it. Derived from `UserRole`
 * rather than re-listed, so adding a role to the domain cannot silently bypass
 * this gate.
 */
export type InvitableRole = Exclude<UserRole, 'PLATFORM_ADMIN'>;

export const USER_STATUSES = [
  'ACTIVE',
  'INVITED',
  'SUSPENDED',
  'DEACTIVATED',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const INSPECTION_TYPES = ['PRE_SHIPMENT'] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const INSPECTION_STATUSES = [
  'DRAFT',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REPORT_ISSUED',
  'REJECTED',
  'HOLD',
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const AQL_LEVELS = ['I', 'II', 'III', 'S1', 'S2', 'S3', 'S4'] as const;
export type AqlLevel = (typeof AQL_LEVELS)[number];

export const DEFECT_SEVERITIES = ['CRITICAL', 'MAJOR', 'MINOR'] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

export const DEFECT_SCOPES = ['GLOBAL', 'ORG'] as const;
export type DefectScope = (typeof DEFECT_SCOPES)[number];

export const AQL_CLASS_OUTCOMES = ['PASS', 'FAIL'] as const;
export type AqlClassOutcome = (typeof AQL_CLASS_OUTCOMES)[number];

export const QA_DECISIONS = ['PASS', 'FAIL', 'HOLD'] as const;
export type QaDecision = (typeof QA_DECISIONS)[number];

export const PHOTO_SOURCES = ['MOBILE_VERIFIED', 'MANUAL_UPLOAD'] as const;
export type PhotoSource = (typeof PHOTO_SOURCES)[number];

export const REPORT_STATUSES = ['GENERATED', 'DELIVERED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const DELIVERY_CHANNELS = ['EMAIL', 'PORTAL'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const REPORT_ACCESS_ACTIONS = ['VIEW', 'DOWNLOAD'] as const;
export type ReportAccessAction = (typeof REPORT_ACCESS_ACTIONS)[number];

export const AUDIT_ACTOR_TYPES = [
  'USER',
  'PLATFORM_ADMIN',
  'BUYER_GUEST',
  'SYSTEM',
] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const BILLABLE_EVENT_KINDS = ['INSPECTION', 'RE_INSPECTION'] as const;
export type BillableEventKind = (typeof BILLABLE_EVENT_KINDS)[number];

/** Lowercase defect class keys used in AQL JSON shapes. */
export const DEFECT_CLASSES = ['critical', 'major', 'minor'] as const;
export type DefectClass = (typeof DEFECT_CLASSES)[number];

/** ISO 2859-1 sample-size code letters. */
export const AQL_CODE_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
  'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R',
] as const;
export type AqlCodeLetter = (typeof AQL_CODE_LETTERS)[number];
