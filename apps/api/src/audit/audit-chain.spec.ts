import { AuditChainEntry, linkHash, verifyChain } from './audit-chain';

/** Build a valid chain from a list of payload hashes (genesis prev = null). */
function buildChain(payloadHashes: string[]): AuditChainEntry[] {
  const entries: AuditChainEntry[] = [];
  let prev: string | null = null;
  payloadHashes.forEach((payloadHash, i) => {
    const entry: AuditChainEntry = {
      sequence: i,
      payloadHash,
      prevEntryHash: prev,
    };
    entries.push(entry);
    prev = linkHash(entry);
  });
  return entries;
}

describe('linkHash', () => {
  it('is deterministic', () => {
    const e: AuditChainEntry = {
      sequence: 0,
      payloadHash: 'p0',
      prevEntryHash: null,
    };
    expect(linkHash(e)).toBe(linkHash(e));
  });

  it('changes when the entry content changes', () => {
    const a: AuditChainEntry = {
      sequence: 0,
      payloadHash: 'p0',
      prevEntryHash: null,
    };
    const b: AuditChainEntry = {
      sequence: 0,
      payloadHash: 'p1',
      prevEntryHash: null,
    };
    expect(linkHash(a)).not.toBe(linkHash(b));
  });
});

describe('verifyChain', () => {
  it('accepts an unbroken chain', () => {
    expect(verifyChain(buildChain(['p0', 'p1', 'p2']))).toBe(true);
  });

  it('detects tampering with an earlier entry (chain breaks)', () => {
    const chain = buildChain(['p0', 'p1', 'p2']);
    chain[0].payloadHash = 'EVIL'; // retroactive edit
    expect(verifyChain(chain)).toBe(false);
  });

  it('rejects a genesis entry whose prevEntryHash is not null', () => {
    const chain = buildChain(['p0', 'p1']);
    chain[0].prevEntryHash = 'not-null';
    expect(verifyChain(chain)).toBe(false);
  });

  it('rejects a non-monotonic sequence', () => {
    const chain = buildChain(['p0', 'p1', 'p2']);
    chain[2].sequence = 1; // duplicate / out of order
    expect(verifyChain(chain)).toBe(false);
  });

  it('treats an empty chain as valid', () => {
    expect(verifyChain([])).toBe(true);
  });
});
