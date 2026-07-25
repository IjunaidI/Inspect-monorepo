import type { CSSProperties } from 'react';

/**
 * Inspect Pro design tokens — ported verbatim from the Claude Design handoff
 * (inspect-pro/project/screens/shell.jsx). Refined B2B console: single #037BF4
 * accent per screen, 1px hairlines (no shadows), warm-gray canvas, Inter body +
 * JetBrains Mono on numbers/IDs/timestamps only.
 */
export const ui = {
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
  /** Destructive-action red — same hue as severity.critical.fg; never hardcode #DC2626. */
  danger: '#B42318',
  font: 'var(--font-sans), Inter, -apple-system, system-ui, sans-serif',
} as const;

/** Mono style — JetBrains Mono with tabular numerics. */
export const mono: CSSProperties = {
  fontFamily: 'var(--font-mono), "JetBrains Mono", ui-monospace, monospace',
  fontVariantNumeric: 'tabular-nums',
};

export type SeverityKey = 'critical' | 'major' | 'minor';
export const severity: Record<
  SeverityKey,
  { key: SeverityKey; label: string; abbr: string; fg: string; bg: string; dot: string }
> = {
  critical: { key: 'critical', label: 'Critical', abbr: 'Crit', fg: '#B42318', bg: '#FBEAEA', dot: '#D14343' },
  major: { key: 'major', label: 'Major', abbr: 'Maj', fg: '#B5791A', bg: '#FAF1E2', dot: '#D99A20' },
  minor: { key: 'minor', label: 'Minor', abbr: 'Min', fg: '#475467', bg: '#EFF2F6', dot: '#8A93A1' },
};

export type RoleKey = 'inspector' | 'qa' | 'owner' | 'platform';
export const roles: Record<RoleKey, { label: string; fg: string; bg: string }> = {
  inspector: { label: 'Inspector', fg: '#475467', bg: '#EFF2F6' },
  qa: { label: 'QA Manager', fg: '#1457A3', bg: '#EAF3FB' },
  owner: { label: 'Org Owner', fg: '#5B45B0', bg: '#F1EEFB' },
  platform: { label: 'Platform Admin', fg: '#B5791A', bg: '#FAF1E2' },
};

/** Seeded, severity-classified defect library (builder, populate, report). */
export const defectLibrary: Record<SeverityKey, string[]> = {
  critical: ['Needle / metal contamination', 'Sharp tool left in garment', 'Wrong size in carton'],
  major: ['Skewed collar', 'Open seam', 'Broken stitch', 'Color shading (out of tol.)', 'Holes / fabric damage', 'Misaligned label', 'Puckering'],
  minor: ['Loose thread', 'Uneven point', 'Minor soiling', 'Slight shade variation', 'Crease marks'],
};

/** Demo AQL plan (internally consistent with the tested ISO 2859-1 engine: L=200@2.5→10/11). */
export const aqlPlan = {
  level: 'II',
  lot: 3200,
  codeLetter: 'L',
  sampleSize: 200,
  classes: [
    { sev: 'critical' as SeverityKey, aql: '0', ac: 0, re: 1 },
    { sev: 'major' as SeverityKey, aql: '2.5', ac: 10, re: 11 },
    { sev: 'minor' as SeverityKey, aql: '4.0', ac: 14, re: 15 },
  ],
};
