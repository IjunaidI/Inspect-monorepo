# Inspect — design revamp, capture-point library, drag-and-drop builder — Plan

> Spec: [../specs/2026-09-12-inspect-design-revamp-design.md](../specs/2026-09-12-inspect-design-revamp-design.md).
> Backlog: [INS-094 … INS-101](../../future/BACKLOG.md). Canvas:
> <https://claude.ai/code/artifact/8782e116-a6db-4647-9fc2-6f9ecc0f491a> (source `design/inspect-canvas/`).
> Each phase ends with its gate green **and** STATUS.md updated. Phases 2 and 3 touch disjoint files and
> may run in parallel.

## Phase 0 — Design canvas + docs skeleton ✅ 2026-09-12

- [x] Eight artboards at 390×844 in the new tokens: Home (QA), Home (inspector), Inspections, Library,
      Profile, Loop builder (dragging), Loop builder (add capture points), Capture. Generator
      `design/inspect-canvas/build.mjs`; icons from `solar-icons.json` + custom garment glyph drafts.
- [x] Spec + this plan; BACKLOG INS-094…INS-101.
- [ ] App icon + splash artwork re-coloured (SVG source `apps/mobile/assets/brand/`, rasterised with the
      workspace's `sharp`) — folded into Phase 2 with the `app.json` change.

## Phase 1 — Tokens v2 + frozen report palette (INS-094) ✅ 2026-09-12 (emulator gate passed)

Landed: `packages/design-tokens/src/{colors,typography,layout,semantic,report,icons,css,legacy,index}.ts`
+ `index.test.ts` (24) + `scripts/build-icons.mjs` (96 icons from `icons/solar-icons.json` + 14 custom
garment glyphs); `apps/web/components/inspect/tokens.test.ts` re-pinned; `branded-report.tsx` reads
`report.*` with its own `ReportSeverityTag`/`ReportUnverifiedBadge`; `apps/api` depends on the package and
`report-pdf.ts` derives its pdf-lib constants from `report` (+ parity pin in the spec);
`docs/reference/design-system.md`; `CLAUDE.md` design lines. Gates green: tokens 24/24 · web 60/60 ·
api 692/43 · mobile 46/4 · type-check api/web/mobile · lint web/mobile · emulator `/inspections` cream + forest.

1. `packages/design-tokens`: add `vitest` (mirror `packages/domain/package.json`), type-only dep on
   `@inspect/shared-types`; split `src/index.ts` into `colors | typography | layout | semantic | report |
   icons | legacy | css`; `index.ts` re-exports. Tests in `src/index.test.ts`.
2. `apps/web/components/inspect/tokens.test.ts` re-pinned to the alias values; `branded-report.tsx` →
   `report.*` (layout untouched; `data.client.color` stays the brand source).
3. `apps/api` adds `@inspect/design-tokens`; `report-pdf.ts` derives its `rgb()` constants from `report`
   via `hexToRgb01`; a spec pins the derived values to the old literals.
4. Docs: `docs/reference/design-system.md` v1; `CLAUDE.md` design-system lines.
- **Gate:** `pnpm type-check`; `pnpm test` (api, web, domain, api-client, tokens); emulator screenshot of
  `/inspections` already cream + forest via the alias.

## Phase 2 — Mobile foundation (INS-095) ✅ 2026-09-12 · Phase 4 tabs (INS-099 + M2) ✅ 2026-09-12

Landed (details in the INS-095 / INS-099 `done:` lines): theme + fonts behind the splash, `Icon`, the
full kit under `src/components/ui/`, `Stack.Protected` session gate with `SessionProvider`,
`(app)/(tabs)` tree with the custom `TabBar` (Library hidden below QA), every route moved under `(app)/`,
`/dashboard` → `/`, `HOME_HREF = '/'`, app.json colours + artwork script, `/auth/me` returns `email` +
`name`. The four tabs are the real screens (Home, Inspections with search + bucket chips, Library hub,
Profile). Verified on the emulator for both roles; deep link OK; tsc/lint/46 tests green. **Deferred to
Phase 7 (M7):** deleting the shims (`back-button.tsx`, `form-screen.tsx`, `quick-create-sheet.tsx`,
`ui/legacy.tsx`) once the remaining screens stop importing them.

1. `npx expo install react-native-svg @expo-google-fonts/inter @expo-google-fonts/libre-baskerville
   @expo-google-fonts/jetbrains-mono expo-haptics`.
2. `src/theme/{fonts,index}.ts`; `src/components/ui/icon.tsx`; `src/lib/session-context.tsx`.
3. Root layout (fonts + session behind the splash, `GestureHandlerRootView`, `Stack.Protected`); delete
   `src/app/index.tsx`; `(app)/_layout.tsx`, `(app)/(tabs)/_layout.tsx` + `TabBar`; file moves;
   `(app)/dashboard.tsx` → redirect; `HOME_HREF = '/'` (+ test); `fallbackHref` updates.
4. `app.json` colours + artwork.
5. Kit in `src/components/ui/` with the old names re-exported from the barrel until Phase 7.
- **Gate:** cold start → Home; inspector sees 3 tabs; both deep links cold + warm (`npx uri-scheme open`);
  `expo export` size delta recorded (budget +2 MB assets / +1.5 MB JS); 46 tests untouched; type-check; lint.

## Phase 3 — Capture-point library (INS-097) ✅ 2026-09-12

Landed and verified (details in the INS-097 `done:` line): shared-types enums/DTOs + wire-contract
registrations · domain `capture-points.ts` / `presets.ts` (moved from web, both apps re-pointed) /
`home.ts` (59 tests) · Prisma `CatalogScope` rename + `CapturePointCategory` + `CapturePoint` +
`PresetLoopItem.capturePointId`, migration applied to the dev DB, `migrate diff` empty · 55-row seed,
idempotent · `src/capture-points/` module + spec (11) · loop-presets lineage validation/persist/join +
spec (4) · snapshot key pin · integration `capture-points.e2e-spec.ts` 6/6 · `openapi.json` regenerated ·
type-check api/web/mobile · lint on new files. **Not touched (by design):** the inspection snapshot
builder, `InspectionLoopItem`, every signed-artifact path.

1. shared-types enums + DTOs; wire-contract registrations.
2. domain: `capture-points.ts`, `presets.ts` (move `latestPresetPerName`, re-point web
   `create-form.tsx` in the same change), `inspection-status.ts` additions; tests.
3. Prisma: `CatalogScope` rename (hand-edit to `ALTER TYPE … RENAME`), `CapturePointCategory`,
   `CapturePoint`, `PresetLoopItem.capturePointId`; migration `20260912000000_capture_point_library` with
   the partial unique index + CHECK. **Confirm which `DATABASE_URL` is loaded first.**
4. Seed data file `apps/api/prisma/capture-points.seed-data.ts` + `seed.ts` loop; template↔seed spec.
5. `apps/api/src/capture-points/` module + spec; `loop-presets.service.ts` validate/persist/include;
   `inspection-mapping.spec.ts` key pin; integration `capture-points.e2e-spec.ts`; `pnpm api openapi:generate`.
- **Gate:** migrate + seed twice (0 created on the second run); `jest --runInBand`; integration; domain
  tests ~55; `openapi.json` regenerated; type-check.

## Phase 4 — The four tabs for real (INS-099 + INS-096 M2)

Home (greeting header, quick-start carousel, 2×2 StatCards, Recent), Inspections (search, chips, ListRow +
StatusChip, Skeleton, EmptyState), Library (ListCard of role-filtered rows), Profile (Avatar, role Badge,
ListCard, Sign out). **Gate:** screenshots vs the canvas for `qa.mobile@` and `inspector.mobile@`.

## Phase 5 — Drag-and-drop loop builder (INS-098, mobile)

`react-native-sortables`; `Screen.scrollRef`; `presets/new.tsx` → orchestrator over
`src/components/preset-builder/*`; detail icons; list "Duplicate". **Gate:** the emulator script in the
backlog item (add 6 → drag → edit-sheet move → Custom… → save → detail order → "Yours" in the chooser).

## Phase 6 — Capture, Review, Report re-skin (INS-096 M3–M4)

Capture restyle with zero `src/lib` changes; Review and Report on the kit. **Gate:** INS-093 emulator path
re-run + airplane-mode strip; PASS and FAIL report screenshots.

## Phase 7 — Remaining screens + cleanup (INS-096 M5–M7)

New inspection, companies ×3, users, products ×3, purchase-orders ×3, reports, login, invite; then delete
the alias and the absorbed files; ESLint `no-restricted-imports`; grep gate for hex / `rgba(` /
`fontWeight:` outside `src/theme`.

## Phase 8 — Web follow-through (INS-100)

W1 CSS variables from `themeToCssVariables`; W2 `next/font/google`; W4 shell re-skin + `field.test.tsx`
radius; web builder `@dnd-kit/sortable` + library panel; `actions.ts` imports from shared-types.
**Gate:** `pnpm web test`, `type-check`, `next build`, Chrome click-through.

## Phase 9 — Device pass; dark mode parked (INS-101)

Fold into the INS-086 phone acceptance (`eas build --profile preview --platform android`).

## Docs touched every phase

BACKLOG item status + `done:` lines · STATUS "Last verified" + pillar rows · `screen-migration-map.md`
"Visual v2" column · `docs/reference/design-system.md` · `CLAUDE.md` (`:60-63` stale mobile test note,
`:67`, `:169`, seed description) · README design lines · `inspect-schema.md` (flag stale INS-081 shape;
add `CapturePoint`) · `.claude/skills/migrate-screen/SKILL.md` step 5.
