/**
 * Wire DTOs for the API's response and request shapes (INS-086 Phase 1).
 *
 * Lifted out of `apps/web/lib/api.ts`, which was the single declaration of the
 * entire wire contract and therefore unreachable for any second client. The
 * console keeps every `Api*` name as a one-line alias, so no call site moved.
 *
 * These describe what the API actually SENDS — not the Prisma models. Where the
 * two differ (a `select` narrowing a relation, a decorated `viewUrl`), the wire
 * shape wins, because that is what a client can rely on.
 */
import type {
  AqlClassOutcome,
  DefectClass,
  DefectScope,
  DefectSeverity,
  InvitableRole,
  OrgType,
  QaDecision,
  UserRole,
  UserStatus,
} from './enums';

/** Binding QA-call rollup (INS-068). PENDING = submitted, awaiting the QA decision. */
export interface QaDecisionCountsDto {
  PASS: number;
  FAIL: number;
  HOLD: number;
  PENDING: number;
}

/**
 * Org quality metrics (INS-068). `dphu`/`passRate` are `null` — not 0 — until
 * there is something to divide by, so the tiles render "—" instead of NaN.
 */
export interface QualityMetricsDto {
  decidedInspections: number;
  sampledUnits: number;
  defectsFound: number;
  /** Defects per hundred units: 100 × defectsFound / sampledUnits, 2dp. */
  dphu: number | null;
  /** 100 × PASS / (PASS + FAIL), 1dp. HOLD is unresolved and excluded. */
  passRate: number | null;
  /** PASS + FAIL — the passRate denominator. */
  verdicts: number;
  /** DPHU covers only the most recent bounded window of decided inspections. */
  truncated: boolean;
}

/** GET /dashboard/summary — org-scoped rollups for the console dashboard (INS-005, KPIs in INS-068). */
export interface DashboardSummaryDto {
  inspectionsByStatus: Record<string, number>;
  qaDecisionCounts: QaDecisionCountsDto;
  quality: QualityMetricsDto;
  /** INS-055: one unified counterparty count (was `buyers` + `suppliers`). */
  companies: number;
  products: number;
  purchaseOrders: number;
  reports: number;
}

export interface LoopPresetDto {
  id: string;
  name: string;
  version: number;
  description?: string | null;
  aqlLevel?: string | null;
  isArchived: boolean;
  updatedAt?: string;
  /** INS-005 list aggregates — present on GET /loop-presets rows. */
  _count?: { items: number; inspections: number; defaultForCompanies: number };
}

export interface MeasurementFieldDto {
  id: string;
  label: string;
  unit?: string | null;
  position: number;
}

/**
 * PresetStepAllowedDefect is a join row keyed by @@id([presetLoopStepId,
 * defectCatalogId]) — it has NO `id` column. Declaring one here made `ad.id`
 * type-check while being undefined at runtime, which silently produced
 * `key={undefined}` on every rendered chip.
 */
export interface AllowedDefectDto {
  /** INS-081: the junction is loop-global; its PK is (loopPresetId, defectCatalogId) — there is no `id`. */
  loopPresetId: string;
  defectCatalogId: string;
  defectCatalog: {
    id: string;
    name: string;
    defaultSeverity: DefectSeverity;
  };
}

/** INS-081: one ordered capture point taking exactly one image. */
export interface PresetItemDto {
  id: string;
  itemName: string;
  description?: string | null;
  referenceImageUrl?: string | null;
  position: number;
  /** Present on GET /loop-presets/:id — the key decorated with a short-lived view URL (INS-052). */
  referenceImage?: { key: string; viewUrl: string | null } | null;
}

export interface LoopPresetDetailDto extends LoopPresetDto {
  items: PresetItemDto[];
  /** INS-081: both are LOOP-GLOBAL — defined once, not per item. */
  measurementFields: MeasurementFieldDto[];
  allowedDefects: AllowedDefectDto[];
}

/** AQL inspection levels; the MVP engine implements General Level II only (INS-052). */
export type AqlLevelInput = 'I' | 'II' | 'III' | 'S1' | 'S2' | 'S3' | 'S4';

