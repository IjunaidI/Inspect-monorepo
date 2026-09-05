import { describe, expect, it } from 'vitest';
import { latestPresetPerName } from './presets';

const p = (id: string, name: string, version: number) => ({ id, name, version, isArchived: false });

// API order: name asc, version desc.
const all = [p('k3', 'Knit top', 3), p('k2', 'Knit top', 2), p('k1', 'Knit top', 1), p('w1', 'Woven shirt', 1)];

describe('latestPresetPerName', () => {
  it('keeps one row per name — the highest version — in API order', () => {
    expect(latestPresetPerName(all).map((x) => x.id)).toEqual(['k3', 'w1']);
  });

  it('picks the highest version whatever the input order, keeping first-appearance order of names', () => {
    const shuffled = [all[2], all[3], all[0], all[1]]; // k1, w1, k3, k2
    expect(latestPresetPerName(shuffled).map((x) => x.id)).toEqual(['w1', 'k3']);
  });

  it('pins a superseded id that is still selected (a company default), and ignores unknown ids', () => {
    expect(latestPresetPerName(all, ['k1', 'nope']).map((x) => x.id)).toEqual(['k3', 'w1', 'k1']);
    // Already shown → not duplicated.
    expect(latestPresetPerName(all, ['k3']).map((x) => x.id)).toEqual(['k3', 'w1']);
  });

  it('handles an empty list', () => {
    expect(latestPresetPerName([])).toEqual([]);
  });
});
