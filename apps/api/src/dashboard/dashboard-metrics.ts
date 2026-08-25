/**
 * Pure metric maths for the console KPI dashboard (INS-068).
 *
 * No NestJS, no Prisma: the DB-bound DashboardService fetches the rows and hands
 * them to these functions, so every zero-state / divide-by-zero edge is
 * unit-testable without a database (same house pattern as common/list-query.ts).
 *
 * Two deliberately different provenances:
 *   - the qaDecision rollup is EXACT and unbounded — a SQL groupBy over
 *     AqlResult backed by @@index([orgId, qaDecision]). passRate derives from
 *     it, so the headline number is a true org-wide figure, never a sample.
 *   - DPHU needs `found` (AqlResult.perClass Json) and `sampleSize`
 *     (Inspection.computedSampling Json). Neither is SQL-aggregatable, so it is
 *     computed here over a BOUNDED window — the QUALITY_SCAN_LIMIT most recent
 *     decided AQL results for the org. `truncated` tells the UI when that cap
 *     was hit. (Denormalize found/sampleSize onto AqlResult if this ever gets
 *     slow — see INS-068 refs.)
 */
import type { QaDecision } from '@inspect/shared-types';

/** How many decided AqlResult rows the Json scan is allowed to load per org. */
export const QUALITY_SCAN_LIMIT = 500;

/** The QA decision union plus PENDING — submitted, awaiting the binding call. */
export type QaDecisionKey = QaDecision | 'PENDING';

/** Every key is always present (0 by default) so the console never reads `undefined`. */
export type QaDecisionCounts = Record<QaDecisionKey, number>;

export const QA_DECISION_KEYS: readonly QaDecisionKey[] = [
  'PASS',
  'FAIL',
  'HOLD',
  'PENDING',
];

export interface QualityMetrics {
  /** Decided AQL results that actually contributed to DPHU (had a usable sampleSize). */
  decidedInspections: number;
  /** Σ sampleSize — the DPHU denominator (units actually inspected). */
  sampledUnits: number;
  /** Σ found across all defect classes — the DPHU numerator. */
  defectsFound: number;
  /** 100 × defectsFound / sampledUnits, 2dp. `null` when nothing measurable is decided yet. */
  dphu: number | null;
  /**
   * 100 × PASS / (PASS + FAIL), 1dp. `null` until a binding verdict exists.
   * HOLD is an unresolved call, not a failure, so it is excluded from the
   * denominator — it is surfaced separately in the rollup instead.
   */
  passRate: number | null;
  /** PASS + FAIL — the passRate denominator, surfaced so the tile can explain itself. */
  verdicts: number;
  /** The bounded scan hit QUALITY_SCAN_LIMIT: DPHU covers the most recent window only. */
  truncated: boolean;
}

/** One decided AQL result + its parent inspection's sampling snapshot, as stored (Json). */
export interface QualityScanRow {
  /** AqlResult.perClass — `{ critical: { found, ac, re, outcome }, major: {…}, minor: {…} }`. */
  perClass: unknown;
  /** Inspection.computedSampling — `{ sampleSizeCodeLetter, sampleSize, perClass }`. */
  computedSampling: unknown;
}

function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite, non-negative count; anything else folds to 0 rather than poisoning a sum with NaN. */
function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export function emptyQaDecisionCounts(): QaDecisionCounts {
  return { PASS: 0, FAIL: 0, HOLD: 0, PENDING: 0 };
}

/**
 * Fold a Prisma `groupBy(['qaDecision'])` result into a dense rollup. A null
 * qaDecision means "submitted, awaiting the binding QA call" → PENDING. Values
 * outside the QaDecision enum are ignored rather than leaked as ad-hoc keys.
 */
export function toQaDecisionCounts(
  rows: ReadonlyArray<{ qaDecision: string | null; count: number }>,
): QaDecisionCounts {
  const counts = emptyQaDecisionCounts();
  for (const row of rows) {
    const key: string = row.qaDecision ?? 'PENDING';
    if ((QA_DECISION_KEYS as readonly string[]).includes(key)) {
      counts[key as QaDecisionKey] += safeCount(row.count);
    }
  }
  return counts;
}

/** Σ `found` across every class present in an AqlResult.perClass Json blob. */
export function defectsFoundIn(perClass: unknown): number {
  if (!isRecord(perClass)) return 0;
  let total = 0;
  for (const entry of Object.values(perClass)) {
    if (isRecord(entry)) total += safeCount(entry.found);
  }
  return total;
}

/**
 * The sample size an inspection was actually judged on. Returns null when the
 * snapshot is missing or unusable — such a row is dropped from DPHU entirely
 * (both sides), because counting its defects with no denominator would inflate
 * the metric.
 */
export function sampleSizeIn(computedSampling: unknown): number | null {
  if (!isRecord(computedSampling)) return null;
  const n = computedSampling.sampleSize;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

export function computeQualityMetrics(
  counts: QaDecisionCounts,
  rows: ReadonlyArray<QualityScanRow>,
  scanLimit: number = QUALITY_SCAN_LIMIT,
): QualityMetrics {
  let decidedInspections = 0;
  let sampledUnits = 0;
  let defectsFound = 0;

  for (const row of rows) {
    const n = sampleSizeIn(row.computedSampling);
    if (n === null) continue;
    decidedInspections += 1;
    sampledUnits += n;
    defectsFound += defectsFoundIn(row.perClass);
  }

  const verdicts = counts.PASS + counts.FAIL;
  return {
    decidedInspections,
    sampledUnits,
    defectsFound,
    dphu:
      sampledUnits > 0 ? round((100 * defectsFound) / sampledUnits, 2) : null,
    passRate: verdicts > 0 ? round((100 * counts.PASS) / verdicts, 1) : null,
    verdicts,
    truncated: rows.length >= scanLimit,
  };
}
