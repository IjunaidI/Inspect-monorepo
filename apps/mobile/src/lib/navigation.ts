/**
 * Pure navigation decisions — no expo-router import so they stay unit-testable.
 *
 * `router.back()` is a no-op when the screen is the first entry in the stack
 * (cold start on a deep link, or a screen reached via `router.replace`), which
 * strands the user with a dead button. A back affordance therefore always needs
 * a fallback destination.
 */
export type BackTarget = { kind: 'back' } | { kind: 'replace'; href: string };

/** The default landing screen for every authenticated user — the Home tab (INS-095). */
export const HOME_HREF = '/';

/** The hub every QA-side list screen falls back to when it has no history. */
export const LIBRARY_HREF = '/library';

export function resolveBack(canGoBack: boolean, fallbackHref: string = HOME_HREF): BackTarget {
  return canGoBack ? { kind: 'back' } : { kind: 'replace', href: fallbackHref };
}