/** One ordered single-image capture point in POST /loop-presets (INS-081). */
export interface PresetItemInput {
  itemName: string;
  description?: string;
  /** Storage key under orgs/<orgId>/presets/ — never a presigned URL. */
  referenceImageUrl?: string;
}

/** Body of POST /loop-presets — one loop; tags and the sheet are loop-global. */
export interface CreateLoopPresetInput {
  name: string;
  description?: string;
  aqlLevel?: AqlLevelInput;
  items: PresetItemInput[];
  measurementFields?: Array<{ label: string; unit?: string }>;
  allowedDefectCatalogIds?: string[];
}

/** Body of POST /defect-catalog — a custom org defect. */
export interface CreateDefectInput {
  name: string;
  defaultSeverity: DefectSeverity;
}

export interface DefectCatalogDto {
  id: string;
  name: string;
  defaultSeverity: DefectSeverity;
  scope: DefectScope;
  isArchived: boolean;
}
export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt?: string | null;
}
export interface AqlResultDto {
  systemRecommendation: AqlClassOutcome;
  perClass: Record<DefectClass, { found: number; ac: number; re: number; outcome: AqlClassOutcome }>;
  qaDecision?: QaDecision | null;
  qaRemarks?: string | null;
}
export interface InspectionDto {
  id: string;
  status: string;
  /** Prisma enum (e.g. PRE_SHIPMENT) — render with underscores replaced. */
  inspectionType?: string;
  lotSize?: number | null;
  computedSampling?: { sampleSizeCodeLetter: string; sampleSize: number; perClass: Record<string, { aql: number; ac: number; re: number }> } | null;
  aqlResult?: AqlResultDto | null;
  /**
   * INS-055: trade role lives on this EDGE, not on the company row — the same
   * company can be the client here and the factory on another inspection. The
   * factory edge stays optional, exactly as `supplier` was.
   */
  clientCompany?: { id: string; name: string; primaryColor?: string | null } | null;
  factoryCompany?: { id: string; name: string; gps?: { lat: number; lng: number } | null } | null;
  product?: { id: string; styleNumber: string } | null;
  purchaseOrder?: { id: string; poNumber: string } | null;
  /** Present on GET /inspections/:id (safe select: id/name/email). */
  assignedInspector?: { id: string; name: string | null; email: string } | null;
  createdAt?: string;
  /** INS-081: the loop's ordered single-image items, each carrying its photos. */
  items?: InspectionLoopItemDto[];
  /** Per-unit measurement values (loop-global sheet). */
  measurements?: MeasurementDto[];
  /** Server-computed completeness — the same rule submit() enforces. */
  cycleState?: CycleStateDto;
  /** Frozen at creation; carries the loop-global measurement sheet + defect tags. */
  loopPresetSnapshot?: {
    presetId: string;
    version: number;
    items: { position: number; itemName: string; description?: string; referenceImageUrl?: string }[];
    measurementFields: { label: string; unit?: string }[];
    allowedDefects: { defectCatalogId: string; name: string; severity: DefectSeverity }[];
  } | null;
  // NO `inspectorId`: `Inspection` has no such column. The only `inspectorId`
  // in the schema lives INSIDE the `tamperProof` JSON and means the ACTUAL
  // submitter — a different fact from the assigned inspector, which the schema
  // comment calls out explicitly. Declaring it here invited exactly that
  // conflation; nothing read it, so it is removed rather than mapped.
  /** Scalar FK on list rows (INS-057) — assignedInspector object only on GET /:id. */
  assignedInspectorId?: string | null;
  supersedesInspectionId?: string | null;
}
export interface PurchaseOrderDto {
  id: string;
  poNumber: string;
  totalQuantity?: number | null;
  /** INS-055: a PO is explicitly two-party. Both are required on create. */
  clientCompany?: { id: string; name: string } | null;
  factoryCompany?: { id: string; name: string } | null;
  product?: { id: string; styleNumber: string } | null;
}
/** Body of POST /purchase-orders. A PO is explicitly two-party (INS-055). */
export interface CreatePurchaseOrderInput {
  poNumber: string;
  clientCompanyId: string;
  factoryCompanyId: string;
  productId: string;
  totalQuantity?: number;
}

