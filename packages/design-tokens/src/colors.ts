/**
 * Semantic colour roles (INS-094). One `ThemeColors` shape, one value set per
 * theme. Every colour a screen paints comes from here by ROLE — a screen never
 * says "#3A7D44", it says `primary`. Both platforms compose their own
 * presentation from the same values: React Native puts them straight into a
 * StyleSheet, the web console emits them as CSS variables (`css.ts`).
 *
 * The light values are the reference direction the account owner chose on
 * 2026-09-12 (`design/*.html`): a warm cream canvas, forest-green primary, sand
 * secondary, gold accent, bordered white cards. The `*Strong` members are the
 * same hues darkened for SMALL TEXT on tinted surfaces — the base hues pass
 * WCAG AA on white but not on their own 10 % tints (see `index.test.ts`).
 *
 * `dark` is a first-pass value set so the shape is real from day one; no app
 * resolves it until INS-101.
 */

export type ThemeName = 'light' | 'dark';

export interface ThemeColors {
  /** Page canvas. */
  background: string;
  /** Default text on the canvas. */
  foreground: string;
  /** Card / sheet / header surface. */
  card: string;
  cardForeground: string;
  /** Brand action colour: buttons, active tab, links, progress. Also PASS. */
  primary: string;
  primaryForeground: string;
  /** `primary` darkened for small text on `primarySoft`. */
  primaryStrong: string;
  /** primary @ ~10 % — chip / badge / icon-tile fill. rgba so it composites over card AND canvas. */
  primarySoft: string;
  /** primary @ ~5 % — emphasis-row fill. */
  primaryFaint: string;
  /** Sand: subtle fills, the sign-in card. */
  secondary: string;
  secondaryForeground: string;
  /** Section fills, the input background. */
  muted: string;
  /** Secondary text. */
  mutedForeground: string;
  /** Tertiary text: hints, metadata, placeholders. */
  faint: string;
  /** Gold: highlights, HOLD, the owner badge. Fails as text — use `accentStrong`. */
  accent: string;
  accentForeground: string;
  accentStrong: string;
  accentSoft: string;
  destructive: string;
  destructiveForeground: string;
  destructiveStrong: string;
  destructiveSoft: string;
  /** = primary in the light theme (forest green IS pass); kept separate so dark may diverge. */
  success: string;
  successForeground: string;
  successStrong: string;
  successSoft: string;
  /** Awaiting review / attention. */
  warning: string;
  warningForeground: string;
  warningStrong: string;
  warningSoft: string;
  /** Activity that is not a verdict (IN_PROGRESS, uploading). */
  info: string;
  infoForeground: string;
  infoStrong: string;
  infoSoft: string;
  /** Card and control hairline. */
  border: string;
  /** Row dividers inside a card. */
  borderSoft: string;
  /** Text-input background. */
  input: string;
  /** Focus ring. */
  ring: string;
  /** Modal / sheet backdrop. */
  scrim: string;
  /** Camera stage behind a photo. */
  stage: string;
  /** Text and icons painted over a photo. */
  onImage: string;
  onImageMuted: string;
  /** Categorical chart series, in order. */
  chart: readonly [string, string, string, string, string];
}

export const light: ThemeColors = {
  background: '#FDFCF8',
  foreground: '#1A331C',
  card: '#FFFFFF',
  cardForeground: '#1A331C',
  primary: '#3A7D44',
  primaryForeground: '#FFFFFF',
  primaryStrong: '#2F6A3A',
  primarySoft: 'rgba(58,125,68,0.10)',
  primaryFaint: 'rgba(58,125,68,0.05)',
  secondary: '#E8DDCB',
  secondaryForeground: '#2F4F34',
  muted: '#F2EEE6',
  mutedForeground: '#5C6B5E',
  faint: '#8C9E8D',
  accent: '#DCB878',
  accentForeground: '#1A331C',
  accentStrong: '#7A5C18',
  accentSoft: 'rgba(220,184,120,0.20)',
  destructive: '#CF4444',
  destructiveForeground: '#FFFFFF',
  destructiveStrong: '#B53838',
  destructiveSoft: 'rgba(207,68,68,0.10)',
  success: '#3A7D44',
  successForeground: '#FFFFFF',
  successStrong: '#2F6A3A',
  successSoft: 'rgba(58,125,68,0.10)',
  warning: '#C25E00',
  warningForeground: '#FFFFFF',
  warningStrong: '#9A4B00',
  warningSoft: 'rgba(194,94,0,0.12)',
  info: '#4A63C8',
  infoForeground: '#FFFFFF',
  infoStrong: '#3F55B5',
  infoSoft: 'rgba(92,124,250,0.12)',
  border: '#E6E0D4',
  borderSoft: '#F0ECE3',
  input: '#F2EEE6',
  ring: '#3A7D44',
  scrim: 'rgba(26,51,28,0.45)',
  stage: '#000000',
  onImage: '#FFFFFF',
  onImageMuted: 'rgba(255,255,255,0.85)',
  chart: ['#3A7D44', '#DCB878', '#8C9E8D', '#C25E00', '#5C7CFA'],
};

/** First-pass dark values — the shape ships now, resolution is INS-101. */
export const dark: ThemeColors = {
  background: '#141B15',
  foreground: '#EDEBE3',
  card: '#1C2520',
  cardForeground: '#EDEBE3',
  primary: '#5FA36B',
  primaryForeground: '#0F1A11',
  primaryStrong: '#8CC796',
  primarySoft: 'rgba(95,163,107,0.16)',
  primaryFaint: 'rgba(95,163,107,0.08)',
  secondary: '#3A3428',
  secondaryForeground: '#E8DDCB',
  muted: '#232C25',
  mutedForeground: '#A3B0A5',
  faint: '#6F7F72',
  accent: '#DCB878',
  accentForeground: '#1A331C',
  accentStrong: '#E3C48C',
  accentSoft: 'rgba(220,184,120,0.18)',
  destructive: '#E06B6B',
  destructiveForeground: '#1A0F0F',
  destructiveStrong: '#F09A9A',
  destructiveSoft: 'rgba(224,107,107,0.16)',
  success: '#5FA36B',
  successForeground: '#0F1A11',
  successStrong: '#8CC796',
  successSoft: 'rgba(95,163,107,0.16)',
  warning: '#E08A3C',
  warningForeground: '#1A1008',
  warningStrong: '#F2B27A',
  warningSoft: 'rgba(224,138,60,0.16)',
  info: '#7D93E8',
  infoForeground: '#0F1424',
  infoStrong: '#A9B8F2',
  infoSoft: 'rgba(125,147,232,0.16)',
  border: '#2E3A31',
  borderSoft: '#26312A',
  input: '#232C25',
  ring: '#5FA36B',
  scrim: 'rgba(0,0,0,0.60)',
  stage: '#000000',
  onImage: '#FFFFFF',
  onImageMuted: 'rgba(255,255,255,0.85)',
  chart: ['#5FA36B', '#DCB878', '#8C9E8D', '#E08A3C', '#7D93E8'],
};

export const themes: Readonly<Record<ThemeName, ThemeColors>> = { light, dark };
