import { describe, expect, it } from 'vitest';

import { fetchMissing, isComplete } from './fetch-missing';

type Lists = { companies: string[]; products: string[] };

describe('fetchMissing (INS-092 partial retry)', () => {
  it('fetches only the keys that are still missing and keeps what it has', async () => {
    const calls: string[] = [];
    const out = await fetchMissing<Lists>(
      { companies: ['acme'] },
      {
        companies: async () => {
          calls.push('companies');
          return ['never'];
        },
        products: async () => {
          calls.push('products');
          return ['tee'];
        },
      },
    );
    expect(calls).toEqual(['products']);
    expect(out.values).toEqual({ companies: ['acme'], products: ['tee'] });
    expect(out.failures).toEqual([]);
    expect(isComplete(out.values, ['companies', 'products'])).toBe(true);
  });

  it('reports each failure by key and still returns the successes', async () => {
    const boom = new Error('offline');
    const out = await fetchMissing<Lists>(
      {},
      {
        companies: async () => ['acme'],
        products: async () => {
          throw boom;
        },
      },
    );
    expect(out.values).toEqual({ companies: ['acme'] });
    expect(out.failures).toEqual([{ key: 'products', error: boom }]);
    expect(isComplete(out.values, ['companies', 'products'])).toBe(false);
    // Retry asks only for what is lacking.
    const calls: string[] = [];
    const again = await fetchMissing<Lists>(out.values, {
      companies: async () => {
        calls.push('companies');
        return [];
      },
      products: async () => {
        calls.push('products');
        return ['tee'];
      },
    });
    expect(calls).toEqual(['products']);
    expect(again.values).toEqual({ companies: ['acme'], products: ['tee'] });
  });
});
