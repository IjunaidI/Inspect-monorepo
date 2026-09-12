# Inspect design system (v2, 2026-09)

> Evergreen reference. The values live in code — `packages/design-tokens/src/` — and this page explains
> them. Direction and decisions: [the 2026-09-12 spec](../in-progress/specs/2026-09-12-inspect-design-revamp-design.md).
> Mockups: the *Inspect Mobile v2* canvas (link in the spec; source `design/inspect-canvas/`).

## Principles

1. **Roles, not hexes.** A screen paints `primary`, `mutedForeground`, `border` — never a literal. The
   only hex literals in an app live in the token package (and, on mobile, `src/theme`).
2. **Values are platform-free; presentation is per platform.** `@inspect/design-tokens` exports data. The
   web composes CSS variables and `CSSProperties` (`apps/web/components/inspect/tokens.ts`); React Native
   composes `StyleSheet`s (`apps/mobile/src/theme`). Nothing in the package mentions `var(--…)` or a
   `StyleSheet`.
3. **The signed report is a document, not chrome.** It reads the frozen `report` palette and must look
   the same on screen (`branded-report.tsx`) and in the PDF (`report-pdf.ts`) regardless of the app
   theme. Its brand colour is *data* from the frozen `brandingSnapshot`.
4. **One component vocabulary per platform.** Mobile: `apps/mobile/src/components/ui/`. Web:
   `apps/web/components/inspect/`. Do not add a second.

## Colour

Semantic roles (`ThemeColors`, themes `light` and `dark` — dark is unresolved until INS-101):

| Role | Light | Use |
|---|---|---|
| `background` | `#FDFCF8` | page canvas (cream) |
| `foreground` | `#1A331C` | body text |
| `card` / `cardForeground` | `#FFFFFF` / `#1A331C` | cards, sheets, headers |
| `primary` / `primaryForeground` | `#3A7D44` / `#FFFFFF` | actions, active tab, links, progress, **PASS** |
| `primaryStrong` | `#2F6A3A` | primary as small text on a tint |
| `primarySoft` / `primaryFaint` | 10 % / 5 % rgba of primary | chip fills / emphasis rows |
| `secondary` / `secondaryForeground` | `#E8DDCB` / `#2F4F34` | sand fills, the sign-in card |
| `muted` / `mutedForeground` | `#F2EEE6` / `#5C6B5E` | section fills, inputs / secondary text |
| `faint` | `#8C9E8D` | hints, placeholders, tertiary text |
| `accent` / `accentStrong` / `accentSoft` | `#DCB878` / `#7A5C18` / 20 % | gold: HOLD, the owner badge, highlights |
| `destructive` / `destructiveStrong` / `destructiveSoft` | `#CF4444` / `#B53838` / 10 % | FAIL, delete, critical |
| `success*` | = `primary*` | kept separate so dark may diverge |
| `warning*` | `#C25E00` / `#9A4B00` / 12 % | awaiting review, major |
| `info*` | `#4A63C8` / `#3F55B5` / 12 % | IN_PROGRESS, uploading — activity is never a verdict colour |
| `border` / `borderSoft` | `#E6E0D4` / `#F0ECE3` | card hairline / row dividers |
| `input` · `ring` · `scrim` | `#F2EEE6` · `#3A7D44` · `rgba(26,51,28,.45)` | |
| `stage` · `onImage` · `onImageMuted` | `#000` · `#FFF` · 85 % white | the camera stage and text over photos |
| `chart[0..4]` | `#3A7D44 #DCB878 #8C9E8D #C25E00 #5C7CFA` | categorical series |

**Why the `*Strong` members exist:** the base hues pass WCAG AA on white but fail on their own 10 %
tints (green 4.4:1, orange 3.7:1, red 4.0:1). `toneColors()` uses the strong member for chip and
badge text; the base hue stays for fills, icons, dots and buttons. `index.test.ts` enforces ≥ 4.5:1 for
every tone pair over both `card` and `background`.

### Tones and semantic maps (`semantic.ts`)

- `Tone = neutral | primary | success | info | warning | danger | accent`; `toneColors(theme, tone)` →
  `{ fg, bg, dot }`.
- `statusTone` (every `InspectionStatus`, compile-checked): DRAFT/ASSIGNED neutral · IN_PROGRESS info ·
  SUBMITTED/UNDER_REVIEW warning · APPROVED/REPORT_ISSUED success · REJECTED danger · HOLD accent.
- `qaDecisionTone`, `verdictTone` (pass/fail/hold/pending).
- `severity` (critical/major/minor: `fg bg dot label abbr`) for app chrome; `severityByWire` maps the
  wire enum. `roles` (inspector/qa/owner/platform). `brandFallbacks` — **six** entries, indexed by
  `hashIndex(companyId)` from `@inspect/domain`.

### The frozen report palette (`report.ts`)

`ink #0B1220 · sub #5B6573 · faint #9AA3AE · line #E5E9EF · lineSoft #F0F3F7 · fill #FAFBFC · pass
#1F6B43 (dot #1F8A4C, bg #EAF6F0, border #BEE3CD) · critical #B42318 (bg #FBEAEA, border #F1C9C5, dot
#D14343) · amber #B5791A (bg #FAF1E2, border #EBD9B4) · defaultBrand #1457A3` plus its own `severity`
table and `fontFeatureSettings`. `hexToRgb01()` feeds pdf-lib. Pinned by tests in the package and in
`apps/api/src/reports/report-pdf.spec.ts`.

