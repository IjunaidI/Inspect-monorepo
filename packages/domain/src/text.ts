/**
 * Deterministic bucket for a key (FNV-1a) — for stable fallback colours and
 * the like. Stable across pages, filters, sessions and platforms, unlike a
 * row index, which changes whenever the visible slice does.
 */
export function hashIndex(key: string, buckets: number): number {
  if (buckets <= 0) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % buckets;
}

/** Two-letter initials from a name or an email local-part, for avatars. */
export function initialsFrom(label: string): string {
  const base = label.replace(/@.*/, '');
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? base[0] ?? '?';
  const b = parts[1]?.[0] ?? '';
  return (a + b).toUpperCase();
}
