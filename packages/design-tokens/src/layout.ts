/**
 * Layout scales (INS-094). Spacing is Tailwind-numbered on a 4-pt grid so the
 * reference HTML translates one-to-one (`px-6` → `space[6]`). Radius follows
 * the reference's `--radius: 12px` calc chain. Shadows are PARAMETERS — each
 * platform composes its own (web `box-shadow`, RN `shadow*` + `elevation`);
 * cards are border-defined and the shadow is a whisper.
 */

export const space = {
  0: 0,
  0.5: 2,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;
export type SpaceStep = keyof typeof space;

export const radius = {
  xs: 4,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  '2xl': 20,
  full: 999,
} as const;
export type RadiusStep = keyof typeof radius;

export interface ShadowParams {
  /** Vertical offset in px. */
  y: number;
  /** Blur radius in px (CSS). RN uses `blur / 2` as `shadowRadius`. */
  blur: number;
  /** Alpha of the `foreground`-coloured shadow. */
  opacity: number;
  /** Android elevation. */
  elevation: number;
}

export const shadow: Readonly<
  Record<'none' | 'sm' | 'md' | 'lg', ShadowParams>
> = {
  none: { y: 0, blur: 0, opacity: 0, elevation: 0 },
  sm: { y: 1, blur: 2, opacity: 0.05, elevation: 1 },
  md: { y: 4, blur: 12, opacity: 0.08, elevation: 3 },
  lg: { y: 12, blur: 32, opacity: 0.12, elevation: 8 },
};
export type ShadowLevel = keyof typeof shadow;

/** The 44pt floor — Apple HIG / Material minimum touch target. */
export const MIN_TARGET = 44;

/** Bottom tab bar height, EXCLUDING the device's bottom safe-area inset. */
export const TAB_BAR_HEIGHT = 64;
