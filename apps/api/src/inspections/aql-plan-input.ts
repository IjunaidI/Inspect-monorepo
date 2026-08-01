/**
 * INS-063 — per-class AQL configuration input (pure; no NestJS, no Prisma).
 *
 * The knob QA gets is the per-class AQL VALUE. The general inspection LEVEL stays
 * locked to II: only `LEVEL_II_LOT_RANGES` is verified, and other levels need
 * authoritative new ANSI/ASQ Z1.4 tables (see aql-tables.ts).
 *
 * The allowed values are DERIVED from the verified acceptance grid itself rather
 * than hardcoded, so the API can never accept an AQL the engine has no
 * authoritative Ac/Re column for — and the set widens automatically (and only)
 * when the grid is extended with real Z1.4 data.
 */
import { ACCEPTANCE_NUMBERS, DEFAULT_AQL } from '../aql/aql-tables';
import { AqlPlanInput, DefectClass } from '../aql/aql.types';

export const AQL_CLASSES: readonly DefectClass[] = ['critical', 'major', 'minor'];

/** Raw per-class input as it arrives off the wire (JSON body / query string). */
export type RawAqlPlanInput = Partial<Record<DefectClass, unknown>>;

/**
 * 0 ("any defect rejects" — the critical special case in `planFor`) plus every
 * AQL column present in the verified band: {1.0, 1.5, 2.5, 4.0, 6.5}.
 */
export const ALLOWED_AQL_VALUES: readonly number[] = [
  ...new Set<number>([
    0,
    ...Object.values(ACCEPTANCE_NUMBERS).flatMap((row) =>
      Object.keys(row ?? {}).map((k) => Number(k)),
    ),
  ]),
].sort((a, b) => a - b);

/** "0, 1.0, 1.5, 2.5, 4.0, 6.5" — for error messages the UI can show verbatim. */
export function formatAllowedAqlValues(): string {
  return ALLOWED_AQL_VALUES.map((v) => (v !== 0 && Number.isInteger(v) ? v.toFixed(1) : String(v))).join(', ');
}

/** Thrown for an out-of-band AQL value; the service maps it to a 400. */
export class InvalidAqlPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAqlPlanError';
  }
}

/**
 * Validate the caller's per-class AQLs and resolve the omitted ones to the MVP
 * defaults (critical 0, major 2.5, minor 4.0).
 *
 * The result is what gets FROZEN onto the inspection (`Inspection.aqlPlan`), so
 * the plan is explicit and self-describing: re-deriving the sampling at submit
 * can never drift because a code-level default changed after creation.
 */
export function resolveAqlPlan(input?: RawAqlPlanInput | AqlPlanInput | null): Required<AqlPlanInput> {
  const resolved: Required<AqlPlanInput> = { ...DEFAULT_AQL };
  if (!input) return resolved;
  for (const cls of AQL_CLASSES) {
    const raw: unknown = (input as RawAqlPlanInput)[cls];
    if (raw === undefined || raw === null) continue;
    // Numeric strings are accepted (query params), but "" / whitespace / junk is
    // NOT: Number('') is 0, which would silently mean "any defect rejects".
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : Number.NaN;
    if (!Number.isFinite(value) || !ALLOWED_AQL_VALUES.includes(value)) {
      throw new InvalidAqlPlanError(
        `aqlPlan.${cls} must be one of ${formatAllowedAqlValues()} (got ${JSON.stringify(raw)})`,
      );
    }
    resolved[cls] = value;
  }
  return resolved;
}
