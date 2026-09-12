/**
 * Typography (INS-094): three families, one type scale.
 *
 * Families are DATA, not CSS: `name` is the canonical family (what a CSS stack
 * or a Google Fonts request uses), `native` are the expo-google-fonts asset
 * keys per weight (what a React Native `fontFamily` must be — Android does not
 * synthesise weights for a custom family, so the weight is part of the name).
 * Only the `var(--font-x)` prefix is web-specific, and it stays in
 * `apps/web/components/inspect/tokens.ts`.
 */

export type FontRole = 'sans' | 'heading' | 'mono';
export type FontWeight = 400 | 500 | 600 | 700;

export interface FontFamily {
  /** Canonical family name, as Google Fonts spells it. */
  name: string;
  /** CSS fallback stack, without the family itself. */
  fallback: string;
  /** expo-google-fonts asset keys by weight. Missing weights resolve via `nativeFontFor`. */
  native: Partial<Record<FontWeight, string>>;
}

export const fontFamilies: Readonly<Record<FontRole, FontFamily>> = {
  sans: {
    name: 'Inter',
    fallback: '-apple-system, system-ui, sans-serif',
    native: {
      400: 'Inter_400Regular',
      500: 'Inter_500Medium',
      600: 'Inter_600SemiBold',
      700: 'Inter_700Bold',
    },
  },
  heading: {
    name: 'Libre Baskerville',
    fallback: 'Georgia, serif',
    native: {
      400: 'LibreBaskerville_400Regular',
      700: 'LibreBaskerville_700Bold',
    },
  },
  mono: {
    name: 'JetBrains Mono',
    fallback: 'ui-monospace, monospace',
    native: {
      400: 'JetBrainsMono_400Regular',
      500: 'JetBrainsMono_500Medium',
      700: 'JetBrainsMono_700Bold',
    },
  },
};

const WEIGHTS: readonly FontWeight[] = [400, 500, 600, 700];

/**
 * The native asset key for a role at a weight, falling back to the NEAREST
 * loaded weight when the family does not ship that one (heavier wins a tie) —
 * `nativeFontFor('heading', 600)` is `LibreBaskerville_700Bold`,
 * `nativeFontFor('heading', 500)` is `LibreBaskerville_400Regular`.
 */
export function nativeFontFor(role: FontRole, weight: FontWeight): string {
  const family = fontFamilies[role].native;
  const exact = family[weight];
  if (exact) return exact;
  const idx = WEIGHTS.indexOf(weight);
  for (let step = 1; step < WEIGHTS.length; step += 1) {
    const up = WEIGHTS[idx + step];
    if (up && family[up]) return family[up] as string;
    const down = WEIGHTS[idx - step];
    if (down && family[down]) return family[down] as string;
  }
  throw new Error(`No native font for ${role}`);
}

export interface TypeToken {
  family: FontRole;
  weight: FontWeight;
  size: number;
  lineHeight: number;
  letterSpacing?: number;
  uppercase?: boolean;
}

/**
 * The type scale. Serif (`heading`) carries page titles, section titles and the
 * big numbers on stat cards; everything else is Inter; ids, hashes and
 * measurements are mono. `caption` is 11 (the reference's 10 fails on Android
 * density for lowercase text); `overline` keeps 10 because it is uppercase bold.
 */
export const typeScale = {
  display: { family: 'heading', weight: 400, size: 32, lineHeight: 38 },
  title: { family: 'heading', weight: 400, size: 24, lineHeight: 30 },
  heading: { family: 'heading', weight: 400, size: 18, lineHeight: 24 },
  subheading: { family: 'sans', weight: 700, size: 16, lineHeight: 22 },
  body: { family: 'sans', weight: 400, size: 14, lineHeight: 20 },
  bodyStrong: { family: 'sans', weight: 700, size: 14, lineHeight: 20 },
  label: { family: 'sans', weight: 700, size: 12, lineHeight: 16 },
  caption: { family: 'sans', weight: 500, size: 11, lineHeight: 14 },
  overline: {
    family: 'sans',
    weight: 700,
    size: 10,
    lineHeight: 14,
    letterSpacing: 1.2,
    uppercase: true,
  },
  button: { family: 'sans', weight: 700, size: 14, lineHeight: 18 },
  tab: { family: 'sans', weight: 500, size: 10, lineHeight: 12 },
  mono: { family: 'mono', weight: 500, size: 13, lineHeight: 18 },
  monoSmall: { family: 'mono', weight: 400, size: 11, lineHeight: 14 },
} as const satisfies Record<string, TypeToken>;

export type TypeRole = keyof typeof typeScale;

/** CSS stacks — the web composes `var(--font-x), ${stack}` in front of these. */
export const fontStack = `${fontFamilies.sans.name}, ${fontFamilies.sans.fallback}`;
export const headingStack = `"${fontFamilies.heading.name}", ${fontFamilies.heading.fallback}`;
export const monoFontStack = `"${fontFamilies.mono.name}", ${fontFamilies.mono.fallback}`;
