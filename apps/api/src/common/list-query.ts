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
  q?: string;
  take?: string;
  skip?: string;
}

export function parseListQuery(raw: RawListQuery): ListQuery {
  const takeParsed = parseInt(raw.take ?? '', 10);
  const take = Number.isNaN(takeParsed) ? 50 : Math.min(Math.max(takeParsed, 1), 100);
  const skipParsed = parseInt(raw.skip ?? '', 10);
  const skip = Number.isNaN(skipParsed) ? 0 : Math.max(skipParsed, 0);
  const q = raw.q?.trim().slice(0, 200) || undefined;
  return { take, skip, q };
}
