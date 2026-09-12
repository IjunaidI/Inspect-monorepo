import { describe, expect, test } from 'vitest';
import {
  DEFECT_SEVERITIES,
  INSPECTION_STATUSES,
  QA_DECISIONS,
} from '@inspect/shared-types';
import {
  ICON_NAMES,
  TONES,
  brandFallbacks,
  cssBlock,
  dark,
  fontFamilies,
  hexToRgb01,
  iconSvg,
  icons,
  isIconName,
  light,
  nativeFontFor,
  palette,
  qaDecisionTone,
  report,
  roles,
  severity,
  severityByWire,
  statusTone,
  themeToCssVariables,
  toneColors,
  typeScale,
  verdictTone,
} from './index';

// ── colour maths (WCAG 2.x relative luminance / contrast) ──────────────────

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const v = hex[1];
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
      value.trim(),
    );
  if (rgba) {
    return {
      r: +rgba[1],
      g: +rgba[2],
      b: +rgba[3],
      a: rgba[4] === undefined ? 1 : +rgba[4],
    };
  }
  throw new Error(`unparseable colour ${value}`);
}

/** `top` composited over an OPAQUE `base`. */
function composite(top: Rgba, base: Rgba): Rgba {
  const a = top.a;
  return {
    r: Math.round(top.r * a + base.r * (1 - a)),
    g: Math.round(top.g * a + base.g * (1 - a)),
    b: Math.round(top.b * a + base.b * (1 - a)),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: string, bg: string, base: string): number {
  const baseC = parseColor(base);
  const bgC = composite(parseColor(bg), baseC);
  const fgC = composite(parseColor(fg), bgC);
  const l1 = luminance(fgC);
  const l2 = luminance(bgC);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('light theme values', () => {
  test('carries the reference direction verbatim', () => {
    expect(light).toMatchObject({
      background: '#FDFCF8',
      foreground: '#1A331C',
      card: '#FFFFFF',
      primary: '#3A7D44',
      secondary: '#E8DDCB',
      secondaryForeground: '#2F4F34',
      muted: '#F2EEE6',
      mutedForeground: '#5C6B5E',
      accent: '#DCB878',
      destructive: '#CF4444',
      border: '#E6E0D4',
      input: '#F2EEE6',
      ring: '#3A7D44',
    });
    expect(light.chart).toEqual([
      '#3A7D44',
      '#DCB878',
      '#8C9E8D',
      '#C25E00',
      '#5C7CFA',
    ]);
  });

  test('success is the primary green — forest green IS pass', () => {
    expect(light.success).toBe(light.primary);
    expect(light.successSoft).toBe(light.primarySoft);
  });

  test('dark has the same shape as light', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });
});

describe('contrast (WCAG AA, 4.5:1 for small text)', () => {
  const surfaces = [light.card, light.background];

  test('body text roles on every surface', () => {
    for (const base of surfaces) {
      expect(contrast(light.foreground, base, base)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(light.mutedForeground, base, base),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(light.mutedForeground, light.muted, base),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('every tone foreground on its own tinted background, over card and canvas', () => {
    for (const tone of TONES) {
      const t = toneColors(light, tone);
      for (const base of surfaces) {
        expect(
          contrast(t.fg, t.bg, base),
          `${tone} on ${base}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('primary text on white and the primary button label', () => {
    expect(
      contrast(light.primary, light.card, light.card),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(light.primaryForeground, light.primary, light.card),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test('severity and role chips', () => {
    for (const s of Object.values(severity)) {
      expect(contrast(s.fg, s.bg, light.card), s.key).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    for (const [k, r] of Object.entries(roles)) {
      expect(contrast(r.fg, r.bg, light.card), k).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('semantic maps are exhaustive over the wire enums', () => {
  test('every InspectionStatus has a tone', () => {
    for (const s of INSPECTION_STATUSES) expect(TONES).toContain(statusTone[s]);
    expect(Object.keys(statusTone).sort()).toEqual(
      [...INSPECTION_STATUSES].sort(),
    );
  });

  test('every QaDecision has a tone; verdict tones cover pass/fail/hold/pending', () => {
    for (const d of QA_DECISIONS) expect(TONES).toContain(qaDecisionTone[d]);
    expect(Object.keys(verdictTone).sort()).toEqual([
      'fail',
      'hold',
      'pass',
      'pending',
    ]);
  });

  test('activity is never a verdict colour', () => {
    expect(statusTone.IN_PROGRESS).toBe('info');
    expect(statusTone.APPROVED).toBe('success');
    expect(statusTone.REJECTED).toBe('danger');
  });

  test('severityByWire covers every DefectSeverity', () => {
    expect(Object.keys(severityByWire).sort()).toEqual(
      [...DEFECT_SEVERITIES].sort(),
    );
    expect(severityByWire.CRITICAL).toBe('critical');
  });

  test('brandFallbacks keeps six entries — hashIndex indexes by length', () => {
    expect(brandFallbacks).toHaveLength(6);
    expect(new Set(brandFallbacks).size).toBe(6);
  });

  test('roles covers all four badge keys', () => {
    expect(Object.keys(roles).sort()).toEqual([
      'inspector',
      'owner',
      'platform',
      'qa',
    ]);
  });
});

describe('the frozen report palette', () => {
  test('equals the literals the PDF renderer and the branded report shipped with', () => {
    // These are the pdf-lib constants from apps/api/src/reports/report-pdf.ts
    // and the hard-coded verdict colours from branded-report.tsx. A change here
    // changes the look of every report rendered from now on — deliberately hard.
    expect(report).toMatchObject({
      ink: '#0B1220',
      sub: '#5B6573',
      faint: '#9AA3AE',
      line: '#E5E9EF',
      lineSoft: '#F0F3F7',
      fill: '#FAFBFC',
      white: '#FFFFFF',
      pass: '#1F6B43',
      passDot: '#1F8A4C',
      passBg: '#EAF6F0',
      passBorder: '#BEE3CD',
      critical: '#B42318',
      criticalBg: '#FBEAEA',
      criticalBorder: '#F1C9C5',
      criticalDot: '#D14343',
      amber: '#B5791A',
      amberBg: '#FAF1E2',
      amberBorder: '#EBD9B4',
      defaultBrand: '#1457A3',
    });
    expect(report.severity.critical).toEqual({
      key: 'critical',
      label: 'Critical',
      abbr: 'Crit',
      fg: '#B42318',
      bg: '#FBEAEA',
      dot: '#D14343',
    });
    expect(report.severity.major).toEqual({
      key: 'major',
      label: 'Major',
      abbr: 'Maj',
      fg: '#B5791A',
      bg: '#FAF1E2',
      dot: '#D99A20',
    });
    expect(report.severity.minor).toEqual({
      key: 'minor',
      label: 'Minor',
      abbr: 'Min',
      fg: '#475467',
      bg: '#EFF2F6',
      dot: '#8A93A1',
    });
  });

  test('hexToRgb01 matches pdf-lib arithmetic and rejects junk', () => {
    expect(hexToRgb01('#0B1220')).toEqual([0x0b / 255, 0x12 / 255, 0x20 / 255]);
    expect(hexToRgb01('ffffff')).toEqual([1, 1, 1]);
    expect(() => hexToRgb01('#fff')).toThrow();
  });

  test('is independent of the app theme', () => {
    expect(report.ink).not.toBe(light.foreground);
    expect(report.critical).not.toBe(light.destructive);
  });
});

describe('legacy palette alias', () => {
  test('maps every old key onto the light theme', () => {
    expect(palette).toEqual({
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
      assumeBg: '#7A3B00',
    });
  });
});

describe('typography', () => {
  test('native keys have the expo-google-fonts shape', () => {
    for (const fam of Object.values(fontFamilies)) {
      for (const key of Object.values(fam.native)) {
        expect(key).toMatch(/^[A-Za-z]+_\d{3}[A-Za-z]+$/);
      }
    }
  });

  test('nativeFontFor resolves exact and nearest weights', () => {
    expect(nativeFontFor('sans', 600)).toBe('Inter_600SemiBold');
    // Nearest loaded weight wins; on a tie the heavier one does.
    expect(nativeFontFor('heading', 600)).toBe('LibreBaskerville_700Bold');
    expect(nativeFontFor('heading', 500)).toBe('LibreBaskerville_400Regular');
    expect(nativeFontFor('mono', 600)).toBe('JetBrainsMono_700Bold');
  });

  test('every type role names a weight its family ships or can resolve', () => {
    for (const t of Object.values(typeScale))
      expect(() => nativeFontFor(t.family, t.weight)).not.toThrow();
    expect(typeScale.title.family).toBe('heading');
    expect(typeScale.overline.uppercase).toBe(true);
  });
});

describe('icons', () => {
  test('the set is non-trivial, sorted, and every body paints with currentColor', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(80);
    expect([...ICON_NAMES].sort((a, b) => a.localeCompare(b))).toEqual(
      ICON_NAMES,
    );
    for (const body of Object.values(icons))
      expect(body).toContain('currentColor');
  });

  test('navigation, handle and garment glyphs exist', () => {
    for (const n of [
      'home',
      'inspections',
      'library',
      'profile',
      'dragHandle',
      'back',
      'collar',
      'sleeve',
      'zipper',
    ]) {
      expect(isIconName(n)).toBe(true);
    }
    expect(isIconName('nope')).toBe(false);
  });

  test('iconSvg wraps a body in a sized, coloured svg', () => {
    const svg = iconSvg('home', 24, '#3A7D44');
    expect(
      svg.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="#3A7D44">',
      ),
    ).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});

describe('css emitter', () => {
  test('emits the shadcn variable names from the theme', () => {
    const vars = themeToCssVariables(light);
    expect(vars['--primary']).toBe('#3A7D44');
    expect(vars['--chart-5']).toBe('#5C7CFA');
    expect(vars['--radius']).toBe('12px');
    expect(cssBlock(':root', { '--a': '1', '--b': '2' })).toBe(
      ':root {\n  --a: 1;\n  --b: 2;\n}',
    );
  });
});
