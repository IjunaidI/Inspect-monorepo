import { describe, expect, test } from 'vitest';
import { ui, mono, severity, roles } from './tokens';

/**
 * Characterization tests for the design tokens (INS-086 Phase 1).
 *
 * The palette moved to `@inspect/design-tokens` and the two web-only CSS
 * derivations — the Next font variables — are now composed here from the
 * package's raw stacks. `tsc` cannot see a wrong colour or a mangled font
 * stack, and neither can a build. These values are asserted verbatim.
 */
describe('ui palette', () => {
  test('keeps every hex value it had before extraction', () => {
    expect(ui).toMatchObject({
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
      danger: '#B42318',
      assumeBg: '#7C2D12',
    });
  });

  test('puts the Next font CSS variable first, ahead of the shared stack', () => {
    // A dropped `var(--font-sans)` silently falls back to system Inter and
    // changes every screen's metrics without failing a build.
    expect(ui.font).toBe('var(--font-sans), Inter, -apple-system, system-ui, sans-serif');
  });
});

describe('mono', () => {
  test('keeps the font variable and tabular numerics', () => {
    // Tabular numerics are why IDs and timestamps line up in every table.
    expect(mono).toEqual({
      fontFamily: 'var(--font-mono), "JetBrains Mono", ui-monospace, monospace',
      fontVariantNumeric: 'tabular-nums',
    });
  });
});

describe('severity and role maps', () => {
  test('severity carries all three classes with their report colours', () => {
    expect(severity.critical).toEqual({ key: 'critical', label: 'Critical', abbr: 'Crit', fg: '#B42318', bg: '#FBEAEA', dot: '#D14343' });
    expect(severity.major).toEqual({ key: 'major', label: 'Major', abbr: 'Maj', fg: '#B5791A', bg: '#FAF1E2', dot: '#D99A20' });
    expect(severity.minor).toEqual({ key: 'minor', label: 'Minor', abbr: 'Min', fg: '#475467', bg: '#EFF2F6', dot: '#8A93A1' });
  });

  test('critical severity and the destructive action share one red', () => {
    // tokens.ts documents this coupling; if they drift, "danger" stops meaning
    // "critical" to the eye on the report.
    expect(severity.critical.fg).toBe(ui.danger);
  });

  test('roles covers all four badge keys', () => {
    expect(Object.keys(roles).sort()).toEqual(['inspector', 'owner', 'platform', 'qa']);
    expect(roles.platform).toEqual({ label: 'Platform Admin', fg: '#B5791A', bg: '#FAF1E2' });
  });
});
