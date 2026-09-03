/**
 * Picker search (INS-091). ONE matcher for the web combobox and the mobile
 * option picker, so "what does typing in a picker match" cannot drift between
 * platforms. Case-insensitive, diacritic-folded, every token must appear.
 */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function filterOptions<T>(
  query: string,
  items: readonly T[],
  label: (item: T) => string,
): T[] {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...items];
  return items.filter((item) => {
    const haystack = fold(label(item));
    return tokens.every((t) => haystack.includes(t));
  });
}
