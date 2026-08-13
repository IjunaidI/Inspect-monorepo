/**
 * INS-081 — the cycle-completeness rule, as a pure function.
 *
 * A "cycle" (a unit) is one pass over every loop item. It has no row of its
 * own: it exists because evidence carries its index. This helper is the single
 * definition of "is that pass complete", shared by the submit guard and the
 * populate console — a divergence between the two is precisely how a
 * half-photographed unit would reach a signed report.
 *
 * cycleIndex values may be non-contiguous: discarding a middle unit leaves a
 * gap, and a new cycle is allocated ABOVE the highest existing index rather
 * than filling the hole, so it can never collide with the surviving rows'
 * @@unique([inspectionLoopItemId, cycleIndex]).
 */

export interface CycleItem {
  id: string;
  position: number;
}

export interface CyclePhotoRef {
  inspectionLoopItemId: string;
  cycleIndex: number;
}

export interface PartialCycle {
  cycleIndex: number;
  /** Ordered by item position — the order the operator will be walked through. */
  missingItemIds: string[];
}

export interface NextSlot {
  cycleIndex: number;
  itemId: string;
}

export interface CycleState {
  completedCycles: number;
  /** Every cycle missing at least one item, ascending. Empty means submittable. */
  partialCycles: PartialCycle[];
  /** Where the guided flow should send the operator next; null only when the loop has no items. */
  nextSlot: NextSlot | null;
  totalPhotos: number;
}

export function cycleState(items: CycleItem[], photos: CyclePhotoRef[]): CycleState {
  const ordered = [...items].sort((a, b) => a.position - b.position);
  const itemIds = new Set(ordered.map((i) => i.id));

  // Photos for items that are not on this loop cannot complete a cycle and must
  // not inflate the counts.
  const relevant = photos.filter((p) => itemIds.has(p.inspectionLoopItemId));

  const shotByCycle = new Map<number, Set<string>>();
  for (const photo of relevant) {
    const set = shotByCycle.get(photo.cycleIndex) ?? new Set<string>();
    set.add(photo.inspectionLoopItemId);
    shotByCycle.set(photo.cycleIndex, set);
  }

  const cycleIndexes = [...shotByCycle.keys()].sort((a, b) => a - b);
  const partialCycles: PartialCycle[] = [];
  let completedCycles = 0;

  for (const cycleIndex of cycleIndexes) {
    const shot = shotByCycle.get(cycleIndex)!;
    const missingItemIds = ordered.filter((i) => !shot.has(i.id)).map((i) => i.id);
    if (missingItemIds.length === 0) completedCycles += 1;
    else partialCycles.push({ cycleIndex, missingItemIds });
  }

  let nextSlot: NextSlot | null = null;
  if (ordered.length > 0) {
    if (partialCycles.length > 0) {
      const first = partialCycles[0];
      nextSlot = { cycleIndex: first.cycleIndex, itemId: first.missingItemIds[0] };
    } else {
      const nextIndex = cycleIndexes.length === 0 ? 0 : Math.max(...cycleIndexes) + 1;
      nextSlot = { cycleIndex: nextIndex, itemId: ordered[0].id };
    }
  }

  return { completedCycles, partialCycles, nextSlot, totalPhotos: relevant.length };
}