/** Body of PATCH /purchase-orders/:id — the parties are immutable after create. */
export interface UpdatePurchaseOrderInput {
  poNumber?: string;
  totalQuantity?: number;
}

export interface AqlPreviewDto {
  sampleSizeCodeLetter: string;
  sampleSize: number;
  perClass: Record<'critical' | 'major' | 'minor', { aql: number; ac: number; re: number }>;
}

// ── Populate API shapes ──
/** Body of POST /inspections/:id/populate/photos/presign. */
export interface PresignInput {
  /** File extension for the storage key (default 'jpg'). */
  ext?: string;
}

export interface PresignResultDto {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
}

export interface RegisterPhotoInput {
  storageKey: string;
  contentHash: string;
  /** INS-081: every upload targets a slot — (loop item, cycle). Both required. */
  inspectionLoopItemId: string;
  cycleIndex: number;
  thumbnailKey?: string;
  capturedAt?: string;
  deviceId?: string;
  gps?: string;
  exif?: Record<string, unknown>;
  clientRequestId?: string;
}

/** INS-081: replace the bytes in an occupied slot, keeping the slot itself. */
export interface RetakePhotoInput {
  storageKey: string;
  contentHash: string;
}

export interface AddDefectInput {
  defectCatalogId?: string;
  customText?: string;
  severity?: DefectSeverity;
  /** INS-081: the tag list is loop-global, but the instance pins to a slot. */
  inspectionLoopItemId: string;
  cycleIndex: number;
  notes?: string;
  photoIds?: string[];
}

export interface AddMeasurementInput {
  /** INS-081: the sheet is loop-global and filled once per unit. */
  cycleIndex: number;
  label: string;
  recordedValue?: string;
  unit?: string;
  notes?: string;
}

export interface PhotoDto {
  id: string;
  storageKey: string;
  contentHash?: string | null;
  inspectionLoopItemId: string;
  cycleIndex: number;
  capturedAt?: string | null;
  clientRequestId?: string | null;
  /** Short-lived presigned GET URL (INS-049) — present on GET /inspections/:id; null when presign fails. */
  viewUrl?: string | null;
}

export interface DefectInstanceDto {
  id: string;
  severity: DefectSeverity;
  defectCatalog?: { id: string; name: string } | null;
  customText?: string | null;
  inspectionLoopItemId?: string | null;
  cycleIndex?: number | null;
  notes?: string | null;
}

export interface MeasurementDto {
  id: string;
  label: string;
  recordedValue?: string | null;
  unit?: string | null;
  /** INS-081: a measurement belongs to a unit, not to a loop item. */
  cycleIndex: number;
}

export interface InspectionLoopItemDto {
  id: string;
  /** Wire names are the Prisma-native columns (INS-064) — do NOT re-alias. */
  itemName: string;
  position: number;
  description?: string | null;
  referenceImageUrl?: string | null;
  photos?: PhotoDto[];
  defects?: DefectInstanceDto[];
}

/**
 * INS-081: the server-computed cycle state. The console renders exactly the rule
 * the submit guard enforces — a divergence is how a half-shot unit would reach a
 * signed report, so this is never recomputed client-side.
 */
export interface CycleStateDto {
  completedCycles: number;
  partialCycles: { cycleIndex: number; missingItemIds: string[] }[];
  nextSlot: { cycleIndex: number; itemId: string } | null;
  totalPhotos: number;
}

export interface ReportDto {
  id: string;
  inspectionId: string;
  canonicalSnapshot?: Record<string, unknown> | null;
  contentHash?: string | null;
  signature?: string | null;
  pdfStorageKey?: string | null;
  generatedAt: string;
  // NO `generatedBy`: the Report model has no generatedByUserId column, so the
  // API has never been able to send one. It was declared here anyway, and the
  // console's report page read `report.generatedBy?.name` into the tamper-proof
  // block's "signed by" — which therefore rendered an em-dash on every report.
  // Recording and showing the signer is INS-089, and needs a schema change.
}

