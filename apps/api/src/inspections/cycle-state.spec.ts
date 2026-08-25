import { cycleState, type CycleItem, type CyclePhotoRef } from './cycle-state';

const ITEMS: CycleItem[] = [
  { id: 'a', position: 1 },
  { id: 'b', position: 2 },
  { id: 'c', position: 3 },
];
const shot = (id: string, cycleIndex: number): CyclePhotoRef => ({
  inspectionLoopItemId: id,
  cycleIndex,
});

describe('cycleState', () => {
  it('returns an empty state and no next slot when the loop has no items', () => {
    expect(cycleState([], [])).toEqual({
      completedCycles: 0,
      partialCycles: [],
      nextSlot: null,
      totalPhotos: 0,
    });
  });

  it('points at the first item of cycle 0 when nothing has been shot', () => {
    expect(cycleState(ITEMS, [])).toEqual({
      completedCycles: 0,
      partialCycles: [],
      nextSlot: { cycleIndex: 0, itemId: 'a' },
      totalPhotos: 0,
    });
  });

  it('counts a full pass as one completed cycle and rolls to the next unit', () => {
    const photos = [shot('a', 0), shot('b', 0), shot('c', 0)];
    expect(cycleState(ITEMS, photos)).toEqual({
      completedCycles: 1,
      partialCycles: [],
      nextSlot: { cycleIndex: 1, itemId: 'a' },
      totalPhotos: 3,
    });
  });

  it('reports a partial cycle and steers the next slot at its first missing item', () => {
    const photos = [shot('a', 0), shot('c', 0)];
    expect(cycleState(ITEMS, photos)).toEqual({
      completedCycles: 0,
      partialCycles: [{ cycleIndex: 0, missingItemIds: ['b'] }],
      nextSlot: { cycleIndex: 0, itemId: 'b' },
      totalPhotos: 2,
    });
  });

  it('orders missing items by position regardless of upload order', () => {
    const photos = [shot('b', 0)];
    const state = cycleState(ITEMS, photos);
    expect(state.partialCycles[0].missingItemIds).toEqual(['a', 'c']);
    expect(state.nextSlot).toEqual({ cycleIndex: 0, itemId: 'a' });
  });

  it('finishes an earlier partial cycle before starting a new unit', () => {
    const photos = [
      shot('a', 0),
      shot('b', 0),
      shot('a', 1),
      shot('b', 1),
      shot('c', 1),
    ];
    const state = cycleState(ITEMS, photos);
    expect(state.completedCycles).toBe(1);
    expect(state.partialCycles).toEqual([
      { cycleIndex: 0, missingItemIds: ['c'] },
    ]);
    expect(state.nextSlot).toEqual({ cycleIndex: 0, itemId: 'c' });
  });

  it('allocates the next cycle above the highest existing index, so a discarded middle unit leaves no collision', () => {
    const photos = [
      shot('a', 0),
      shot('b', 0),
      shot('c', 0),
      shot('a', 2),
      shot('b', 2),
      shot('c', 2),
    ];
    const state = cycleState(ITEMS, photos);
    expect(state.completedCycles).toBe(2);
    expect(state.nextSlot).toEqual({ cycleIndex: 3, itemId: 'a' });
  });

  it('ignores photos whose item is not on this loop', () => {
    const photos = [shot('a', 0), shot('b', 0), shot('c', 0), shot('ghost', 0)];
    const state = cycleState(ITEMS, photos);
    expect(state.completedCycles).toBe(1);
    expect(state.totalPhotos).toBe(3);
  });
});
