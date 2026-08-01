import {
  billableKindFor,
  buildPresetSnapshot,
  qaDecisionToStatus,
  toDefectCounts,
  PresetLike,
} from './inspection-mapping';

describe('toDefectCounts', () => {
  it('folds severity rows into critical/major/minor', () => {
    expect(
      toDefectCounts([
        { severity: 'MAJOR', count: 3 },
        { severity: 'CRITICAL', count: 1 },
      ]),
    ).toEqual({ critical: 1, major: 3, minor: 0 });
  });

  it('defaults all classes to zero', () => {
    expect(toDefectCounts([])).toEqual({ critical: 0, major: 0, minor: 0 });
  });
});

describe('buildPresetSnapshot', () => {
  it('resolves defect names + severities (not just FKs) for immutability', () => {
    const preset: PresetLike = {
      id: 'p1',
      version: 2,
      steps: [
        {
          position: 1,
          zoneName: 'Collar',
          referenceImageUrls: ['u1'],
          requiredShotCount: 2,
          measurementFields: [{ label: 'Collar length', unit: 'cm' }],
          allowedDefects: [
            { defectCatalogId: 'd1', defectCatalog: { name: 'Skipped stitches', defaultSeverity: 'MAJOR' } },
          ],
        },
      ],
    };
    const snap = buildPresetSnapshot(preset);
    expect(snap.presetId).toBe('p1');
    expect(snap.version).toBe(2);
    expect(snap.steps[0].allowedDefects[0]).toEqual({
      defectCatalogId: 'd1',
      name: 'Skipped stitches',
      severity: 'MAJOR',
    });
    expect(snap.steps[0].measurementFields[0]).toEqual({ label: 'Collar length', unit: 'cm' });
  });
});

describe('billableKindFor (INS-018)', () => {
  it('bills RE_INSPECTION only when the inspection actually supersedes another', () => {
    expect(billableKindFor('insp-original')).toBe('RE_INSPECTION');
  });

  it.each([[null], [undefined], ['']])('bills INSPECTION when the linkage is %p', (linkage) => {
    expect(billableKindFor(linkage as string | null | undefined)).toBe('INSPECTION');
  });
});

describe('qaDecisionToStatus', () => {
  it.each([
    ['PASS', 'APPROVED'],
    ['FAIL', 'REJECTED'],
    ['HOLD', 'HOLD'],
  ] as const)('%s -> %s', (decision, status) => {
    expect(qaDecisionToStatus(decision)).toBe(status);
  });
});
