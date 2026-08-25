import {
  QUALITY_SCAN_LIMIT,
  computeQualityMetrics,
  defectsFoundIn,
  emptyQaDecisionCounts,
  sampleSizeIn,
  toQaDecisionCounts,
  type QualityScanRow,
} from './dashboard-metrics';

const sampling = (sampleSize: unknown) => ({
  sampleSizeCodeLetter: 'J',
  sampleSize,
  perClass: {},
});
const perClass = (
  found: Partial<Record<'critical' | 'major' | 'minor', number>>,
) =>
  Object.fromEntries(
    Object.entries(found).map(([cls, n]) => [
      cls,
      { found: n, ac: 0, re: 1, outcome: 'PASS' },
    ]),
  );

describe('toQaDecisionCounts (INS-068)', () => {
  it('always returns a dense rollup, even with no rows', () => {
    expect(toQaDecisionCounts([])).toEqual({
      PASS: 0,
      FAIL: 0,
      HOLD: 0,
      PENDING: 0,
    });
  });

  it('maps a null qaDecision to PENDING (submitted, awaiting the binding call)', () => {
    expect(
      toQaDecisionCounts([
        { qaDecision: 'PASS', count: 7 },
        { qaDecision: 'FAIL', count: 2 },
        { qaDecision: 'HOLD', count: 1 },
        { qaDecision: null, count: 4 },
      ]),
    ).toEqual({ PASS: 7, FAIL: 2, HOLD: 1, PENDING: 4 });
  });

  it('ignores values outside the QaDecision enum instead of leaking ad-hoc keys', () => {
    const counts = toQaDecisionCounts([
      { qaDecision: 'PASS', count: 3 },
      { qaDecision: 'BOGUS', count: 99 },
    ]);
    expect(counts).toEqual({ PASS: 3, FAIL: 0, HOLD: 0, PENDING: 0 });
    expect(Object.keys(counts).sort()).toEqual([
      'FAIL',
      'HOLD',
      'PASS',
      'PENDING',
    ]);
  });

  it('folds non-finite/negative counts to 0 rather than producing NaN', () => {
    expect(
      toQaDecisionCounts([
        { qaDecision: 'PASS', count: Number.NaN },
        { qaDecision: 'FAIL', count: -5 },
      ]),
    ).toEqual({ PASS: 0, FAIL: 0, HOLD: 0, PENDING: 0 });
  });
});

describe('defectsFoundIn (AqlResult.perClass Json)', () => {
  it('sums `found` across every class present', () => {
    expect(defectsFoundIn(perClass({ critical: 0, major: 3, minor: 5 }))).toBe(
      8,
    );
  });

  it('tolerates a partial plan (classes the org did not configure)', () => {
    expect(defectsFoundIn(perClass({ minor: 2 }))).toBe(2);
  });

  it('returns 0 for null/array/scalar/garbage payloads', () => {
    expect(defectsFoundIn(null)).toBe(0);
    expect(defectsFoundIn(undefined)).toBe(0);
    expect(defectsFoundIn([])).toBe(0);
    expect(defectsFoundIn('minor: 3')).toBe(0);
    expect(defectsFoundIn({ minor: { found: 'three' } })).toBe(0);
    expect(defectsFoundIn({ minor: null })).toBe(0);
  });
});

describe('sampleSizeIn (Inspection.computedSampling Json)', () => {
  it('reads a positive sampleSize', () => {
    expect(sampleSizeIn(sampling(80))).toBe(80);
  });

  it('returns null when the snapshot is missing or unusable', () => {
    expect(sampleSizeIn(null)).toBeNull();
    expect(sampleSizeIn({})).toBeNull();
    expect(sampleSizeIn(sampling(0))).toBeNull();
    expect(sampleSizeIn(sampling(-80))).toBeNull();
    expect(sampleSizeIn(sampling('80'))).toBeNull();
    expect(sampleSizeIn(sampling(Number.NaN))).toBeNull();
  });
});

