import { describe, expect, it } from 'vitest';
import { CAPTURE_POINT_CATEGORIES } from '@inspect/shared-types';
import {
  CAPTURE_POINT_CATEGORY_ICONS,
  CAPTURE_POINT_CATEGORY_LABELS,
  CAPTURE_POINT_CATEGORY_ORDER,
  LOOP_TEMPLATES,
  draftItemFromCapturePoint,
  groupCapturePoints,
  iconForCapturePoint,
  isInLoop,
  moveItem,
  resolveTemplate,
  type CapturePointLike,
} from './capture-points';

const cp = (
  id: string,
  name: string,
  category: CapturePointLike['category'],
  scope: CapturePointLike['scope'] = 'GLOBAL',
  iconKey: string | null = null,
): CapturePointLike => ({ id, name, category, scope, iconKey });

const LIB = [
  cp('g-hem', 'Hem', 'TOP'),
  cp('g-collar', 'Collar & neckline', 'TOP'),
  cp('o-tape', 'Hem tape close-up', 'TOP', 'ORG', 'hem'),
  cp('g-front', 'Front flat-lay', 'OVERALL'),
  cp('g-polybag', 'Polybag', 'PACKAGING'),
  cp('g-label', 'Main label', 'LABELS_TRIMS'),
];

describe('category tables', () => {
  it('cover every wire category exactly once, in a fixed order', () => {
    expect([...CAPTURE_POINT_CATEGORY_ORDER].sort()).toEqual(
      [...CAPTURE_POINT_CATEGORIES].sort(),
    );
    expect(CAPTURE_POINT_CATEGORY_ORDER[0]).toBe('OVERALL');
    expect(CAPTURE_POINT_CATEGORY_ORDER.at(-1)).toBe('OTHER');
    for (const c of CAPTURE_POINT_CATEGORIES) {
      expect(CAPTURE_POINT_CATEGORY_LABELS[c]).toBeTruthy();
      expect(CAPTURE_POINT_CATEGORY_ICONS[c]).toBeTruthy();
    }
  });
});

describe('groupCapturePoints', () => {
  it('groups in category order, drops empty groups, org rows first then by name', () => {
    const groups = groupCapturePoints(LIB);
    expect(groups.map((g) => g.category)).toEqual([
      'OVERALL',
      'TOP',
      'LABELS_TRIMS',
      'PACKAGING',
    ]);
    expect(groups[1].label).toBe('Tops');
    expect(groups[1].points.map((p) => p.id)).toEqual([
      'o-tape',
      'g-collar',
      'g-hem',
    ]);
  });

  it('returns nothing for an empty library', () => {
    expect(groupCapturePoints([])).toEqual([]);
  });
});

describe('iconForCapturePoint', () => {
  it('prefers the row icon and falls back to the category icon', () => {
    expect(iconForCapturePoint({ category: 'TOP', iconKey: 'hem' })).toBe(
      'hem',
    );
    expect(iconForCapturePoint({ category: 'TOP', iconKey: null })).toBe(
      CAPTURE_POINT_CATEGORY_ICONS.TOP,
    );
    expect(iconForCapturePoint({ category: 'PACKAGING', iconKey: '' })).toBe(
      'boxOutline',
    );
  });
});

describe('isInLoop', () => {
  it('matches by lineage id, then by folded name for legacy free-text items', () => {
    const items = [
      { itemName: 'Collar & neckline', capturePointId: 'g-collar' },
      { itemName: '  right SLEEVE ', capturePointId: null },
    ];
    expect(isInLoop(items, { id: 'g-collar', name: 'Renamed later' })).toBe(
      true,
    );
    expect(isInLoop(items, { id: 'g-sleeve-r', name: 'Right sleeve' })).toBe(
      true,
    );
    expect(isInLoop(items, { id: 'g-hem', name: 'Hem' })).toBe(false);
  });
});

describe('draftItemFromCapturePoint', () => {
  it('copies name + description and keeps the lineage; the image only when present', () => {
    expect(
      draftItemFromCapturePoint({
        ...cp('g-hem', 'Hem', 'TOP'),
        description: 'Flat across the width',
      }),
    ).toEqual({
      itemName: 'Hem',
      description: 'Flat across the width',
      capturePointId: 'g-hem',
    });
    expect(
      draftItemFromCapturePoint({
        ...cp('o-1', 'Custom', 'OTHER', 'ORG'),
        referenceImageUrl: 'orgs/o/presets/x.jpg',
      }),
    ).toMatchObject({
      referenceImageUrl: 'orgs/o/presets/x.jpg',
      description: '',
    });
  });
});

describe('moveItem', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('moves an element to a new index without mutating', () => {
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(list, 2, 1)).toEqual(['a', 'c', 'b', 'd']); // "move up"
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns the same array for a no-op or an out-of-range index', () => {
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, -1, 2)).toBe(list);
    expect(moveItem(list, 0, 4)).toBe(list);
    expect(moveItem([], 0, 0)).toEqual([]);
  });
});

describe('LOOP_TEMPLATES + resolveTemplate', () => {
  it('templates have unique keys and non-empty ordered names', () => {
    expect(new Set(LOOP_TEMPLATES.map((t) => t.key)).size).toBe(
      LOOP_TEMPLATES.length,
    );
    for (const t of LOOP_TEMPLATES) {
      expect(t.pointNames.length).toBeGreaterThanOrEqual(8);
      expect(new Set(t.pointNames).size).toBe(t.pointNames.length);
    }
  });

  it('resolves names in template order, skips names the library lacks, prefers the GLOBAL row', () => {
    const lib = [
      ...LIB,
      cp('o-hem-dup', 'hem', 'TOP', 'ORG'), // an org row shadowing a global name
    ];
    const t = LOOP_TEMPLATES.find((x) => x.key === 'tops-12')!;
    const out = resolveTemplate(t, lib);
    expect(out.map((p) => p.id)).toEqual([
      'g-front',
      'g-collar',
      'g-hem',
      'g-label',
    ]);
  });
});
