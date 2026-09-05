import type { ApiLoopPreset } from './api';

/**
 * INS-092 (INS-076 residue): a preset family is its NAME — the API auto-versions
 * per name (`@@unique([orgId, name, version])`), so "edit" means "save as the
 * next version" and every version stays listed by GET /loop-presets. A picker
 * that shows all of them makes the user choose between "Knit top v1" and
 * "Knit top v3" when only the newest is what anyone means.
 *
 * Returns one row per name — the highest version — preserving the API's order
 * of first appearance. `keep` pins extra ids that must stay visible even when
 * superseded: a company's `defaultLoopPresetId` points at a specific version,
 * and that selection must still render and submit.
 */
export function latestPresetPerName<T extends Pick<ApiLoopPreset, 'id' | 'name' | 'version'>>(
  presets: readonly T[],
  keep: readonly string[] = [],
): T[] {
  const latest = new Map<string, T>();
  for (const p of presets) {
    const cur = latest.get(p.name);
    if (!cur || p.version > cur.version) latest.set(p.name, p);
  }
  const out = presets.filter((p) => latest.get(p.name) === p);
  const shown = new Set(out.map((p) => p.id));
  for (const id of keep) {
    if (shown.has(id)) continue;
    const pinned = presets.find((p) => p.id === id);
    if (pinned) {
      out.push(pinned);
      shown.add(id);
    }
  }
  return out;
}