describe('computeQualityMetrics (INS-068)', () => {
  it('zero-state: nothing decided yet -> nulls, never NaN or a divide-by-zero', () => {
    const metrics = computeQualityMetrics(emptyQaDecisionCounts(), []);
    expect(metrics).toEqual({
      decidedInspections: 0,
      sampledUnits: 0,
      defectsFound: 0,
      dphu: null,
      passRate: null,
      verdicts: 0,
      truncated: false,
    });
    expect(Number.isNaN(metrics.dphu as number)).toBe(false);
  });

  it('hand-computed fixture: 1 defect over 160 sampled units -> DPHU 0.63, 1 of 2 verdicts -> 50%', () => {
    const rows: QualityScanRow[] = [
      {
        perClass: perClass({ critical: 0, major: 0, minor: 1 }),
        computedSampling: sampling(80),
      },
      {
        perClass: perClass({ critical: 0, major: 0, minor: 0 }),
        computedSampling: sampling(80),
      },
    ];
    const metrics = computeQualityMetrics(
      { PASS: 1, FAIL: 1, HOLD: 0, PENDING: 0 },
      rows,
    );
    expect(metrics.sampledUnits).toBe(160);
    expect(metrics.defectsFound).toBe(1);
    expect(metrics.decidedInspections).toBe(2);
    // 100 × 1 / 160 = 0.625 → 0.63 at 2dp
    expect(metrics.dphu).toBe(0.63);
    expect(metrics.passRate).toBe(50);
    expect(metrics.verdicts).toBe(2);
  });

  it('a clean lot yields DPHU 0 — distinguishable from the "nothing decided" null', () => {
    const metrics = computeQualityMetrics(
      { PASS: 0, FAIL: 1, HOLD: 0, PENDING: 0 },
      [{ perClass: perClass({ minor: 0 }), computedSampling: sampling(80) }],
    );
    expect(metrics.dphu).toBe(0);
    expect(metrics.passRate).toBe(0);
  });

  it('excludes HOLD from the passRate denominator (unresolved, not a failure)', () => {
    const metrics = computeQualityMetrics(
      { PASS: 3, FAIL: 1, HOLD: 6, PENDING: 9 },
      [],
    );
    expect(metrics.verdicts).toBe(4);
    expect(metrics.passRate).toBe(75);
  });

  it('passRate is null while every decision is a HOLD (no binding verdict yet)', () => {
    const metrics = computeQualityMetrics(
      { PASS: 0, FAIL: 0, HOLD: 4, PENDING: 2 },
      [],
    );
    expect(metrics.passRate).toBeNull();
    expect(metrics.verdicts).toBe(0);
  });

  it('drops rows with no usable sampleSize from BOTH sides of DPHU', () => {
    const metrics = computeQualityMetrics(
      { PASS: 2, FAIL: 0, HOLD: 0, PENDING: 0 },
      [
        { perClass: perClass({ major: 4 }), computedSampling: sampling(80) },
        // legacy/garbage row: counting its defects with no denominator would inflate DPHU
        { perClass: perClass({ major: 40 }), computedSampling: null },
      ],
    );
    expect(metrics.decidedInspections).toBe(1);
    expect(metrics.sampledUnits).toBe(80);
    expect(metrics.defectsFound).toBe(4);
    expect(metrics.dphu).toBe(5);
  });

  it('rounds DPHU to 2dp and passRate to 1dp', () => {
    const metrics = computeQualityMetrics(
      { PASS: 2, FAIL: 1, HOLD: 0, PENDING: 0 },
      [{ perClass: perClass({ minor: 1 }), computedSampling: sampling(3) }],
    );
    // 100 × 1 / 3 = 33.333… → 33.33 ; 100 × 2 / 3 = 66.666… → 66.7
    expect(metrics.dphu).toBe(33.33);
    expect(metrics.passRate).toBe(66.7);
  });

  it('flags truncation when the bounded scan hits its cap', () => {
    const row: QualityScanRow = {
      perClass: perClass({ minor: 1 }),
      computedSampling: sampling(10),
    };
    expect(
      computeQualityMetrics(emptyQaDecisionCounts(), [row, row], 3).truncated,
    ).toBe(false);
    expect(
      computeQualityMetrics(emptyQaDecisionCounts(), [row, row, row], 3)
        .truncated,
    ).toBe(true);
    expect(QUALITY_SCAN_LIMIT).toBe(500);
  });
});
