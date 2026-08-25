import {
  codeLetterForLotSize,
  sampleSizeForCodeLetter,
  planFor,
  computeSampling,
  evaluateInspection,
  AqlPlanNotAvailableError,
} from './aql.engine';

describe('codeLetterForLotSize (General Inspection Level II)', () => {
  it.each([
    [2, 'A'],
    [8, 'A'],
    [9, 'B'],
    [50, 'D'],
    [151, 'G'],
    [280, 'G'],
    [281, 'H'], // spec §8 example
    [500, 'H'],
    [501, 'J'], // spec §8 example
    [1200, 'J'],
    [1201, 'K'], // spec §8 example
    [3200, 'K'],
    [3201, 'L'],
    [500000, 'P'],
    [500001, 'Q'],
  ] as const)('lot %i -> %s', (lot, letter) => {
    expect(codeLetterForLotSize(lot)).toBe(letter);
  });

  it('rejects a lot size below 2', () => {
    expect(() => codeLetterForLotSize(1)).toThrow();
  });
});

describe('sampleSizeForCodeLetter', () => {
  it.each([
    ['G', 32],
    ['H', 50],
    ['J', 80],
    ['K', 125],
    ['L', 200],
    ['M', 315],
    ['N', 500],
  ] as const)('%s -> %i', (letter, n) => {
    expect(sampleSizeForCodeLetter(letter)).toBe(n);
  });
});

describe('planFor (Ac/Re; single sampling normal; Re = Ac + 1)', () => {
  // Canonical garment-QC anchor: code letter L (n=200).
  it('L @ 1.0 -> Ac 5 / Re 6', () =>
    expect(planFor('L', 1.0)).toEqual({ aql: 1.0, ac: 5, re: 6 }));
  it('L @ 1.5 -> Ac 7 / Re 8', () =>
    expect(planFor('L', 1.5)).toEqual({ aql: 1.5, ac: 7, re: 8 }));
  it('L @ 2.5 -> Ac 10 / Re 11', () =>
    expect(planFor('L', 2.5)).toEqual({ aql: 2.5, ac: 10, re: 11 }));
  it('L @ 4.0 -> Ac 14 / Re 15', () =>
    expect(planFor('L', 4.0)).toEqual({ aql: 4.0, ac: 14, re: 15 }));
  it('L @ 6.5 -> Ac 21 / Re 22', () =>
    expect(planFor('L', 6.5)).toEqual({ aql: 6.5, ac: 21, re: 22 }));

  it('H @ 2.5 -> Ac 3 / Re 4', () =>
    expect(planFor('H', 2.5)).toEqual({ aql: 2.5, ac: 3, re: 4 }));
  it('J @ 2.5 -> Ac 5 / Re 6', () =>
    expect(planFor('J', 2.5)).toEqual({ aql: 2.5, ac: 5, re: 6 }));
  it('K @ 2.5 -> Ac 7 / Re 8', () =>
    expect(planFor('K', 2.5)).toEqual({ aql: 2.5, ac: 7, re: 8 }));

  it('critical AQL 0 -> Ac 0 / Re 1 (any defect rejects), independent of letter', () => {
    expect(planFor('H', 0)).toEqual({ aql: 0, ac: 0, re: 1 });
    expect(planFor('N', 0)).toEqual({ aql: 0, ac: 0, re: 1 });
  });

  it('throws AqlPlanNotAvailableError for cells outside the verified grid', () => {
    expect(() => planFor('G', 1.0)).toThrow(AqlPlanNotAvailableError);
    expect(() => planFor('H', 9.9)).toThrow(/not available/i);
  });
});

describe('computeSampling', () => {
  it('computes Level II sampling for lot 1000 with default plan', () => {
    const s = computeSampling(1000, {});
    expect(s.sampleSizeCodeLetter).toBe('J');
    expect(s.sampleSize).toBe(80);
    expect(s.perClass.critical).toEqual({ aql: 0, ac: 0, re: 1 });
    expect(s.perClass.major).toEqual({ aql: 2.5, ac: 5, re: 6 });
    expect(s.perClass.minor).toEqual({ aql: 4.0, ac: 7, re: 8 });
  });

  it('honors explicit per-class AQLs', () => {
    const s = computeSampling(3201, { major: 1.5, minor: 2.5 }); // letter L
    expect(s.sampleSizeCodeLetter).toBe('L');
    expect(s.perClass.major).toEqual({ aql: 1.5, ac: 7, re: 8 });
    expect(s.perClass.minor).toEqual({ aql: 2.5, ac: 10, re: 11 });
  });
});

describe('evaluateInspection (whole-inspection pass/fail; spec §8)', () => {
  const sampling = computeSampling(1000, {}); // J/80: critical 0/1, major 5/6, minor 7/8

  it('PASSes when every class is below its Re', () => {
    const e = evaluateInspection(sampling, { critical: 0, major: 5, minor: 7 });
    expect(e.perClass.major!.outcome).toBe('PASS');
    expect(e.perClass.minor!.outcome).toBe('PASS');
    expect(e.systemRecommendation).toBe('PASS');
  });

  it('FAILs the whole lot when a single class reaches Re (found >= Re)', () => {
    const e = evaluateInspection(sampling, { critical: 0, major: 6, minor: 0 });
    expect(e.perClass.major!.outcome).toBe('FAIL');
    expect(e.systemRecommendation).toBe('FAIL');
  });

  it('one critical defect FAILs the lot (Ac 0)', () => {
    const e = evaluateInspection(sampling, { critical: 1, major: 0, minor: 0 });
    expect(e.perClass.critical!.outcome).toBe('FAIL');
    expect(e.systemRecommendation).toBe('FAIL');
  });

  it('treats missing counts as zero', () => {
    const e = evaluateInspection(sampling, {});
    expect(e.systemRecommendation).toBe('PASS');
  });
});
