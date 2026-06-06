import { createHash } from 'node:crypto';
import { canonicalize } from './canonicalize';

/**
 * Content hash over the canonicalized inspection payload plus the ORDERED list
 * of photo content hashes (spec §9). Deterministic and order-sensitive on the
 * photo hashes, so any change to the inspection data or its evidence breaks it.
 */
export function contentHash(
  payload: unknown,
  orderedPhotoHashes: readonly string[],
): string {
  const canonical = canonicalize(payload) + '\n' + orderedPhotoHashes.join(',');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
