/**
 * The mobile theme (INS-095): `@inspect/design-tokens` values composed into
 * React Native shapes. This is the ONLY place a screen gets a colour, a font,
 * a spacing step or a shadow from — never a hex, never `fontWeight` with a
 * custom family (Android will not synthesise it; the weight is part of the
 * family name, which `text()` resolves).
 *
 * Static for now: `useTheme()` returns the light theme so call sites already
 * read through a hook; INS-101 turns it into a context that follows
 * `useColorScheme()` without touching them.
 */
import {
  MIN_TARGET,
  TAB_BAR_HEIGHT,
  nativeFontFor,
  radius,
  shadow,
  space,
  themes,
  toneColors,
  typeScale,
  type FontRole,
  type FontWeight,
  type ShadowLevel,
  type ThemeColors,
  type Tone,
  type ToneColors,
  type TypeRole,
  type TypeToken,
} from '@inspect/design-tokens';
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

const colors: ThemeColors = themes.light;

export const theme = {
  colors,
  space,
  radius,
  shadow,
  type: typeScale,
} as const;

export type Theme = typeof theme;

/** Hook-shaped so call sites never change when the theme becomes a context read (INS-101). */
export function useTheme(): Theme {
  return theme;
}

/** The loaded font-asset name for a role at a weight. */
export function font(role: FontRole, weight: FontWeight): string {
  return nativeFontFor(role, weight);
}

/**
 * A complete text style for a type role. Emits `fontFamily` (weight baked in),
 * never `fontWeight`.
 */
export function text(role: TypeRole, color: string = colors.foreground): TextStyle {
  const t: TypeToken = typeScale[role];
  return {
    fontFamily: nativeFontFor(t.family, t.weight),
    fontSize: t.size,
    lineHeight: t.lineHeight,
    color,
    ...(t.letterSpacing !== undefined ? { letterSpacing: t.letterSpacing } : {}),
    ...(t.uppercase ? { textTransform: 'uppercase' as const } : {}),
  };
}

/**
 * Platform shadow for a level. Android needs an OPAQUE background and no
 * `overflow: 'hidden'` on the same view, or the elevation is clipped away.
 */
export function elevation(level: ShadowLevel): ViewStyle {
  const s = shadow[level];
  if (s.elevation === 0) return {};
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: colors.foreground,
      shadowOffset: { width: 0, height: s.y },
      shadowOpacity: s.opacity,
      shadowRadius: s.blur / 2,
    },
    android: { elevation: s.elevation },
    default: {},
  }) as ViewStyle;
}

/** `{ fg, bg, dot }` for a tone in the current theme. */
export function tone(t: Tone): ToneColors {
  return toneColors(colors, t);
}

export { MIN_TARGET, TAB_BAR_HEIGHT };
export type { Tone, ToneColors, TypeRole, ThemeColors };
