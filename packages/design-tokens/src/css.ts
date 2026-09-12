/**
 * CSS-variable emitter (INS-094). Pure string composition — no DOM — so the
 * web console can inject the theme server-side (`app/layout.tsx`) and Tailwind
 * can read the same `--x` names. Names follow the shadcn convention the console's
 * `globals.css` already declares, so `bg-primary` and `ui.primary` agree.
 */
import type { ThemeColors } from './colors';
import { radius } from './layout';

export type CssVariables = Record<`--${string}`, string>;

export function themeToCssVariables(
  c: ThemeColors,
  radiusPx: number = radius.lg,
): CssVariables {
  return {
    '--background': c.background,
    '--foreground': c.foreground,
    '--card': c.card,
    '--card-foreground': c.cardForeground,
    '--popover': c.card,
    '--popover-foreground': c.cardForeground,
    '--primary': c.primary,
    '--primary-foreground': c.primaryForeground,
    '--primary-strong': c.primaryStrong,
    '--primary-soft': c.primarySoft,
    '--primary-faint': c.primaryFaint,
    '--secondary': c.secondary,
    '--secondary-foreground': c.secondaryForeground,
    '--muted': c.muted,
    '--muted-foreground': c.mutedForeground,
    '--faint': c.faint,
    '--accent': c.accent,
    '--accent-foreground': c.accentForeground,
    '--accent-strong': c.accentStrong,
    '--accent-soft': c.accentSoft,
    '--destructive': c.destructive,
    '--destructive-foreground': c.destructiveForeground,
    '--destructive-strong': c.destructiveStrong,
    '--destructive-soft': c.destructiveSoft,
    '--success': c.success,
    '--success-foreground': c.successForeground,
    '--success-strong': c.successStrong,
    '--success-soft': c.successSoft,
    '--warning': c.warning,
    '--warning-foreground': c.warningForeground,
    '--warning-strong': c.warningStrong,
    '--warning-soft': c.warningSoft,
    '--info': c.info,
    '--info-foreground': c.infoForeground,
    '--info-strong': c.infoStrong,
    '--info-soft': c.infoSoft,
    '--border': c.border,
    '--border-soft': c.borderSoft,
    '--input': c.input,
    '--ring': c.ring,
    '--scrim': c.scrim,
    '--chart-1': c.chart[0],
    '--chart-2': c.chart[1],
    '--chart-3': c.chart[2],
    '--chart-4': c.chart[3],
    '--chart-5': c.chart[4],
    '--radius': `${radiusPx}px`,
  };
}

/** `selector { --a: b; … }` on one line per declaration. */
export function cssBlock(
  selector: string,
  vars: Record<string, string>,
): string {
  const body = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}
