/**
 * Inspect design tokens — platform-free (INS-086 Phase 1, rebuilt in INS-094).
 *
 * What is DELIBERATELY not here: anything expressed as CSS or as a React Native
 * style. `var(--font-sans)` is a web variable and `CSSProperties` is a DOM
 * type; a `StyleSheet` is a native one. This package exports VALUES — semantic
 * colour roles, a type scale, spacing/radius/shadow parameters, icon paths, and
 * the frozen report palette — and each platform composes its own presentation:
 * `apps/web/components/inspect/tokens.ts` and `apps/mobile/src/theme`.
 *
 * Module map (`docs/reference/design-system.md` is the human-readable version):
 * - colors     — `ThemeColors`, `light`, `dark`, `themes`
 * - typography — `fontFamilies`, `nativeFontFor`, `typeScale`, the CSS stacks
 * - layout     — `space`, `radius`, `shadow`, `MIN_TARGET`, `TAB_BAR_HEIGHT`
 * - semantic   — `toneColors`, `statusTone`, `qaDecisionTone`, `verdictTone`,
 *                `severity`, `severityByWire`, `roles`, `brandFallbacks`
 * - report     — the FROZEN document palette + `hexToRgb01`
 * - icons      — `icons`, `IconName`, `iconSvg` (generated)
 * - css        — `themeToCssVariables`, `cssBlock`
 * - legacy     — `palette` (@deprecated alias for the migration)
 */
export * from './colors';
export * from './typography';
export * from './layout';
export * from './semantic';
export * from './report';
export * from './icons';
export * from './css';
export { palette } from './legacy';
