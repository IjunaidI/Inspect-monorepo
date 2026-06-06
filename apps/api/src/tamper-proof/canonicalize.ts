/**
 * Deterministic JSON canonicalization: object keys sorted recursively, array
 * order preserved. The same logical value always serializes to the same string,
 * so a content hash over it is stable regardless of property insertion order
 * (spec §9 — "canonicalized inspection data").
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    // Primitives (and undefined -> 'null' for stability).
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((key) => JSON.stringify(key) + ':' + canonicalize(obj[key]));
  return '{' + entries.join(',') + '}';
}
