import { describe, expect, it } from 'vitest';

import { rankCompaniesByActivity } from './company-ranking';

describe('rankCompaniesByActivity', () => {
  it('ranks by PO activity desc, then name asc, without mutating the input', () => {
    const rows = [
      { name: 'Beta', _count: { purchaseOrders: 1 } },
      { name: 'Alpha', _count: { purchaseOrders: 3 } },
      { name: 'Aardvark' },
      { name: 'Zed', _count: { purchaseOrders: 3 } },
    ];
    const ranked = rankCompaniesByActivity(rows);
    expect(ranked.map((r) => r.name)).toEqual([
      'Alpha',
      'Zed',
      'Beta',
      'Aardvark',
    ]);
    expect(rows[0].name).toBe('Beta');
  });

  // INS-087 — per-role ranking. The fixture is the case the backlog item names:
  // an org where different companies play the two roles, so the Client picker's
  // top entry must differ from the Factory picker's.
  const mixed = [
    {
      name: 'Brand',
      _count: { purchaseOrders: 5 },
      roleCounts: { asClient: 5, asFactory: 0 },
    },
    {
      name: 'Mill',
      _count: { purchaseOrders: 4 },
      roleCounts: { asClient: 0, asFactory: 4 },
    },
    {
      name: 'Agent',
      _count: { purchaseOrders: 6 },
      roleCounts: { asClient: 3, asFactory: 3 },
    },
  ];

  it('ranks by the client edge when role is "client"', () => {
    expect(rankCompaniesByActivity(mixed, 'client').map((r) => r.name)).toEqual(
      ['Brand', 'Agent', 'Mill'],
    );
  });

  it('ranks by the factory edge when role is "factory"', () => {
    expect(
      rankCompaniesByActivity(mixed, 'factory').map((r) => r.name),
    ).toEqual(['Mill', 'Agent', 'Brand']);
  });

  it('with no role, ranks by the flattened count exactly as before', () => {
    expect(rankCompaniesByActivity(mixed).map((r) => r.name)).toEqual([
      'Agent',
      'Brand',
      'Mill',
    ]);
  });

  it('a row without roleCounts falls back to the flattened count even when a role is given', () => {
    const rows = [
      { name: 'Legacy', _count: { purchaseOrders: 9 } },
      {
        name: 'Brand',
        _count: { purchaseOrders: 5 },
        roleCounts: { asClient: 5, asFactory: 0 },
      },
      { name: 'Bare' },
    ];
    expect(rankCompaniesByActivity(rows, 'client').map((r) => r.name)).toEqual([
      'Legacy',
      'Brand',
      'Bare',
    ]);
  });

  it('per-role ties break on name asc and the input is not mutated', () => {
    const rows = [
      { name: 'Zed', roleCounts: { asClient: 2, asFactory: 0 } },
      { name: 'Alpha', roleCounts: { asClient: 2, asFactory: 0 } },
    ];
    expect(rankCompaniesByActivity(rows, 'client').map((r) => r.name)).toEqual([
      'Alpha',
      'Zed',
    ]);
    expect(rows[0].name).toBe('Zed');
  });
});
