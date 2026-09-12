/**
 * The signed report's OWN palette — FROZEN (INS-094 decision D5).
 *
 * A report is a document, not app chrome: it must look the same across
 * product versions and match its PDF byte-for-byte in colour. So the branded
 * report (`apps/web/components/inspect/branded-report.tsx`) and the API's
 * pdf-lib renderer (`apps/api/src/reports/report-pdf.ts`) both read THESE
 * values, and the app theme (`colors.ts`) is free to change around them.
 *
 * The values are the literals both renderers carried before this module
 * existed (the console's original hairline palette). `index.test.ts` pins them.
 * The brand colour itself is never here — it is DATA, frozen per report in
 * `brandingSnapshot.primaryColor`; `defaultBrand` is only the fallback when a
 * client has none.
 */
import type { SeverityKey, SeverityPresentation } from './semantic';

export const report = {
  ink: '#0B1220',
  sub: '#5B6573',
  faint: '#9AA3AE',
  line: '#E5E9EF',
  lineSoft: '#F0F3F7',
  fill: '#FAFBFC',
  white: '#FFFFFF',
  /** ACCEPTED band. */
  pass: '#1F6B43',
  passDot: '#1F8A4C',
  passBg: '#EAF6F0',
  passBorder: '#BEE3CD',
  /** REJECTED band and the critical class. */
  critical: '#B42318',
  criticalBg: '#FBEAEA',
  criticalBorder: '#F1C9C5',
  criticalDot: '#D14343',
  /** HOLD band and the major class. */
  amber: '#B5791A',
  amberBg: '#FAF1E2',
  amberBorder: '#EBD9B4',
  /** Fallback brand colour when the client company has no `primaryColor`. */
  defaultBrand: '#1457A3',
  /** Photo placeholder gradient stops. */
  photoPlaceholderFrom: '#BFC8D2',
  photoPlaceholderTo: '#7E8794',
  /** Inter stylistic set the document renders with. */
  fontFeatureSettings: '"cv11", "ss01"',
  severity: {
    critical: {
      key: 'critical',
      label: 'Critical',
      abbr: 'Crit',
      fg: '#B42318',
      bg: '#FBEAEA',
      dot: '#D14343',
    },
    major: {
      key: 'major',
      label: 'Major',
      abbr: 'Maj',
      fg: '#B5791A',
      bg: '#FAF1E2',
      dot: '#D99A20',
    },
    minor: {
      key: 'minor',
      label: 'Minor',
      abbr: 'Min',
      fg: '#475467',
      bg: '#EFF2F6',
      dot: '#8A93A1',
    },
  } satisfies Record<SeverityKey, SeverityPresentation>,
} as const;

/** `#RRGGBB` → [r, g, b] in 0..1, the shape pdf-lib's `rgb()` takes. Throws on a malformed hex. */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const v = m[1];
  return [
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
  ];
}
