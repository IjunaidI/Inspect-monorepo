import type { CSSProperties } from 'react';
import { palette, fontStack, monoFontStack } from '@inspect/design-tokens';

/**
 * The console's view of the design tokens (INS-086 Phase 1).
 *
 * The values live in `@inspect/design-tokens`, shared with the future mobile
 * app. This module adds only what is genuinely web-only: the Next font-loader
 * CSS variables, and `mono` as a DOM `CSSProperties` object. Everything else is
 * re-exported unchanged, so the ~37 call sites that import from here are
 * untouched by the extraction.
 */

export { severity, roles } from '@inspect/design-tokens';
export type { SeverityKey, RoleKey } from '@inspect/design-tokens';

/**
 * `var(--font-sans)` is injected by Next's font loader in `app/layout.tsx` and
 * must come FIRST — the shared stack is the fallback behind it.
 */
export const ui = {
  ...palette,
  font: `var(--font-sans), ${fontStack}`,
} as const;

/** Mono style — JetBrains Mono with tabular numerics. */
export const mono: CSSProperties = {
  fontFamily: `var(--font-mono), ${monoFontStack}`,
  fontVariantNumeric: 'tabular-nums',
};

/** Demo AQL plan (internally consistent with the tested ISO 2859-1 engine: L=200@2.5→10/11). */
export const aqlPlan = {
  level: 'II',
  lot: 3200,
  codeLetter: 'L',
  sampleSize: 200,
  classes: [
    { sev: 'critical' as const, aql: '0', ac: 0, re: 1 },
    { sev: 'major' as const, aql: '2.5', ac: 10, re: 11 },
    { sev: 'minor' as const, aql: '4.0', ac: 14, re: 15 },
  ],
};
