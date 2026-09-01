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
    expect(ranked.map((r) => r.name)).toEqual(['Alpha', 'Zed', 'Beta', 'Aardvark']);
    expect(rows[0].name).toBe('Beta');
  });
});
