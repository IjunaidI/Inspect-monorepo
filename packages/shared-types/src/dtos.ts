/**
 * Wire DTOs shared by the API, the console and the future React Native app
 * (INS-008).
 *
 * These were declared only inside `apps/web/lib/api.ts`, which made them
 * invisible to the API and to any second client. Landing them here first is what
 * let [INS-055](../../../docs/future/BACKLOG.md) unify `Buyer` + `Supplier` into
 * a single `Company` without writing the `Company` DTO twice, in two files that
 * had already drifted once.
 *
 * No runtime dependencies: consumed by a NestJS server, a Next.js server and an
 * RN bundle alike.
 */
import type { GpsPoint } from './json-contracts';
import type { CompanyKind } from './enums';

/** Relation counts decorating list rows (INS-005). Absent on detail reads. */
export interface RelationCounts {
  purchaseOrders: number;
  inspections: number;
  reports?: number;
}


export interface ProductDto {
  id: string;
  styleNumber: string;
  description?: string | null;
  archivedAt?: string | null;
  updatedAt?: string;
  _count?: RelationCounts;
}

// ── The unified counterparty (INS-055) ───────────────────────────────────────
//
// `Company` replaces `Buyer` + `Supplier`. Trade role is a property of the
// PurchaseOrder / Inspection / Report EDGE (`clientCompanyId` /
// `factoryCompanyId`), never of this row — the same company may be the client on
// one PO and the factory on another. `kind` is the orthogonal OWNERSHIP axis.
//
// Deliberately absent: `role`, `canBeClient`, `canBeFactory` (spec §0 P3). Flags
// would re-encode the split this model exists to remove.

export interface CompanyDto {
  id: string;
  name: string;
  kind: CompanyKind;
  /**
   * Client-role identity. DURABLE value (INS-072): either an object key in this
   * org's company namespace (`orgs/{orgId}/companies/<uuid>.<ext>`) or a legacy
   * absolute `https://…` URL. Never a presigned URL — it freezes verbatim into
   * the signed report's `brandingSnapshot`, so a ~900s URL here would rot the
   * tamper-proof artifact permanently. Submit this value on write; render
   * `logoViewUrl`.
   */
  logoUrl?: string | null;
  /**
   * Render-time only (INS-072): a short-lived presigned GET for `logoUrl`, the
   * legacy URL echoed verbatim, or null (foreign-org key / storage
   * unconfigured). Decorated onto reads — never persisted or submitted.
   */
  logoViewUrl?: string | null;
  primaryColor?: string | null;
  branding?: Record<string, unknown> | null;
  defaultLoopPresetId?: string | null;
  /** Factory-role identity. */
  address?: string | null;
  gps?: GpsPoint | null;
  archivedAt?: string | null;
  updatedAt?: string;
  /**
   * Flattened by the API across BOTH role edges — `purchaseOrders` sums the
   * client and factory sides. Flattening happens server-side on purpose so the
   * console and a future mobile client cannot each invent their own arithmetic.
   */
  _count?: RelationCounts;
}

export interface CreateCompanyInput {
  name: string;
  /** Defaults to THIRD_PARTY when omitted. */
  kind?: CompanyKind;
  logoUrl?: string | null;
  primaryColor?: string | null;
  branding?: unknown;
  defaultLoopPresetId?: string | null;
  address?: string | null;
  gps?: GpsPoint | null;
}

export type UpdateCompanyInput = Partial<CreateCompanyInput>;

/**
 * A guest holding a magic-link token, attached to a company acting in its
 * CLIENT role only (spec §0 P7 — there is no factory-side portal). The
 * visibility predicate this implies is a security boundary (spec §4.2): reports
 * are matched on `clientCompanyId` AND `orgId`, never on a party-agnostic
 * predicate that would hand a factory's guest the client's signed report.
 */
export interface CompanyGuestDto {
  id: string;
  email: string;
  status: string;
  lastAccessAt: string | null;
  tokenExpiresAt: string;
  createdAt: string;
}
