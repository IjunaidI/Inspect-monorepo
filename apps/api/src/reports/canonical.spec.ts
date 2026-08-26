/**
 * INS-055 spec §5 — the pure canonical-payload readers.
 *
 * These live in `@inspect/shared-types` so the API, the console and the future
 * mobile app read a signed snapshot the same way. The spec lives HERE because
 * `shared-types` has no test runner and the API's Jest suite already resolves
 * the package through its built `dist` — so this proves the PUBLISHED artifact,
 * not the source.
 *
 * Two canonical shapes exist forever: v1 rows are immutable and will outlive the
 * migration, so this is permanent code, not migration scaffolding.
 */
import {
  canonicalVersionOf,
  photoHashesOf,
  readCanonicalParties,
} from '@inspect/shared-types';

/** A payload in the shape reports.service.ts signed before INS-055. */
const v1 = {
  inspectionId: 'insp_1',
  buyer: { id: 'buy_1', name: 'Acme Retail' },
  supplier: { id: 'sup_1', name: 'Dhaka Mills' },
  photoHashes: ['aa', 'bb'],
};

/** The shape it signs after INS-055 (spec §5.3). */
const v2 = {
  canonicalVersion: 2,
  inspectionId: 'insp_1',
  client: { companyId: 'buy_1', name: 'Acme Retail', kind: 'THIRD_PARTY' },
  factory: { companyId: 'sup_1', name: 'Dhaka Mills', kind: 'INTERNAL' },
  photoHashes: ['aa', 'bb'],
};

describe('canonicalVersionOf', () => {
  it('reads an absent marker as v1 — every report signed before INS-055', () => {
    expect(canonicalVersionOf(v1)).toBe(1);
  });

  it('reads the embedded marker as v2', () => {
    expect(canonicalVersionOf(v2)).toBe(2);
  });

  it.each([['2'], [null], [{}], [undefined], [[]], [2.5]])(
    'falls back to v1 for the hostile value %p rather than trusting it',
    (value) => {
      expect(canonicalVersionOf({ canonicalVersion: value })).toBe(1);
    },
  );

  it('treats a non-object snapshot as v1', () => {
    expect(canonicalVersionOf(null)).toBe(1);
    expect(canonicalVersionOf('nonsense')).toBe(1);
  });
});

describe('photoHashesOf', () => {
  it('reads the top-level array from both versions — the key never moves', () => {
    expect(photoHashesOf(v1)).toEqual(['aa', 'bb']);
    expect(photoHashesOf(v2)).toEqual(['aa', 'bb']);
  });

  it('yields [] when the key is missing, matching the verifier today', () => {
    expect(photoHashesOf({ inspectionId: 'x' })).toEqual([]);
    expect(photoHashesOf(null)).toEqual([]);
  });

  it('yields [] for a non-array value rather than passing junk to the hasher', () => {
    expect(photoHashesOf({ photoHashes: 'aa' })).toEqual([]);
  });
});

describe('readCanonicalParties', () => {
  it('produces identical output for a v1 and a v2 snapshot of the same report', () => {
    expect(readCanonicalParties(v1)).toEqual(readCanonicalParties(v2));
  });

  it('maps v1 buyer/supplier onto client/factory', () => {
    expect(readCanonicalParties(v1)).toEqual({
      client: { companyId: 'buy_1', name: 'Acme Retail' },
      factory: { companyId: 'sup_1', name: 'Dhaka Mills' },
    });
  });

  it('reads v2 client/factory without the kind field leaking into the party', () => {
    expect(readCanonicalParties(v2)).toEqual({
      client: { companyId: 'buy_1', name: 'Acme Retail' },
      factory: { companyId: 'sup_1', name: 'Dhaka Mills' },
    });
  });

  it('reports factory: null when a v1 supplier was absent', () => {
    const noFactory = { ...v1, supplier: { id: null, name: null } };
    expect(readCanonicalParties(noFactory).factory).toBeNull();
  });

  it('reports factory: null when the v1 supplier key is missing entirely', () => {
    const { supplier: _omitted, ...noKey } = v1;
    expect(readCanonicalParties(noKey).factory).toBeNull();
  });

  it('reports factory: null for an explicitly null v2 factory', () => {
    expect(readCanonicalParties({ ...v2, factory: null }).factory).toBeNull();
  });

  it('degrades to nulls rather than throwing on a junk snapshot', () => {
    expect(readCanonicalParties(null)).toEqual({
      client: { companyId: null, name: null },
      factory: null,
    });
  });

  it('never reads a v2 payload with the v1 keys — a spoofed buyer key is ignored', () => {
    const spoofed = { ...v2, buyer: { id: 'attacker', name: 'Attacker Ltd' } };
    expect(readCanonicalParties(spoofed).client).toEqual({
      companyId: 'buy_1',
      name: 'Acme Retail',
    });
  });
});
