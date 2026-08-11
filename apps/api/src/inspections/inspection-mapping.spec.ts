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

describe('buildPresetSnapshot — INS-081', () => {
  const preset: PresetLike = {
    id: 'lp_1',
    version: 3,
    items: [
      {
        position: 1,
        itemName: 'Right sleeve',
        description: null,
        referenceImageUrl: 'orgs/o/presets/a.jpg',
      },
      { position: 2, itemName: 'Neck hole', description: 'inside seam', referenceImageUrl: null },
    ],
    measurementFields: [{ label: 'Chest', unit: 'cm' }],
    allowedDefects: [
      {
        defectCatalogId: 'dc_1',
        defectCatalog: { name: 'Broken stitch', defaultSeverity: 'MAJOR' as const },
      },
    ],
  };

  it('freezes items in order with their reference image', () => {
    const snap = buildPresetSnapshot(preset);
    expect(snap.presetId).toBe('lp_1');
    expect(snap.version).toBe(3);
    expect(snap.items).toEqual([
      {
        position: 1,
        itemName: 'Right sleeve',
        description: undefined,
        referenceImageUrl: 'orgs/o/presets/a.jpg',
      },
      {
        position: 2,
        itemName: 'Neck hole',
        description: 'inside seam',
        referenceImageUrl: undefined,
      },
    ]);
  });

  it('resolves defect names and severities loop-global, not per item', () => {
    const snap = buildPresetSnapshot(preset);
    expect(snap.allowedDefects).toEqual([
      { defectCatalogId: 'dc_1', name: 'Broken stitch', severity: 'MAJOR' },
    ]);
    expect(snap.measurementFields).toEqual([{ label: 'Chest', unit: 'cm' }]);
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
