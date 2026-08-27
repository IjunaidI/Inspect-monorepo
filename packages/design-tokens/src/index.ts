/**
 * Inspect design tokens — platform-free (INS-086 Phase 1).
 *
 * Ported verbatim out of `apps/web/components/inspect/tokens.ts`. Refined B2B
 * console: a single #037BF4 accent per screen, 1px hairlines (no shadows), warm
 * gray canvas, Inter body + JetBrains Mono on numbers/IDs/timestamps only.
 *
 * What is DELIBERATELY not here: anything expressed as CSS. `var(--font-sans)`
 * is a Next font-loader variable and `CSSProperties` is a DOM type — React
 * Native has neither. This module exports raw values and font STACKS; each
 * platform composes its own presentation form from them. See
 * `apps/web/components/inspect/tokens.ts` for the web composition.
 */

/** The colour tokens. Never hardcode one of these hexes at a call site. */
export const palette = {
  bg: '#F6F8FA',
  panel: '#FFFFFF',
  ink: '#0B1220',
  sub: '#5B6573',
  faint: '#9AA3AE',
  line: '#E5E9EF',
  lineSoft: '#F0F3F7',
  fill: '#FAFBFC',
  accent: '#037BF4',
  accentSoft: '#F0F8FF',
  /** Destructive-action red — the same hue as `severity.critical.fg`, on purpose. */
  danger: '#B42318',
  /** Platform-Admin org-assumption banner background (INS-079). */
  assumeBg: '#7C2D12',
} as const;

/** Body font stack, WITHOUT any platform font-variable prefix. */
export const fontStack = 'Inter, -apple-system, system-ui, sans-serif';

/** Monospace stack for numbers, IDs and timestamps. */
export const monoFontStack = '"JetBrains Mono", ui-monospace, monospace';

export type SeverityKey = 'critical' | 'major' | 'minor';

/** Defect-class presentation. `fg`/`bg` tint chips; `dot` is the list marker. */
export const severity: Record<
  SeverityKey,
  { key: SeverityKey; label: string; abbr: string; fg: string; bg: string; dot: string }
> = {
  critical: { key: 'critical', label: 'Critical', abbr: 'Crit', fg: '#B42318', bg: '#FBEAEA', dot: '#D14343' },
  major: { key: 'major', label: 'Major', abbr: 'Maj', fg: '#B5791A', bg: '#FAF1E2', dot: '#D99A20' },
  minor: { key: 'minor', label: 'Minor', abbr: 'Min', fg: '#475467', bg: '#EFF2F6', dot: '#8A93A1' },
};

export type RoleKey = 'inspector' | 'qa' | 'owner' | 'platform';

/** Role badge presentation. Display only — the API is the RBAC authority. */
export const roles: Record<RoleKey, { label: string; fg: string; bg: string }> = {
  inspector: { label: 'Inspector', fg: '#475467', bg: '#EFF2F6' },
  qa: { label: 'QA Manager', fg: '#1457A3', bg: '#EAF3FB' },
  owner: { label: 'Org Owner', fg: '#5B45B0', bg: '#F1EEFB' },
  platform: { label: 'Platform Admin', fg: '#B5791A', bg: '#FAF1E2' },
};
