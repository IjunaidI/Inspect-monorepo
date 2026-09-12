import { ApiError } from '@inspect/api-client';

/** Network failures are not ApiErrors; say so in words, not a TypeError. */
export function describeCreateError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return 'No connection. Check the network and try again.';
  return e instanceof Error ? e.message : fallback;
}
