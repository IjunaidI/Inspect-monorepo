/**
 * ISO 2859-1 / ANSI-ASQ Z1.4 lookup data (General Inspection Level II, single
 * sampling, normal severity). See docs/done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md for provenance.
 *
 * The acceptance grid below is the VERIFIED MVP band, derived from the canonical
 * code-letter-L (n=200) column and Z1.4's diagonal-repetition structure. Cells
 * not present are intentionally unsupported — `planFor` throws rather than guess.
 * Extending the grid requires authoritative ANSI/ASQ Z1.4 values (and arrow-rule
 * handling for small/large sample sizes).
 */
import { AqlCodeLetter } from './aql.types';

export interface LotRange {
  min: number;
  max: number;
  letter: AqlCodeLetter;
}

/** Table I — sample-size code letters for General Inspection Level II. */
export const LEVEL_II_LOT_RANGES: readonly LotRange[] = [
  { min: 2, max: 8, letter: 'A' },
  { min: 9, max: 15, letter: 'B' },
  { min: 16, max: 25, letter: 'C' },
  { min: 26, max: 50, letter: 'D' },
  { min: 51, max: 90, letter: 'E' },
  { min: 91, max: 150, letter: 'F' },
  { min: 151, max: 280, letter: 'G' },
  { min: 281, max: 500, letter: 'H' },
  { min: 501, max: 1200, letter: 'J' },
  { min: 1201, max: 3200, letter: 'K' },
  { min: 3201, max: 10000, letter: 'L' },
  { min: 10001, max: 35000, letter: 'M' },
  { min: 35001, max: 150000, letter: 'N' },
  { min: 150001, max: 500000, letter: 'P' },
  { min: 500001, max: Number.POSITIVE_INFINITY, letter: 'Q' },
];

/** Table II-A — sample size by code letter. */
export const SAMPLE_SIZE_BY_LETTER: Readonly<Record<AqlCodeLetter, number>> = {
  A: 2,
  B: 3,
  C: 5,
  D: 8,
  E: 13,
  F: 20,
  G: 32,
  H: 50,
  J: 80,
  K: 125,
  L: 200,
  M: 315,
  N: 500,
  P: 800,
  Q: 1250,
  R: 2000,
};

/**
 * Acceptance numbers (Ac) for single sampling, normal inspection; Re = Ac + 1.
 * Keyed [code letter][AQL]. (Note: AQL keys 1.0 and 4.0 stringify to "1"/"4".)
 */
export const ACCEPTANCE_NUMBERS: Readonly<
  Partial<Record<AqlCodeLetter, Readonly<Record<number, number>>>>
> = {
  G: { 2.5: 2, 4: 3, 6.5: 5 },
  H: { 1.5: 2, 2.5: 3, 4: 5, 6.5: 7 },
  J: { 1: 2, 1.5: 3, 2.5: 5, 4: 7, 6.5: 10 },
  K: { 1: 3, 1.5: 5, 2.5: 7, 4: 10, 6.5: 14 },
  L: { 1: 5, 1.5: 7, 2.5: 10, 4: 14, 6.5: 21 },
  M: { 1: 7, 1.5: 10, 2.5: 14 },
  N: { 1: 10, 1.5: 14, 2.5: 21 },
};

/** MVP default per-class AQLs (spec §8). Critical 0 => any critical defect rejects. */
export const DEFAULT_AQL = { critical: 0, major: 2.5, minor: 4.0 } as const;
