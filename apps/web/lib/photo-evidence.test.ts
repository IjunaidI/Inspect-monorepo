import { describe, expect, it } from 'vitest';
import { groupPhotosByUnit } from './photo-evidence';
import type { ApiInspectionLoopItem } from './api';

const photo = (id: string, itemId: string, cycleIndex: number) => ({
  id,
  storageKey: `k/${id}`,
  inspectionLoopItemId: itemId,
  cycleIndex,
  viewUrl: `https://s3/${id}`,
});

// Declared out of position order on purpose; cycle 1 was discarded (gap).
const items: ApiInspectionLoopItem[] = [
  { id: 'b', itemName: 'Back', position: 1, photos: [photo('pb0', 'b', 0), photo('pb2', 'b', 2)] },
  { id: 'f', itemName: 'Front', position: 0, photos: [photo('pf0', 'f', 0)] },
];

describe('groupPhotosByUnit', () => {
  it('walks units in cycle order and items in position order, 1-based unit numbers', () => {
    const units = groupPhotosByUnit(items);
    expect(units.map((u) => [u.cycleIndex, u.unitNumber])).toEqual([[0, 1], [2, 3]]);
    expect(units[0].slots.map((s) => s.item.itemName)).toEqual(['Front', 'Back']);
    expect(units[0].slots.map((s) => s.photo?.id)).toEqual(['pf0', 'pb0']);
  });

  it('marks a never-shot slot of a partial unit as null', () => {
    const units = groupPhotosByUnit(items);
    expect(units[1].slots.map((s) => s.photo?.id ?? null)).toEqual([null, 'pb2']);
  });

  it('yields nothing for no items or no photos', () => {
    expect(groupPhotosByUnit(undefined)).toEqual([]);
    expect(groupPhotosByUnit([{ id: 'x', itemName: 'X', position: 0, photos: [] }])).toEqual([]);
  });
});
