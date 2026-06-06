/**
 * Append-only, hash-chained audit log core (spec §9). Each entry stores the hash
 * of the previous entry (`prevEntryHash`), so any retroactive edit changes that
 * entry's link hash and breaks every subsequent link — making tampering
 * detectable. `sequence` is the application-assigned monotonic per-org counter.
 *
 * This is the pure verification/derivation logic; the NestJS service that
 * persists entries and assigns sequences lives in a later (DB-bound) phase.
 */
import { createHash } from 'node:crypto';
import { canonicalize } from '../tamper-proof/canonicalize';

export interface AuditChainEntry {
  sequence: number;
  /** Hash of this entry's payload (action + metadata), computed upstream. */
  payloadHash: string;
  /** Link hash of the previous entry; null for the genesis entry. */
  prevEntryHash: string | null;
}

/**
 * The link hash that the NEXT entry must store as its `prevEntryHash`. Covers the
 * entry's immutable content AND its own prevEntryHash, so the chain is tamper-evident.
 */
export function linkHash(entry: AuditChainEntry): string {
  const material =
    canonicalize({ sequence: entry.sequence, payloadHash: entry.payloadHash }) +
    '|' +
    (entry.prevEntryHash ?? '');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

/**
 * Verify a chain (ordered by sequence): genesis prevEntryHash is null, each
 * subsequent entry links to the recomputed hash of its predecessor, and
 * sequence numbers are strictly increasing.
 */
export function verifyChain(entries: readonly AuditChainEntry[]): boolean {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (i === 0) {
      if (entry.prevEntryHash !== null) return false;
      continue;
    }
    const prev = entries[i - 1];
    if (entry.sequence <= prev.sequence) return false;
    if (entry.prevEntryHash !== linkHash(prev)) return false;
  }
  return true;
}