## Typography (`typography.ts`)

| Role | Family | Weight | Size / line | Use |
|---|---|---|---|---|
| `display` | Libre Baskerville | 400 | 32 / 38 | hero numbers |
| `title` | Libre Baskerville | 400 | 24 / 30 | page header, stat values |
| `heading` | Libre Baskerville | 400 | 18 / 24 | section titles, sheet titles |
| `subheading` | Inter | 700 | 16 / 22 | card headers |
| `body` / `bodyStrong` | Inter | 400 / 700 | 14 / 20 | text / list-row titles |
| `label` | Inter | 700 | 12 / 16 | stat labels, tile labels |
| `caption` | Inter | 500 | 11 / 14 | row subtitles, hints |
| `overline` | Inter | 700 | 10 / 14, +1.2 tracking, uppercase | section labels |
| `button` · `tab` | Inter | 700 · 500 | 14 / 18 · 10 / 12 | |
| `mono` · `monoSmall` | JetBrains Mono | 500 · 400 | 13 / 18 · 11 / 14 | ids, hashes, measurements |

`fontFamilies[role].native[weight]` are the expo-google-fonts asset keys (`Inter_600SemiBold`,
`LibreBaskerville_700Bold`, `JetBrainsMono_500Medium`); `nativeFontFor(role, weight)` resolves a weight
the family does not ship to the nearest one. **On React Native the weight is part of the family name —
never emit `fontWeight` with a custom family** (Android will not synthesise it). Web loads the same
families through `next/font/google` and composes `var(--font-sans|heading|mono), <stack>`.

## Layout (`layout.ts`)

- `space` — 4-pt grid, Tailwind-numbered: `1→4 2→8 3→12 4→16 5→20 6→24 8→32 10→40 12→48 16→64`.
- `radius` — `xs 4 · sm 8 · md 10 · lg 12 · xl 16 · 2xl 20 · full`. Cards `xl`, list cards `2xl`,
  buttons/inputs `lg`/`md`, chips `full`.
- `shadow` — parameters `{ y, blur, opacity, elevation }`: `sm {1, 2, .05, 1}` (cards), `md {4, 12, .08,
  3}` (lifted rows, sheets), `lg {12, 32, .12, 8}` (dragging). Cards are border-defined; the shadow is a
  whisper. Android: `elevation` needs an opaque background and no `overflow: hidden` on the same view.
- `MIN_TARGET = 44` (touch floor), `TAB_BAR_HEIGHT = 64` (+ bottom inset).

## Icons (`icons.ts`, generated by `scripts/build-icons.mjs`)

Curated set of ~90 inline SVG bodies on a 24×24 viewBox, painted with `currentColor`:

- **Solar Bold** for navigation and actions (`home inspections library profile camera check close add
  search settings signOut …`).
- **Solar Linear** for chevrons, the drag handle and content outlines (`back forward chevronRight
  dragHandle tshirtOutline tagOutline …`).
- **Custom garment glyphs** (linear weight) for the capture-point library: `collar neckhole sleeve cuff
  shoulder placket pocket hem seam yoke zipper waistband polybag print`.

`iconSvg(name, size, color)` returns a complete `<svg>` string — what react-native-svg's `SvgXml`
renders. Mobile screens use `<Icon name size color />` from `src/components/ui/icon.tsx` and never
import the package's icon map directly. Web keeps `lucide-react` for now (INS-100 may switch).

**Attribution:** Solar icons © [480 Design](https://www.figma.com/@480design), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The garment glyphs are Inspect's own.

## Patterns (mobile kit, INS-095)

Page header (card bg, hairline, `title`, optional 40 px round bordered back, one text action) ·
`SectionLabel` (`overline`, mutedForeground) · `SectionHeading` (`heading` + text action) · `Card`
(card bg, 1 px border, radius xl, shadow sm; `tone=emphasis` = primaryFaint bg + primarySoft border) ·
`StatCard` (dot + `label`, `title` value, `caption` delta) · `ListRow` (bold title, caption subtitle,
right metric / chip / chevron; `inset` inside a `ListCard` with `borderSoft` dividers) · `IconTile`
(48 / 40 px, radius lg, tinted) · `Chip` (32–36 px, `muted` inactive, `primarySoft` + primary border
active) · `Badge`/`StatusChip` (22 px, radius 6, `label`, `toneColors`) · `Button`
(primary/secondary/ghost/destructive, 48 px, radius lg) · `Sheet` (scrim, card, radius 2xl top,
grabber) · `TabBar` (64 px + inset, card @ 95 %, top hairline, 24 px icon + `tab` label, active
primary) · `ProgressBar` (8 px, `input` track).

## Migration state

- `palette` (the pre-v2 keys) is a `@deprecated` alias onto `light` in `legacy.ts`; it flips every old
  consumer to the v2 colours and is deleted in the last INS-096 batch. Do not use it in new code.
- Web consumers read `ui.*` from `apps/web/components/inspect/tokens.ts` (the alias + font variables)
  until INS-100 re-points the console at CSS variables from `themeToCssVariables(light)`.
