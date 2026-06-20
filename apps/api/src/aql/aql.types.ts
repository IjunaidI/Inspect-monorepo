/**
 * Types for the AQL engine (ISO 2859-1 / ANSI-ASQ Z1.4 single sampling).
 * Pure domain — no NestJS, no Prisma. See docs/done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md.
 */

export type DefectClass = 'critical' | 'major' | 'minor';

export type AqlCodeLetter =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'P'
  | 'Q'
  | 'R';

/**
 * Per-class AQL inputs (the QA-configured plan). A value of 0 means "any defect
 * rejects" (Ac=0) — the spec default for the critical class. Omitted classes use
 * the MVP defaults: critical 0, major 2.5, minor 4.0.
 */
export interface AqlPlanInput {
  critical?: number;
  major?: number;
  minor?: number;
}

/** A resolved single-sampling plan for one class at the lot's sample size. */
export interface ClassPlan {
  aql: number;
  ac: number;
  re: number;
}

/** The computed sampling, snapshotted onto an Inspection (spec §5/§8). */
export interface ComputedSampling {
  sampleSizeCodeLetter: AqlCodeLetter;
  sampleSize: number;
  perClass: Partial<Record<DefectClass, ClassPlan>>;
}

export type ClassOutcome = 'PASS' | 'FAIL';

export interface ClassResult {
  found: number;
  ac: number;
  re: number;
  outcome: ClassOutcome;
}

export interface AqlEvaluation {
  perClass: Partial<Record<DefectClass, ClassResult>>;
  systemRecommendation: ClassOutcome;
}

/** Defect counts found in the sample, per class. */
export type DefectCounts = Partial<Record<DefectClass, number>>;
