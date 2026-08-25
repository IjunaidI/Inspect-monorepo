/**
 * Wire DTOs shared by the API, the console and the future React Native app
 * (INS-008).
 *
 * These were declared only inside `apps/web/lib/api.ts`, which made them
 * invisible to the API and to any second client. That matters most for the
 * counterparty types below: [INS-055](../../../docs/future/BACKLOG.md) unifies
 * `Buyer` + `Supplier` into a single `Company`, and its plan gates Phase 1 on
 * these living here first — otherwise the `Company` DTO gets written twice on
 * day one, in files that have already drifted once.
 *
 * No runtime dependencies: consumed by a NestJS server, a Next.js server and an
 * RN bundle alike.
 */
import type { GpsPoint } from './json-contracts';

/** Relation counts decorating list rows (INS-005). Absent on detail reads. */
export interface RelationCounts {
  purchaseOrders: number;
  inspections: number;
  reports?: number;
}

export interface BuyerDto {
  id: string;
  name: string;
  /**
   * DURABLE value (INS-072): either an object key in this org's buyer namespace
   * (`orgs/{orgId}/buyers/<uuid>.<ext>`) or a legacy absolute `https://…` URL.
   * Never a presigned URL — it freezes verbatim into the signed report's
   * `brandingSnapshot`, so a ~900s URL here would rot the artifact permanently.
   * Submit this value on write; render `logoViewUrl`.
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
  archivedAt?: string | null;
  updatedAt?: string;
  _count?: RelationCounts;
}

export interface SupplierDto {
  id: string;
  name: string;
  address?: string | null;
  gps?: GpsPoint | null;
  archivedAt?: string | null;
  updatedAt?: string;
  _count?: RelationCounts;
}

export interface ProductDto {
  id: string;
  styleNumber: string;
  description?: string | null;
  archivedAt?: string | null;
  updatedAt?: string;
  _count?: RelationCounts;
}

/**
 * A buyer-side guest holding a magic-link token. INS-055 Phase 6 renames this to
 * `CompanyGuest`; the visibility predicate it implies is a security boundary
 * (spec §4), never a field to widen casually.
 */
export interface BuyerGuestDto {
  id: string;
  email: string;
  status: string;
  lastAccessAt: string | null;
  tokenExpiresAt: string;
  createdAt: string;
}
