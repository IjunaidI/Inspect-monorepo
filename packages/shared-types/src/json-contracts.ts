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

/** Optional GPS point stored on Supplier.gps, Photo.gps, tamperProof.gps. */
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

/** One resolved step inside Inspection.loopPresetSnapshot (immutable, spec §6). */
export interface LoopPresetSnapshotStep {
  position: number;
  zoneName: string;
  requiredShotCount: number;
  referenceImageUrls: string[];
  measurementFields: Array<{ label: string; unit?: string }>;
  /** Resolved (not just FK) so later catalog edits cannot mutate history. */
  allowedDefects: Array<{
    defectCatalogId?: string;
    name: string;
    severity: DefectSeverity;
  }>;
}

export interface LoopPresetSnapshot {
  presetId?: string;
  version?: number;
  steps: LoopPresetSnapshotStep[];
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
