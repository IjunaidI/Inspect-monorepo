import type { ApiInspectionLoopItem, ApiPhoto } from './api';

export interface EvidenceSlot {
  item: ApiInspectionLoopItem;
  /** null = this slot of the unit was never shot (a partial cycle). */
  photo: ApiPhoto | null;
}

export interface EvidenceUnit {
  /** 0-based, as stored. May have gaps after a discard (INS-081). */
  cycleIndex: number;
  /** 1-based, as rendered: "Unit 3". */
  unitNumber: number;
  slots: EvidenceSlot[];
}

/**
 * INS-092: the review page's evidence walk — units in cycle order, and inside
 * a unit the loop items in position order, so the QA Manager reads the photos
 * in the sequence the inspector shot them. Pure; the shape is exactly what
 * GET /inspections/:id already returns (`items[].photos[]`), so no extra call.
 */
export function groupPhotosByUnit(items: readonly ApiInspectionLoopItem[] | undefined): EvidenceUnit[] {
  if (!items || items.length === 0) return [];
  const ordered = [...items].sort((a, b) => a.position - b.position);
  const cycles = new Set<number>();
  for (const it of ordered) for (const p of it.photos ?? []) cycles.add(p.cycleIndex);
  return [...cycles]
    .sort((a, b) => a - b)
    .map((cycleIndex) => ({
      cycleIndex,
      unitNumber: cycleIndex + 1,
      slots: ordered.map((item) => ({
        item,
        photo: (item.photos ?? []).find((p) => p.cycleIndex === cycleIndex) ?? null,
      })),
    }));
}
