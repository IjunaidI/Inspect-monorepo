/**
 * The pre-INS-094 `palette` keys, mapped onto the new light theme.
 *
 * @deprecated Migration alias only. Every one of the ~80 files that imports
 * `palette` keeps compiling and flips to the new colours at once; each screen
 * then moves to the kit / `ThemeColors` roles and the alias is deleted in the
 * last INS-096 batch. Do not add keys here and do not use it in new code.
 */
import { light } from './colors';

export const palette = {
  bg: light.background,
  panel: light.card,
  ink: light.foreground,
  sub: light.mutedForeground,
  faint: light.faint,
  line: light.border,
  lineSoft: light.borderSoft,
  fill: light.muted,
  accent: light.primary,
  accentSoft: light.primarySoft,
  danger: light.destructive,
  /** Platform-Admin org-assumption banner background (INS-079) — dark amber in the new palette. */
  assumeBg: '#7A3B00',
} as const;
