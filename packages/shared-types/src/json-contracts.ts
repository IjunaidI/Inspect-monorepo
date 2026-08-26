/**
 * Contracts for the `Json` columns in the Prisma schema. These are the shapes
 * the API writes and the console/mobile read — the schema stores them as opaque
 * Json, so this file is the single source of truth for their structure.
 *
 * Lightweight runtime type guards are provided (no external deps). Stricter
 * runtime validation (e.g. Zod) can be layered on in a later phase.
 */
import {
  AqlClassOutcome,
  AqlCodeLetter,
  DefectClass,
  DefectSeverity,
} from './enums';

/** Optional GPS point stored on Company.gps, Photo.gps, tamperProof.gps. */
export interface GpsPoint {
  lat: number;
  lng: number;
  accuracyMeters?: number;
}

/** Inspection.aqlPlan — per-class AQLs (general level is Inspection.aqlLevel). */
export interface AqlPlan {
  critical?: number;
  major?: number;
  minor?: number;
}

/** A resolved single-sampling plan for one class. */
export interface AqlClassPlan {
  aql: number;
  ac: number;
  re: number;
}

/** Inspection.computedSampling — frozen output of the AQL engine. */
export interface ComputedSampling {
  sampleSizeCodeLetter: AqlCodeLetter;
  sampleSize: number;
  perClass: Partial<Record<DefectClass, AqlClassPlan>>;
}

/** AqlResult.perClass — per-class evaluation detail. */
export interface AqlPerClassResult {
  found: number;
  ac: number;
  re: number;
  outcome: AqlClassOutcome;
}

/** Inspection.tamperProof — frozen on submit; the actual submitter (spec §9). */
export interface TamperProofBlock {
  inspectorId?: string;
  deviceId?: string;
  submittedAt: string; // ISO 8601
  gps?: GpsPoint;
}

/**
 * One resolved loop ITEM inside Inspection.loopPresetSnapshot (immutable, spec §6).
 * INS-081: an item is a single capture point taking exactly one image — there is
 * no shot count, and no per-item defect or measurement list.
 */
export interface LoopPresetSnapshotItem {
  position: number;
  itemName: string;
  description?: string;
  referenceImageUrl?: string;
}

export interface LoopPresetSnapshot {
  presetId?: string;
  version?: number;
  items: LoopPresetSnapshotItem[];
  /** INS-081: LOOP-GLOBAL — the sheet filled once per cycle. */
  measurementFields: Array<{ label: string; unit?: string }>;
  /**
   * INS-081: LOOP-GLOBAL taggable defects. Resolved (not just FK) so later
   * catalog edits cannot mutate history.
   */
  allowedDefects: Array<{
    defectCatalogId?: string;
    name: string;
    severity: DefectSeverity;
  }>;
}

/** Report.brandingSnapshot — frozen buyer theme at generation (spec §10). */
export interface BrandingSnapshot {
  logoUrl?: string;
  primaryColor?: string;
  [key: string]: unknown;
}

// ── Lightweight runtime guards ───────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isGpsPoint(v: unknown): v is GpsPoint {
  return isObject(v) && typeof v.lat === 'number' && typeof v.lng === 'number';
}

export function isTamperProofBlock(v: unknown): v is TamperProofBlock {
  if (!isObject(v)) return false;
  if (typeof v.submittedAt !== 'string') return false;
  if (v.gps !== undefined && !isGpsPoint(v.gps)) return false;
  return true;
}

// ── Canonical report payload (INS-055 spec §5) ───────────────────────────────
//
// Two canonical shapes exist FOREVER. v1 rows are immutable and outlive any
// migration, so everything below is permanent code, not migration scaffolding.
//
// The hard rule these helpers exist to protect: nothing may ever UPDATE
// reports.canonicalSnapshot / contentHash / signature. Not to normalize, not to
// backfill a version marker. That is the Ed25519 seal on a document a buyer may
// already hold. Readers adapt to the stored shape; the stored shape never moves.

/** One party inside a canonical payload, in either version's shape. */
export interface CanonicalParty {
  companyId: string | null;
  name: string | null;
}

export interface CanonicalParties {
  client: CanonicalParty;
  /** null when the inspection recorded no factory. */
  factory: CanonicalParty | null;
}

/**
 * Which canonical shape a stored snapshot uses.
 *
 * The marker lives INSIDE the payload, so it is hashed and signed and cannot be
 * spoofed by editing a side column. `Report.canonicalVersion` mirrors it for
 * indexing and ops only and is NEVER the dispatch authority: if the two
 * disagree, the payload wins and the row was edited.
 *
 * Absent — or anything that is not exactly the number 2 — means v1, the shape of
 * every report signed before INS-055. Defaulting to v1 is deliberate: a hostile
 * `"2"` must not be able to select a reader.
 */
export function canonicalVersionOf(snapshot: unknown): 1 | 2 {
  const v = (snapshot as { canonicalVersion?: unknown } | null)
    ?.canonicalVersion;
  return v === 2 ? 2 : 1;
}

/**
 * The ordered photo hashes the signature covers.
 *
 * `photoHashes` deliberately stays at the TOP LEVEL under the same key in both
 * versions, so the verifier's only shape dependency is stable across versions.
 * This function is therefore version-independent on purpose; it exists as a
 * named function so the coupling is visible rather than inlined at the call
 * site. `[]` for a missing or non-array value matches the verifier's `?? []`.
 */
export function photoHashesOf(snapshot: unknown): string[] {
  const v = (snapshot as { photoHashes?: unknown } | null)?.photoHashes;
  return Array.isArray(v) ? (v as string[]) : [];
}

function partyOf(
  value: unknown,
  idKey: 'id' | 'companyId',
): CanonicalParty | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const companyId = typeof raw[idKey] === 'string' ? (raw[idKey] as string) : null;
  const name = typeof raw.name === 'string' ? raw.name : null;
  // A party present in the payload but empty on both fields (v1 wrote
  // `supplier: { id: null, name: null }` for an inspection with no factory) is
  // absence, not a party.
  if (companyId === null && name === null) return null;
  return { companyId, name };
}

/**
 * Read party identity from a canonical snapshot of EITHER version.
 *
 * Write the "if v1 read buyer else read client" rule exactly ONCE — here — never
 * in a presentation component. Three console readers destructured the snapshot
 * directly before INS-055; three copies of a versioning rule is precisely the
 * drift `@inspect/shared-types` exists to prevent.
 *
 * Version dispatch reads only the signed marker, so a v2 payload carrying a
 * spoofed `buyer` key is ignored rather than preferred.
 */
export function readCanonicalParties(snapshot: unknown): CanonicalParties {
  const snap = (snapshot ?? {}) as Record<string, unknown>;
  if (canonicalVersionOf(snapshot) === 2) {
    return {
      client: partyOf(snap.client, 'companyId') ?? {
        companyId: null,
        name: null,
      },
      factory: partyOf(snap.factory, 'companyId'),
    };
  }
  return {
    client: partyOf(snap.buyer, 'id') ?? { companyId: null, name: null },
    factory: partyOf(snap.supplier, 'id'),
  };
}
