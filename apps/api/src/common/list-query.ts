/**
 * Shared list-endpoint query parsing (INS-050): server-side search + pagination
 * params, clamped so a client can neither dump the table (take) nor pass a
 * pathological search string (q length).
 */
export interface ListQuery {
  take: number;
  skip: number;
  q?: string;
}

export interface RawListQuery {
  q?: unknown;
  take?: unknown;
  skip?: unknown;
}

/** Coerce a possibly-array/object query value to a scalar string (or undefined). */
function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  // Express/qs delivers `?q=a&q=b` as an array — take the first scalar entry
  // rather than throwing a 500 on `.trim()`.
  if (Array.isArray(value)) return scalar(value[0]);
  return undefined;
}

export function parseListQuery(raw: RawListQuery): ListQuery {
  const takeParsed = parseInt(scalar(raw.take) ?? '', 10);
  const take = Number.isNaN(takeParsed) ? 50 : Math.min(Math.max(takeParsed, 1), 100);
  const skipParsed = parseInt(scalar(raw.skip) ?? '', 10);
  const skip = Number.isNaN(skipParsed) ? 0 : Math.max(skipParsed, 0);
  const q = scalar(raw.q)?.trim().slice(0, 200) || undefined;
  return { take, skip, q };
}
