import { contentHash } from './content-hash';

describe('contentHash', () => {
  const payload = { inspectionId: 'i1', status: 'SUBMITTED' };

  it('is deterministic for the same input', () => {
    expect(contentHash(payload, ['h1', 'h2'])).toBe(
      contentHash(payload, ['h1', 'h2']),
    );
  });

  it('is independent of payload key order (uses canonicalization)', () => {
    expect(contentHash({ a: 1, b: 2 }, [])).toBe(contentHash({ b: 2, a: 1 }, []));
  });

  it('changes when a photo hash changes', () => {
    expect(contentHash(payload, ['h1'])).not.toBe(contentHash(payload, ['h2']));
  });

  it('is sensitive to photo hash ORDER (ordered photo hashes, spec §9)', () => {
    expect(contentHash(payload, ['h1', 'h2'])).not.toBe(
      contentHash(payload, ['h2', 'h1']),
    );
  });

  it('returns a 64-char lowercase hex sha256 digest', () => {
    expect(contentHash(payload, ['h1'])).toMatch(/^[0-9a-f]{64}$/);
  });
});
