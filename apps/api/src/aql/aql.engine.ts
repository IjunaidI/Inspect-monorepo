/**
 * AQL engine — ISO 2859-1 / ANSI-ASQ Z1.4 single sampling, General Level II.
 * Pure functions; no NestJS, no Prisma. Consumed by the inspection services
 * (compute sampling on create, evaluate on submit). See spec §8.
 */
import {
  ACCEPTANCE_NUMBERS,
  DEFAULT_AQL,
  LEVEL_II_LOT_RANGES,
  SAMPLE_SIZE_BY_LETTER,
} from './aql-tables';
import {
  AqlCodeLetter,
  AqlEvaluation,
  AqlPlanInput,
  ClassPlan,
  ClassResult,
  ComputedSampling,
  DefectClass,
  DefectCounts,
} from './aql.types';

export class AqlPlanNotAvailableError extends Error {
  constructor(letter: AqlCodeLetter, aql: number) {
    super(
      `AQL plan not available for code letter ${letter} at AQL ${aql}. ` +
        `Only the verified MVP band is supported; extend ACCEPTANCE_NUMBERS from ANSI/ASQ Z1.4.`,
    );
    this.name = 'AqlPlanNotAvailableError';
  }
}

/** Lot size -> sample-size code letter (Table I, Level II). */
export function codeLetterForLotSize(lotSize: number): AqlCodeLetter {
  if (!Number.isInteger(lotSize) || lotSize < 2) {
    throw new Error(`Invalid lot size ${lotSize}: must be an integer >= 2.`);
  }
  const range = LEVEL_II_LOT_RANGES.find(
    (r) => lotSize >= r.min && lotSize <= r.max,
  );
  if (!range) {
    throw new Error(`No code letter for lot size ${lotSize}.`);
  }
  return range.letter;
}

/** Code letter -> sample size n (Table II-A). */
export function sampleSizeForCodeLetter(letter: AqlCodeLetter): number {
  return SAMPLE_SIZE_BY_LETTER[letter];
}

/**
 * Resolve the single-sampling plan (Ac/Re) for one class. AQL 0 is the critical
 * special case: Ac=0, Re=1 (any defect rejects). Re = Ac + 1 otherwise.
 */
export function planFor(letter: AqlCodeLetter, aql: number): ClassPlan {
  if (aql === 0) {
    return { aql: 0, ac: 0, re: 1 };
  }
  const ac = ACCEPTANCE_NUMBERS[letter]?.[aql];
  if (ac === undefined) {
    throw new AqlPlanNotAvailableError(letter, aql);
  }
  return { aql, ac, re: ac + 1 };
}

/**
 * Compute the sampling plan for a lot: one sample size n (from lot size +
 * Level II), and a per-class Ac/Re from each class's AQL. Omitted classes use
 * the MVP defaults (critical 0, major 2.5, minor 4.0).
 */
export function computeSampling(
  lotSize: number,
  plan: AqlPlanInput,
): ComputedSampling {
  const sampleSizeCodeLetter = codeLetterForLotSize(lotSize);
  const sampleSize = sampleSizeForCodeLetter(sampleSizeCodeLetter);

  const aqls: Record<DefectClass, number> = {
    critical: plan.critical ?? DEFAULT_AQL.critical,
    major: plan.major ?? DEFAULT_AQL.major,
    minor: plan.minor ?? DEFAULT_AQL.minor,
  };

  const perClass: ComputedSampling['perClass'] = {};
  (Object.keys(aqls) as DefectClass[]).forEach((cls) => {
    perClass[cls] = planFor(sampleSizeCodeLetter, aqls[cls]);
  });

  return { sampleSizeCodeLetter, sampleSize, perClass };
}

/**
 * Evaluate defect counts against a computed sampling. A class FAILs when
 * found >= Re; the whole inspection's system recommendation is PASS only if
 * every class passes (spec §8 — pass/fail is whole-inspection, never per-loop).
 */
export function evaluateInspection(
  sampling: ComputedSampling,
  counts: DefectCounts,
): AqlEvaluation {
  const perClass: AqlEvaluation['perClass'] = {};
  let systemRecommendation: AqlEvaluation['systemRecommendation'] = 'PASS';

  (Object.keys(sampling.perClass) as DefectClass[]).forEach((cls) => {
    const plan = sampling.perClass[cls]!;
    const found = counts[cls] ?? 0;
    const outcome: ClassResult['outcome'] = found >= plan.re ? 'FAIL' : 'PASS';
    perClass[cls] = { found, ac: plan.ac, re: plan.re, outcome };
    if (outcome === 'FAIL') {
      systemRecommendation = 'FAIL';
    }
  });

  return { perClass, systemRecommendation };
}
