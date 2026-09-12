/**
 * Semantic maps (INS-094): the wire enums resolved to TONES, and the presentation
 * maps the console and the app already consume (`severity`, `roles`,
 * `brandFallbacks`) re-coloured onto the new palette. Keyed by the shared-types
 * enums with `satisfies`, so a new InspectionStatus is a compile error here —
 * on both platforms — rather than a grey chip nobody notices.
 */
import type {
  DefectSeverity,
  InspectionStatus,
  QaDecision,
} from '@inspect/shared-types';
import type { ThemeColors } from './colors';
import { light } from './colors';

export type Tone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'info'
  | 'warning'
  | 'danger'
  | 'accent';

export interface ToneColors {
  /** Small text on `bg`. */
  fg: string;
  /** Tinted fill. */
  bg: string;
  /** Marker / dot / bar in the pure hue. */
  dot: string;
}

/** Theme-aware, so the same call works for dark later without a second table. */
export function toneColors(c: ThemeColors, tone: Tone): ToneColors {
  switch (tone) {
    case 'neutral':
      return { fg: c.mutedForeground, bg: c.muted, dot: c.faint };
    case 'primary':
      return { fg: c.primaryStrong, bg: c.primarySoft, dot: c.primary };
    case 'success':
      return { fg: c.successStrong, bg: c.successSoft, dot: c.success };
    case 'info':
      return { fg: c.infoStrong, bg: c.infoSoft, dot: c.info };
    case 'warning':
      return { fg: c.warningStrong, bg: c.warningSoft, dot: c.warning };
    case 'danger':
      return {
        fg: c.destructiveStrong,
        bg: c.destructiveSoft,
        dot: c.destructive,
      };
    case 'accent':
      return { fg: c.accentStrong, bg: c.accentSoft, dot: c.accent };
  }
}

export const TONES: readonly Tone[] = [
  'neutral',
  'primary',
  'success',
  'info',
  'warning',
  'danger',
  'accent',
];

/**
 * Inspection status → tone. Activity is `info` (blue) and verdicts are green /
 * red / gold, so "in progress" can never be mistaken for "passed".
 */
export const statusTone = {
  DRAFT: 'neutral',
  ASSIGNED: 'neutral',
  IN_PROGRESS: 'info',
  SUBMITTED: 'warning',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REPORT_ISSUED: 'success',
  REJECTED: 'danger',
  HOLD: 'accent',
} as const satisfies Record<InspectionStatus, Tone>;

export const qaDecisionTone = {
  PASS: 'success',
  FAIL: 'danger',
  HOLD: 'accent',
} as const satisfies Record<QaDecision, Tone>;

/** Report conclusion (lowercase, as `conclusionFrom` in @inspect/domain yields it) → tone. */
export const verdictTone = {
  pass: 'success',
  fail: 'danger',
  hold: 'accent',
  pending: 'neutral',
} as const satisfies Record<'pass' | 'fail' | 'hold' | 'pending', Tone>;

export type SeverityKey = 'critical' | 'major' | 'minor';

export interface SeverityPresentation {
  key: SeverityKey;
  label: string;
  abbr: string;
  fg: string;
  bg: string;
  dot: string;
}

/**
 * Defect-class presentation for APP CHROME (chips, unit sheet, review). The
 * signed report has its own frozen copy in `report.ts` — never point the report
 * at this one.
 */
export const severity: Readonly<Record<SeverityKey, SeverityPresentation>> = {
  critical: {
    key: 'critical',
    label: 'Critical',
    abbr: 'Crit',
    fg: light.destructiveStrong,
    bg: '#FAECEC',
    dot: light.destructive,
  },
  major: {
    key: 'major',
    label: 'Major',
    abbr: 'Maj',
    fg: light.warningStrong,
    bg: '#F8EDE0',
    dot: light.warning,
  },
  minor: {
    key: 'minor',
    label: 'Minor',
    abbr: 'Min',
    fg: light.mutedForeground,
    bg: light.muted,
    dot: light.faint,
  },
};

/** Wire severity → presentation key. Replaces the per-screen `TINT` maps. */
export const severityByWire: Readonly<Record<DefectSeverity, SeverityKey>> = {
  CRITICAL: 'critical',
  MAJOR: 'major',
  MINOR: 'minor',
};

export type RoleKey = 'inspector' | 'qa' | 'owner' | 'platform';

/** Role badge presentation. Display only — the API is the RBAC authority. */
export const roles: Readonly<
  Record<RoleKey, { label: string; fg: string; bg: string }>
> = {
  inspector: { label: 'Inspector', fg: light.mutedForeground, bg: light.muted },
  qa: { label: 'QA Manager', fg: light.primaryStrong, bg: '#EBF2EC' },
  owner: { label: 'Org Owner', fg: light.accentStrong, bg: '#F8F1E4' },
  platform: { label: 'Platform Admin', fg: light.warningStrong, bg: '#F8EDE0' },
};

/**
 * Brand-avatar fallback palette: a company with no `primaryColor` gets one of
 * these, picked by a stable hash of the company id (`hashIndex` in
 * `@inspect/domain`) — never by row index. SIX entries: `hashIndex` indexes by
 * length, so changing the count re-colours every existing avatar.
 */
export const brandFallbacks = [
  '#3A7D44',
  '#7A5C18',
  '#8C9E8D',
  '#C25E00',
  '#5C7CFA',
  '#2F4F34',
] as const;
