import { describe, expect, test } from 'vitest';
import { light, report } from '@inspect/design-tokens';
import { ui, mono, severity, roles } from './tokens';

/**
 * Characterization tests for the console's view of the design tokens.
 *
 * INS-094: the values now flow from `@inspect/design-tokens`' semantic light
 * theme through the `@deprecated palette` alias, so the console re-coloured to
 * the v2 direction the day the package changed — every screen still reads
 * `ui.ink`, `ui.line`, `ui.accent`. What this file pins is the web-only
 * composition (the Next font variables) and the alias mapping itself, so a
 * silently dropped key or a wrong role cannot pass a build.
 */
describe('ui palette', () => {
  test('is the legacy alias over the v2 light theme', () => {
    expect(ui).toMatchObject({
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
    });
    // The direction, verbatim — a screen that renders these is the v2 look.
    expect(ui.bg).toBe('#FDFCF8');
    expect(ui.accent).toBe('#3A7D44');
    expect(ui.line).toBe('#E6E0D4');
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
  test('severity carries all three classes, re-coloured onto the v2 hues', () => {
    expect(Object.keys(severity).sort()).toEqual(['critical', 'major', 'minor']);
    expect(severity.critical).toMatchObject({ key: 'critical', label: 'Critical', abbr: 'Crit', dot: light.destructive });
    expect(severity.major).toMatchObject({ key: 'major', label: 'Major', abbr: 'Maj', dot: light.warning });
    expect(severity.minor).toMatchObject({ key: 'minor', label: 'Minor', abbr: 'Min' });
  });

  test('the app chrome severity map is NOT the report one', () => {
    // The signed report keeps its frozen palette (`report.severity`); the
    // console's chips follow the theme. If these ever converge again, one of
    // them is reading the wrong table.
    expect(severity.critical.fg).not.toBe(report.severity.critical.fg);
    expect(report.severity.critical.fg).toBe('#B42318');
  });

  test('roles covers all four badge keys', () => {
    expect(Object.keys(roles).sort()).toEqual(['inspector', 'owner', 'platform', 'qa']);
    expect(roles.platform.label).toBe('Platform Admin');
  });
});
