import { describe, expect, it } from 'vitest';

import { filterOptions } from './filter-options';

const rows = [
  { id: '1', name: 'Acme Factory Ltd' },
  { id: '2', name: 'São Paulo Textiles' },
  { id: '3', name: 'Northwind Apparel' },
];
const byName = (r: { name: string }) => r.name;

describe('filterOptions', () => {
  it('returns every item in original order for an empty or whitespace query', () => {
    expect(filterOptions('', rows, byName)).toEqual(rows);
    expect(filterOptions('   ', rows, byName)).toEqual(rows);
  });

  it('matches case-insensitively on a substring', () => {
    expect(filterOptions('north', rows, byName).map((r) => r.id)).toEqual(['3']);
  });

  it('requires every whitespace-separated token to appear somewhere in the label', () => {
    expect(filterOptions('acme fac', rows, byName).map((r) => r.id)).toEqual(['1']);
    expect(filterOptions('acme north', rows, byName)).toEqual([]);
  });

  it('folds diacritics so an unaccented query matches an accented label', () => {
    expect(filterOptions('sao', rows, byName).map((r) => r.id)).toEqual(['2']);
  });

  it('does not mutate the input', () => {
    const copy = [...rows];
    filterOptions('acme', rows, byName);
    expect(rows).toEqual(copy);
  });
});