/** GET /reports row (INS-062) — list metadata only, never canonicalSnapshot. */
export interface ReportListItemDto {
  id: string;
  inspectionId: string;
  status: string;
  generatedAt: string;
  contentHash?: string | null;
  pdfStorageKey?: string | null;
  verificationToken?: string | null;
  /**
   * INS-055: the API selects `clientCompany` here. This was still named
   * `buyer` after the Company migration, and because it is optional `tsc`
   * never complained — the reports list rendered an em-dash in its client
   * column for every row until INS-086 Phase 1 moved this file.
   */
  clientCompany?: { id: string; name: string } | null;
  inspection?: {
    status: string;
    purchaseOrder?: { poNumber: string } | null;
    product?: { styleNumber: string } | null;
  } | null;
}

/**
 * GET /reports/:id/pdf (INS-003) — a short-lived presigned GET URL, never the
 * PDF bytes through the API. Same design as photo viewing (INS-049).
 */
export interface ReportPdfDownloadDto {
  reportId: string;
  url: string;
  expiresInSeconds: number;
}

export interface VerifyResultDto {
  valid: boolean;
  hashMatches: boolean;
  signatureValid: boolean;
  reportId?: string | null;
  inspectionId?: string | null;
  generatedAt?: string | null;
}

/** Buyer-visible photo evidence on GET /guest/reports/:id (INS-049). */
export interface GuestReportPhotoDto {
  id: string;
  contentHash?: string | null;
  /**
   * INS-081 retired "loops" in favour of loop ITEMS, and `guest.service`
   * selects `inspectionLoopItemId`. This was still declared as
   * `inspectionLoopId` — a key the endpoint has never sent. Nothing read it,
   * so the fix is the correct name rather than a mapping.
   */
  inspectionLoopItemId?: string | null;
  viewUrl: string | null;
}

export interface GuestReportDto {
  id: string;
  generatedAt: string;
  contentHash?: string | null;
  pdfStorageKey?: string | null;
  verificationToken?: string | null;
  canonicalSnapshot?: Record<string, unknown> | null;
  brandingSnapshot?: { logoUrl?: string | null; primaryColor?: string | null } | null;
  /** Present on the detail endpoint (GET /guest/reports/:id) only. */
  photos?: GuestReportPhotoDto[];
}

/** Body of POST /users/invite (ORG_OWNER). PLATFORM_ADMIN is never invitable. */
export interface InviteUserInput {
  email: string;
  role: UserRole;
}

/** Body of POST /users (ORG_OWNER) — direct member create, no invitation. */
export interface CreateMemberInput {
  name?: string;
  email: string;
  password: string;
  role?: UserRole;
}

/** Body of the public POST /invitations/accept. Password floor: 8 chars. */
export interface AcceptInvitationInput {
  token: string;
  name?: string;
  password: string;
}

export interface InvitationDto {
  id: string;
  token: string;
  email: string;
  role: InvitableRole;
  expiresAt?: string;
  orgId: string;
  /** Whether the invitation email was actually delivered (MailService result). */
  emailSent?: boolean;
}

/** Public GET /invitations/:token — verified invite data (INS-054). 404 unknown; 410 consumed/expired. */
export interface InvitationLookupDto {
  email: string;
  role: string;
  orgName: string | null;
  expiresAt: string;
}

/** GET /admin/orgs row (PLATFORM_ADMIN only). */
export interface OrganizationDto {
  id: string;
  name: string;
  type: OrgType;
  createdAt: string;
}

/** POST /admin/orgs — the org plus its first ORG_OWNER invitation. */
export interface CreatedOrgDto {
  org: OrganizationDto;
  invitation: { token: string; email: string; role: string; expiresAt: string };
  emailSent: boolean;
}
