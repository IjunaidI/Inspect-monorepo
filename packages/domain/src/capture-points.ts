import type { CapturePointCategory, CatalogScope } from '@inspect/shared-types';

/**
 * Capture-point library rules (INS-097) — shared by the web builder and the
 * mobile builder so "how is the library grouped", "is this point already in
 * the loop" and "what does a template expand to" cannot drift between them.
 * Pure: no I/O, no React.
 */

/** Fixed chooser order — the order an inspector walks a garment, not alphabetical. */
export const CAPTURE_POINT_CATEGORY_ORDER: readonly CapturePointCategory[] = [
  'OVERALL',
  'TOP',
  'BOTTOM',
  'LABELS_TRIMS',
  'PACKAGING',
  'TEST',
  'OTHER',
];

export const CAPTURE_POINT_CATEGORY_LABELS: Readonly<
  Record<CapturePointCategory, string>
> = {
  OVERALL: 'Overall',
  TOP: 'Tops',
  BOTTOM: 'Bottoms',
  LABELS_TRIMS: 'Labels & trims',
  PACKAGING: 'Packaging',
  TEST: 'Tests',
  OTHER: 'Other',
};

/**
 * Default icon per category — an `IconName` from @inspect/design-tokens, kept
 * as a plain string here so `@inspect/domain` stays free of the token package.
 */
export const CAPTURE_POINT_CATEGORY_ICONS: Readonly<
  Record<CapturePointCategory, string>
> = {
  OVERALL: 'tshirtOutline',
  TOP: 'hangerOutline',
  BOTTOM: 'waistband',
  LABELS_TRIMS: 'tagOutline',
  PACKAGING: 'boxOutline',
  TEST: 'testTube',
  OTHER: 'camera',
};

export interface CapturePointLike {
  id: string;
  name: string;
  category: CapturePointCategory;
  scope: CatalogScope;
  iconKey?: string | null;
}

export interface LoopItemLike {
  itemName: string;
  capturePointId?: string | null;
}

export interface CapturePointGroup<T extends CapturePointLike> {
  category: CapturePointCategory;
  label: string;
  points: T[];
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

/**
 * Group library rows for the chooser: fixed category order, empty groups
 * dropped, the org's own rows before the global ones, then by name.
 */
export function groupCapturePoints<T extends CapturePointLike>(
  points: readonly T[],
): CapturePointGroup<T>[] {
  const out: CapturePointGroup<T>[] = [];
  for (const category of CAPTURE_POINT_CATEGORY_ORDER) {
    const rows = points
      .filter((p) => p.category === category)
      .sort((a, b) => {
        if (a.scope !== b.scope) return a.scope === 'ORG' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    if (rows.length > 0) {
      out.push({
        category,
        label: CAPTURE_POINT_CATEGORY_LABELS[category],
        points: rows,
      });
    }
  }
  return out;
}

/** The icon for a row: its own `iconKey`, else the category default. */
export function iconForCapturePoint(
  p: Pick<CapturePointLike, 'category' | 'iconKey'>,
): string {
  return p.iconKey && p.iconKey.length > 0
    ? p.iconKey
    : CAPTURE_POINT_CATEGORY_ICONS[p.category];
}

/**
 * Is this library point already in the draft loop? By lineage id first, then
 * by folded name so a legacy free-text item ("right sleeve") still matches.
 */
export function isInLoop(
  items: readonly LoopItemLike[],
  point: Pick<CapturePointLike, 'id' | 'name'>,
): boolean {
  const target = fold(point.name);
  return items.some(
    (it) =>
      (it.capturePointId != null && it.capturePointId === point.id) ||
      fold(it.itemName) === target,
  );
}

/** The ONE way both builders turn a library row into a draft loop item. */
export function draftItemFromCapturePoint(
  p: CapturePointLike & {
    description?: string | null;
    referenceImageUrl?: string | null;
  },
): {
  itemName: string;
  description: string;
  capturePointId: string;
  referenceImageUrl?: string;
} {
  return {
    itemName: p.name,
    description: p.description ?? '',
    capturePointId: p.id,
    ...(p.referenceImageUrl ? { referenceImageUrl: p.referenceImageUrl } : {}),
  };
}

/**
 * Pure reorder: the element at `from` lands at `to`, everything else shifts.
 * Out-of-range or no-op indices return the SAME array. Never mutates —
 * `moveItem(list, i, i - 1)` is "move up", the drag handler passes both.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return list as T[];
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export interface LoopTemplate {
  key: string;
  label: string;
  category: CapturePointCategory;
  /** Names of GLOBAL library rows, in shot order. Pinned against the seed by a spec. */
  pointNames: readonly string[];
}

/** Starter loops as pure data — names reference the seeded GLOBAL library. */
export const LOOP_TEMPLATES: readonly LoopTemplate[] = [
  {
    key: 'tops-12',
    label: 'Tops standard · 12 shots',
    category: 'TOP',
    pointNames: [
      'Front flat-lay',
      'Back flat-lay',
      'Collar & neckline',
      'Neck hole inside',
      'Left sleeve',
      'Right sleeve',
      'Left cuff',
      'Right cuff',
      'Hem',
      'Side seam',
      'Main label',
      'Care label',
    ],
  },
  {
    key: 'bottoms-12',
    label: 'Bottoms standard · 12 shots',
    category: 'BOTTOM',
    pointNames: [
      'Front flat-lay',
      'Back flat-lay',
      'Waistband',
      'Fly / zipper top',
      'Zipper open',
      'Front left pocket',
      'Front right pocket',
      'Back left pocket',
      'Crotch seam',
      'Inseam',
      'Leg hem',
      'Main label',
    ],
  },
  {
    key: 'labels-packaging-8',
    label: 'Labels & packaging · 8 shots',
    category: 'PACKAGING',
    pointNames: [
      'Main label',
      'Size label',
      'Care label',
      'Hangtag front',
      'Barcode sticker',
      'Polybag',
      'Folded presentation',
      'Carton label',
    ],
  },
];

/**
 * Resolve a template's names against the loaded library (folded match),
 * preserving template order and skipping names the library lacks.
 */
export function resolveTemplate<T extends CapturePointLike>(
  template: LoopTemplate,
  library: readonly T[],
): T[] {
  const byName = new Map<string, T>();
  for (const p of library) {
    const key = fold(p.name);
    // A GLOBAL row wins over an org row of the same name — templates name the seed.
    const cur = byName.get(key);
    if (!cur || (cur.scope === 'ORG' && p.scope === 'GLOBAL'))
      byName.set(key, p);
  }
  const out: T[] = [];
  for (const name of template.pointNames) {
    const hit = byName.get(fold(name));
    if (hit) out.push(hit);
  }
  return out;
}
