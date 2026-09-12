# Backlog — Inspect

> Source of truth for remaining work. Severity-grouped. Every item has a stable `INS-NNN` id —
> plans and commit messages reference items by id, and ids are never reused.
> Keep each `status` current (see [../../CLAUDE.md](../../CLAUDE.md) → Documentation workflow). Dashboard: [../STATUS.md](../STATUS.md).
>
> **Trimmed 2026-09-02:** the 83 closed items (and their full status histories) moved to
> [../done/2026-09-02-backlog-archive.md](../done/2026-09-02-backlog-archive.md). Only open items
> live here. A reference to a closed `INS-NNN` resolves in the archive.

**Item template**
```
### INS-NNN · <title>   [SEVERITY]
- status: todo            # todo | in-progress | done | wont-fix
- area: <subsystem>
- evidence: <file:line or doc>
- problem: <what's wrong>
- fix: <intended change>
- verify: <a concrete, checkable condition>
- refs: <links to spec/plan, or —>
```

Severity: **BLOCKER** = must clear before any real deploy · **HIGH** = core MVP completeness · **MEDIUM** = correctness/robustness hardening · **LOW** = cosmetic/test-debt.

---

## Blockers

### INS-002 · Committed real-looking secrets in `.env.example`   [BLOCKER]
- status: in-progress    # user-side only. `.env.example` is scrubbed (verified). Remaining: the old dev Railway credentials sit unrotated in git history — rotate or abandon that project. When any environment is minted (the INS-090 remote dev one included, and non-negotiably production later): generate a FRESH Ed25519 `REPORT_SIGNING_PRIVATE_KEY_PEM` there; a signing key that has sat on a dev machine or in a repo must never sign anything trusted.
- area: Infra & CI
- evidence: git history of `.env.example` (pre-scrub revisions carry real-shaped `POSTGRES_PASSWORD`/`REDIS_PASSWORD`/`DATABASE_URL`).
- problem: Live-shaped credentials shipped in git; anything still live must be rotated (or the project abandoned) before a real deploy, or tenant isolation + the signing guarantee are compromised.
- fix: Rotate/abandon the old Railway project's credentials; secret-scan history; mint a fresh signing keypair per environment.
- verify: A secret scan of tracked files + history finds no live credential; any keypair that ever appeared in a commit is rotated/revoked.
- refs: [../done/2026-09-02-backlog-archive.md](../done/2026-09-02-backlog-archive.md) (full history)

---

## High

### INS-090 · The API is not deployed anywhere — a phone cannot reach it   [HIGH]
- status: done
- done: 2026-09-02 — the API was already auto-deploying to Railway project **QCLink** (service `Main Application`, from GitHub `main`, `apps/api/Dockerfile`) but answered 502 on every request: Railway routed to its injected `PORT` while the API listens on `API_PORT`. Fixed the domain's target port (3000) + `API_PORT=3000` + `PORT=3000` (Railway health-checks on `PORT` too); added the missing `REPORT_SIGNING_PRIVATE_KEY_PEM` (**fresh** Ed25519, minted for this environment), `ALLOWED_ORIGINS`, `WEB_BASE_URL`, `RATE_LIMIT_TRUSTED_PROXIES=1`; set the service settings (`/health` check, pre-deploy `prisma migrate deploy` + seed, start command) — mirrored in the new `apps/api/railway.json`, which can become the config-file authority once it is on GitHub main (a config path to a file absent from main fails the deploy at SNAPSHOT_CODE). Pre-deploy must be `sh -c "…"` — Railway runs the string without a shell, so a bare `a && b` silently ran only the migrate; proven by a new bootstrap password logging in 401 → 201. From-source deployment `4efbcfe4` passed every step incl. PRE_DEPLOY_COMMAND ("Seed complete", "Bootstrap Platform Admin ready") and HEALTHCHECK. Verified from outside the LAN: `GET /health` → db + redis up; `POST /auth/login` → tokens; `GET /auth/me` → PLATFORM_ADMIN; CORS header echoes the console origin; `/docs` 404 (production). Real origins written into `apps/mobile/eas.json`. Runbook: [../reference/deploy-railway.md](../reference/deploy-railway.md). Note: `railway.json` is deprecated by Railway after 2026-12-01 (migrate to `.railway/railway.ts`).
- area: Infra & CI
- evidence: `INSPECT_API_URL` defaults to `http://localhost:3000`; no deploy has ever run.
- problem: The INS-086 device acceptance needs a reachable HTTPS origin — a phone cannot resolve `localhost`.
- fix: Deploy `apps/api` (root build context, `apps/api/Dockerfile`). **Build:** `pnpm install --frozen-lockfile` + `pnpm build:api` (never a bare `--filter` build). **Start:** `node dist/main` from `apps/api`. **Release:** `prisma migrate deploy` + seed once. **Env (all required to boot):** `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `REPORT_SIGNING_PRIVATE_KEY_PEM` (mint fresh — INS-002), `S3_*`, `ALLOWED_ORIGINS` widened. Node 20+, pnpm 9.12.0. Health: `GET /health`.
- verify: `GET https://<host>/health` reports db+redis up from a device off the local network; a phone-browser login round-trip works.
- refs: spec [../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md](../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md) §6 · gates the [INS-086](BACKLOG.md) device pass · [INS-002](BACKLOG.md) related, not gating

### INS-086 · EPIC: React Native app (iOS + Android) — console parity minus Platform Admin, plus camera   [HIGH]
- status: in-progress    # 2026-09-02: **PHASE 4 IS CODE-COMPLETE — every screen-migration-ledger row is BUILT** (25 routes bundle green; ledger: [../reference/screen-migration-map.md](../reference/screen-migration-map.md)). Phases 1–3 shipped earlier (shared packages · scaffold+auth · capture loop w/ offline photo queue + mobile's Vitest suite). The sweep also fixed six live web bugs, turned two API P2002 500-leaks into 409s (duplicate styleNumber / poNumber), grew `@inspect/domain` to 29 tests (status sets+buckets, report display, ranking, hashing), and moved ~14 wire shapes into `@inspect/shared-types`. **The epic now waits on exactly one thing (user decision 2026-09-02: verify ONCE, after Phase 4): the on-device acceptance pass. [INS-090](BACKLOG.md) is done and `eas.json` carries the real origins (`EXPO_PUBLIC_INSPECT_API_URL` + `EXPO_PUBLIC_INSPECT_WEB_URL`) as of 2026-09-02 — what remains is `eas build --profile preview --platform android` and walking the ledger on the phone.** Known deferrals recorded in the ledger: preset reference-image upload + company-logo upload (both need an expo-image-picker decision); direct add-member stays web-only. Full phase-by-phase history: the archive + git log.
- area: Mobile / Architecture
- evidence: `apps/mobile` (Expo SDK 57, expo-router, RN 0.86) — 25 routes; the four shared packages; the ledger.
- problem: The product needs a native app for the one job a phone is required for — the guided capture cycle with a camera, offline-tolerant, in a factory.
- fix: Approach A — shared `@inspect/{shared-types,api-client,domain,design-tokens}`; UI per platform; the §4.4 re-point rule (a rule moving to domain re-points web in the same change) is non-negotiable.
- verify: An inspector completes a real multi-cycle inspection on a physical device, offline for part of it, and submits; every ledger row's on-device acceptance checked in the single post-Phase-4 pass.
- refs: spec [../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md](../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md) · ledger [../reference/screen-migration-map.md](../reference/screen-migration-map.md) · procedure: the `migrate-screen` skill · `/admin/orgs`, `/portal`, `/r/[token]` permanently web-only

### INS-091 · Pickers cannot create what is missing — four-screen detour to start an inspection   [HIGH]
- status: done
- done: 2026-09-04 — `EntityPicker` (web) / grown `OptionPicker` (mobile) are searchable via the shared `filterOptions` and end in "+ Add new…"; company, product and PO quick-create dialogs/sheets (nested one level) append + select; web `Modal` (portal, focus trap, stack, scroll lock) + `ErrorBanner` replaced every `alert()`; mobile `FormScreen` gives every form keyboard avoidance + persistent taps; `/companies` on mobile can create; both new-inspection forms lost their dead-end empty state and honour the client's `defaultLoopPresetId`. First web component tests (jsdom + Testing Library): `modal.test.tsx`, `entity-picker.test.tsx`. API: `POST /purchase-orders` now answers in the list/get shape (parties included) — found by the browser click-through, where a just-created PO showed "—" for its parties. Verified 2026-09-04 in Chrome (`/inspections/new` → nested PO → company dialogs → inspection created) and on the Android emulator (same nested flow via sheets; one tap on Create works with the keyboard up).
- area: Console + mobile (forms/pickers) / shared contract
- evidence: `apps/web/app/(console)/inspections/new/create-form.tsx` (former dead-end paragraph), `apps/mobile/src/app/inspections/new.tsx` ("create … in the console first"), no `/companies/new` on mobile.
- problem: Every related-entity picker was an unsearchable list with no create path; starting an inspection on a fresh org meant four screens (two on another platform for mobile) and the form's typed state was lost.
- fix: Inline quick-create from pickers on both platforms + the friction blockers on the same screens.
- verify: On an org with zero POs, `/inspections/new` on web and mobile reaches a created inspection without leaving the screen; `grep alert(` finds nothing under `apps/web/app/(console)`.
- refs: spec [../done/specs/2026-09-04-inline-create-and-friction-design.md](../done/specs/2026-09-04-inline-create-and-friction-design.md) · plan [../done/plans/2026-09-04-inline-create-and-friction.md](../done/plans/2026-09-04-inline-create-and-friction.md)

---

### INS-094 · Design tokens v2 + frozen report palette   [HIGH]
- status: done
- done: 2026-09-12 — `packages/design-tokens/src/{colors,typography,layout,semantic,report,icons,css,legacy}.ts` + `index.test.ts` (24 tests incl. WCAG ≥ 4.5 for every tone pair over card and canvas; `*Strong` text variants exist because the base green/orange/red fail on their own tints); `scripts/build-icons.mjs` generates a 96-icon SVG map (82 Solar, 14 custom garment glyphs) from `icons/solar-icons.json`. `palette` is the `@deprecated` alias onto `light`. Web: `tokens.test.ts` re-pinned; `branded-report.tsx` reads `report.*` via its own `ReportSeverityTag`/`ReportUnverifiedBadge` (same wording as the shell's). API: `@inspect/design-tokens` dependency; `report-pdf.ts` derives its pdf-lib constants from `report` (+ parity pin in `report-pdf.spec.ts`, 692/43). Docs: `docs/reference/design-system.md`, `CLAUDE.md:67/169`. Verified: tokens 24/24 · web 60/60 · api 692/43 · mobile 46/4 · type-check api/web/mobile · lint web/mobile · **emulator**: `/inspections` renders cream + forest with zero screen edits.
- area: Shared packages (`@inspect/design-tokens`) / web + API report renderers
- evidence: `packages/design-tokens/src/index.ts` is 75 lines: a 12-colour `palette`, two font stacks, severity/role maps — no type scale, spacing, radius, shadow, success/warning tokens. 30 mobile files and ~50 web files import it directly; `apps/api/src/reports/report-pdf.ts` re-declares the palette as pdf-lib constants "keep in sync by value".
- problem: The product has no design system to re-skin against — every screen hand-rolls its numbers, and the reference direction the user picked (`design/*.html`: cream/forest/sand/gold, Inter + Libre Baskerville + JetBrains Mono, 12px radius, bordered cards) has nowhere to land.
- fix: Split the package into `colors` (semantic `ThemeColors`, `light` + `dark` shapes), `typography` (font families with native keys + a type scale), `layout` (space/radius/shadow/MIN_TARGET), `semantic` (tones, `statusTone`, `verdictTone`, re-coloured severity/roles/brandFallbacks), `report` (the FROZEN document palette both renderers read), `icons` (curated Solar + garment-glyph path map), `legacy` (`@deprecated palette` alias onto the new theme), `css` (variable emitter). Vitest in the package; web `tokens.test.ts` re-pinned; `branded-report.tsx` and `report-pdf.ts` read `report.*`.
- verify: `pnpm type-check` + every suite green; the alias flips both apps to the new palette with no screen edits; `report.*` values equal the old PDF literals (test); WCAG ≥ 4.5 for every tone fg/bg pair (test).
- refs: spec [../in-progress/specs/2026-09-12-inspect-design-revamp-design.md](../in-progress/specs/2026-09-12-inspect-design-revamp-design.md) · plan [../in-progress/plans/2026-09-12-inspect-design-revamp.md](../in-progress/plans/2026-09-12-inspect-design-revamp.md) · canvas source `design/inspect-canvas/`

### INS-095 · Mobile foundation: fonts, icons, theme, tabs, component kit   [HIGH]
- status: done
- done: 2026-09-12 — **Deps:** `react-native-svg` 15.15.4, `@expo-google-fonts/{inter,libre-baskerville,jetbrains-mono}`, `expo-haptics` (all Expo Go-safe). **Theme:** `src/theme/{index,fonts}.ts` — `theme`, `useTheme()`, `text(role)` (never emits `fontWeight`), `elevation()`, `tone()`, nine font faces held behind the splash. **Kit** `src/components/ui/`: `Icon` (SvgXml over the token map), `Button`/`TextButton`/`ButtonRow`, `Field`/`Input`/`Textarea`, `Chip`, `Badge`/`StatusChip`/`SeverityBadge`, `Card`/`ListCard`, `ListRow`, `StatCard`/`Grid` (unwraps Fragments), `IconTile`, `Header`/`BackButton` (circle + text variants), `Screen` (absorbs `FormScreen`), `Section*`, `Sheet` (sheet/dialog/full; absorbs `QuickCreateSheet`), `ProgressBar`, `EmptyState`/`ErrorState`/`Skeleton`, `TabBar`, `Avatar`; `legacy.tsx` keeps the old `ui` StyleSheet re-coloured; `back-button.tsx`/`form-screen.tsx`/`quick-create-sheet.tsx` are shims. **Navigation:** root `_layout.tsx` holds the splash until fonts + session resolve, `GestureHandlerRootView`, `SessionProvider` (`src/lib/session-context.tsx`, fed by `subscribeSession()` in `session.ts` so every existing `signIn`/`signOut` flips the guard), `Stack.Protected` for `(app)` vs `login`, `invite` public; `(app)/_layout.tsx` anchored on `(tabs)`; `(app)/(tabs)/_layout.tsx` = Home · Inspections · Library (`href: null` below QA) · Profile with the custom `TabBar`; every other route moved under `(app)/` unchanged (URLs identical); `/dashboard` redirects to `/`; `HOME_HREF = '/'`, `LIBRARY_HREF`; `app.json` cream/forest colours; `assets/brand/build-icons.mjs` regenerates the icon/adaptive/splash artwork (placeholder collar mark). `/auth/me` now also returns `email` + `name` (mobile greets by name; the JWT carries neither). **Verified on the emulator (Expo Go → Railway API):** cold start → splash → Home with serif title, Solar tabs; QA sees 4 tabs, inspector 3; Sign out → login → sign in as inspector → Home flips through the guard with no explicit navigation; `exp://…/--/invite?token=x` deep link opens the public invite route while signed in; mobile tsc/lint clean, 46 tests. Two defects fixed in the pass: `Grid` received a Fragment as one child (cards stacked), and `SplashScreen.setOptions` warns in Expo Go. **Lesson:** the detached Metro launcher must not set `CI=1` (disables watching — new routes never reached the device; recorded in memory).
- area: Mobile / Architecture
- evidence: `apps/mobile/src/app/_layout.tsx` is a 19-line flat Stack (no tabs, no `GestureHandlerRootView`); no font is loaded (`expo-font` unused); no icon library (Unicode glyphs); two competing primitive sheets (`components/ui.tsx`, `components/capture/ui.ts`); 14 files with hardcoded hexes; every screen hand-rolls its header.
- problem: 21 screens reachable only by pushing from two ad-hoc link rows; the app has no persistent chrome, no typography, no icons and no theme layer to re-skin through.
- fix: `@expo-google-fonts/{inter,libre-baskerville,jetbrains-mono}` held behind the splash; `react-native-svg` + `<Icon>` over the token path map; `src/theme` (`useTheme`, `text()`, `elevation()`); root layout with `Stack.Protected` session gate + `SessionProvider`; `(app)/(tabs)` = Home · Inspections · Library (QA+) · Profile with a custom `TabBar`, every flow pushed full-screen; kit in `src/components/ui/` (Screen, Header, Card, StatCard, ListRow, ListCard, IconTile, Chip, Badge/StatusChip, Button, Sheet, EmptyState, Skeleton, Avatar…) absorbing both old sheets, `form-screen`, `back-button`, `quick-create-sheet`; `app.json` colours + new icon/splash artwork.
- verify: Cold start → splash → Home with serif title and Solar tabs; inspector account sees 3 tabs; `inspect://invite?token=` and `inspect://inspections/<id>/capture` deep links work cold and warm; 46 mobile tests untouched; `expo export` size delta recorded.
- refs: as INS-094

### INS-096 · Mobile screen re-skin (batches M2–M7)   [HIGH]
- status: todo
- area: Mobile
- evidence: 25 routes styled ad hoc off `palette.*`.
- problem: Once the kit exists every screen still has to be rebuilt from it — including the 1013-line capture screen, whose behaviour (`src/lib/capture-core.ts`, `photo-queue.ts`) must not change.
- fix: M2 the four tabs · M3 capture (restyle only, zero lines in `src/lib`) · M4 review + report · M5 new inspection + presets · M6 companies/users/products/POs/reports/login/invite · M7 delete the alias, `capture/ui.ts`, `form-screen.tsx`, `back-button.tsx`, `quick-create-sheet.tsx`; ESLint `no-restricted-imports`; hex/`fontWeight` grep gate.
- verify: Per batch: type-check, lint, tests, `expo export`, emulator screenshot; M3 re-runs the INS-093 path (shoot → retake → gate → discard → submit → review) and the airplane-mode strip.
- refs: as INS-094

### INS-097 · Capture-point library (contract, domain, API, seed)   [HIGH]
- status: done
- done: 2026-09-12 — **Contract:** `CATALOG_SCOPES`/`CatalogScope` (shared with the defect catalog; `DefectScope` kept as a deprecated alias), `CAPTURE_POINT_CATEGORIES`, `CapturePointDto`, `CreateCapturePointInput`, `PresetItemDto.capturePointId?` + joined `capturePoint?`, `PresetItemInput.capturePointId?`; both registered in `wire-contract.spec.ts`. **Schema:** `enum DefectScope` RENAMED to `CatalogScope` (hand-written `ALTER TYPE … RENAME`, rows untouched), `enum CapturePointCategory`, `model CapturePoint` (`@@unique([orgId,name])`, partial unique `capture_points_global_name_key` on global names, `CHECK ((scope='GLOBAL') = ("orgId" IS NULL))`), `PresetLoopItem.capturePointId?` (`SetNull`, indexed) — migration `20260912000000_capture_point_library`, applied to the shared dev DB; `prisma migrate diff` DB↔schema empty. **Seed:** `prisma/capture-points.seed-data.ts` (55 rows in 6 categories, each a capture instruction, `iconKey` typed as `IconName`); second run creates 0. **API:** `src/capture-points/` — `GET /capture-points?q&category&includeArchived`, `POST` = find-or-create by trimmed/space-folded, case-insensitive name across global + org (P2002 race converges on the winner), `DELETE /:id` archive (global/foreign → 403), class floor `QA_MANAGER`, audit `capturePoint.created|archived` inside the tx; `loop-presets.service` validates `items[].capturePointId` against `OR:[{orgId},{orgId:null}]` (400 otherwise), persists it, joins `capturePoint {id,category,iconKey}` on GET; `inspection-mapping.spec.ts` pins the snapshot item keys to `position,itemName,description,referenceImageUrl` (lineage never reaches a signed artifact). **Domain:** `capture-points.ts` (`groupCapturePoints`, `iconForCapturePoint`, `isInLoop`, `draftItemFromCapturePoint`, `moveItem`, `LOOP_TEMPLATES` ×3, `resolveTemplate`), `presets.ts` (`latestPresetPerName` MOVED from `apps/web/lib/presets.ts`; web `create-form.tsx` re-pointed, mobile `inspections/new.tsx` picker now shows one row per preset name), `home.ts` (`statusCounts`, `bucketCounts`, `nextForInspector`) — domain 39 → **59 tests**. **Verified:** api unit specs green (capture-points 11, lineage 4, mapping pin), `wire-contract.spec.ts` green, **integration `capture-points.e2e-spec.ts` 6/6 against the dev DB** (globals visible to two orgs; ORG row invisible/unarchivable/unusable as lineage cross-tenant; folded duplicate → same id; global name → global row; snapshot carries no lineage), `openapi.json` regenerated (+`/capture-points`, `/capture-points/{id}`), type-check api/web/mobile, lint on every new file. **Note:** the deployed Railway API still runs the pre-rename Prisma client against the renamed enum type — push `main` (auto-deploy) before exercising `/defect-catalog` writes remotely.
- area: API / shared contract / domain
- evidence: `PresetLoopItem.itemName` is free text; both builders add blank "Item 01" rows; no model, route or seed for reusable capture points; no garment category anywhere.
- problem: Building a loop means typing every shot by hand, and nothing an org names is reusable next time.
- fix: `CapturePoint` mirroring `DefectCatalog` (`CatalogScope` GLOBAL|ORG shared enum, `orgId?`, `category CapturePointCategory`, `iconKey?`, partial unique index on global names, scope/org CHECK); `PresetLoopItem.capturePointId?` NON-authoritative (`SetNull`, pinned out of `loopPresetSnapshot` by test); ~55 seeded global rows with capture-instruction descriptions; `GET/POST/DELETE /capture-points` (POST = find-or-create by folded name; QA_MANAGER floor; audit); `POST /loop-presets` validates + persists `capturePointId`; DTOs in shared-types + wire-contract registration; domain `groupCapturePoints`, `isInLoop`, `moveItem`, `LOOP_TEMPLATES`, `resolveTemplate`, `latestPresetPerName` (moved from web), `bucketCounts`, `nextForInspector`; integration spec (cross-tenant + snapshot key pin); `openapi.json` regenerated.
- verify: Seed twice → second run creates 0; integration spec green (global visible to two orgs, ORG row invisible cross-tenant, find-or-create returns the same id for a folded duplicate, snapshot items carry no `capturePointId`); `pnpm type-check`.
- refs: as INS-094 · INS-081 (loop shape) · INS-076 (preset versions)

### INS-098 · Drag-and-drop loop builder (mobile) + web builder parity   [HIGH]
- status: todo
- area: Mobile + web (preset builder)
- evidence: `apps/mobile/src/app/presets/new.tsx` reorders with ↑/↓ `Glyph` presses; `apps/web/app/(console)/presets/new/builder.tsx` with `ChevronUp/Down`; `react-native-reanimated` 4.5.1 + `react-native-gesture-handler` installed and unused.
- problem: Ordering a 12-shot loop by single-step swaps is slow and joyless; there is no library to pick from.
- fix: Mobile: `react-native-sortables` list with a drag handle + haptics, `capture-point-chooser` sheet (search, category chips, 2-col tiles, multi-select in tap order, "Custom…" → `POST /capture-points`), `item-edit-sheet` keeping Move up/down/Remove as the accessible fallback (INS-092), template chips; detail rows show category icons. Web: `@dnd-kit/sortable` + a library panel; `actions.ts` imports `PresetItemInput` from shared-types. Presets stay immutable (save = new version).
- verify: Emulator: add 6 points from the library → drag one to position 1 → edit-sheet Move down → Custom… "Hem tape close-up" → save → detail shows the dragged order with icons → reopening the chooser lists the custom point under "Yours".
- refs: as INS-094 · INS-097 (the library it consumes)

### INS-099 · Home tab + `/dashboard` fold   [HIGH]
- status: done
- done: 2026-09-12 — `(app)/(tabs)/index.tsx`: greeting header (org overline, first name from `/auth/me`'s new `name`, avatar), role-shaped body — QA+: quick-start carousel (New inspection · New loop · Reports · Library), `Pipeline` 2×2 `StatCard`s (`bucketCounts(inspectionsByStatus)` for In progress / Awaiting review, Pass rate + DPHU from `quality`, "—" when null), Recent inspections (3, `StatusChip`, → capture or review by `isLockedStatus`), Recent reports (3, → `/inspections/:id/report`); inspector: `nextForInspector` emphasis card with Resume/Start capture, `My work` 2×2 from `bucketCounts(statusCounts(rows))`, "Assigned to you" rows. Pure fetch + `.then(apply)` via `fetchMissing`; a 401 signs out through the guard. `/dashboard` is a redirect to `/` for one release. No new API beyond the two identity fields on `/auth/me`. Verified on the emulator for both `qa.mobile@` and `inspector.mobile@` against the Railway API (real counts: 4 inspections, pass rate 100 %, DPHU 0.63, 2 signed reports).
- area: Mobile
- evidence: `/` redirects to `/inspections`; `/dashboard` (QA floor) is a tile grid + seven text links; inspectors have no landing surface.
- problem: The user asked for a Home with quick-start buttons and stat cards; today the app opens on a list.
- fix: `(tabs)/index.tsx`: greeting header, quick-start carousel (New inspection / New loop / Continue / Reports; inspector: Continue-or-Start / My inspections via `nextForInspector`), 2×2 `StatCard`s (QA+ from `GET /dashboard/summary`; inspector from `bucketCounts(statusCounts(GET /inspections))`), Recent inspections (+ reports for QA+). `/dashboard` → redirect for one release, then deleted. No new API.
- verify: QA and inspector accounts show their variants; null pass rate renders "—"; `HOME_HREF = '/'` test.
- refs: as INS-094

### INS-100 · Web console follow-through (tokens, fonts, shell, builder)   [MEDIUM]
- status: todo
- area: Web console
- evidence: `apps/web/app/globals.css` stock shadcn HSL vars disconnected from the palette; fonts via raw `<link>`; `components/inspect/shell.tsx` 488 lines of the old hairline system.
- problem: Once mobile ships the new language the console must follow or the product has two brands.
- fix: W1 `themeToCssVariables(light)` into globals.css + Tailwind `var(--x)`; W2 `next/font/google`; W4 shell re-skin + `field.test.tsx` radius; web builder DnD + library panel (INS-098). Icons stay lucide.
- verify: `pnpm web test`, `type-check`, `next build`; Chrome click-through of dashboard + builder.
- refs: as INS-094

### INS-101 · Dark mode   [LOW]
- status: todo
- area: Shared packages / mobile / web
- evidence: `dark: ThemeColors` shipped in INS-094 but no app resolves it.
- problem: `app.json` says `userInterfaceStyle: automatic` while the palette is light-only.
- fix: `useTheme()` becomes a context read of `useColorScheme()`; web `.dark` block + toggle; audit every `onImage`/scrim use.
- verify: Both platforms render every kit component in dark without a hardcoded light hex.
- refs: as INS-094

---

## Medium

### INS-089 · Nothing records who generated a signed report   [MEDIUM]
- status: done
- done: 2026-09-05 — `Report.generatedByUserId` (+ `generatedBy` relation, migration `20260904220908_report_generated_by`, applied to the dev DB); `ReportsService.generate()` stamps the actor and every report read the pages consume includes `generatedBy {id,name,email}` (list rows unchanged; `canonicalSnapshot`/`contentHash`/`signature` untouched — the signer is an unsigned row column, so historical signatures still verify). `ReportDto.generatedBy` in `@inspect/shared-types` (a real relation, so the wire-contract guard accepts it). Web report page and mobile report screen render "Signed by" from it. Reports Jest 99 → 102. History: filed 2026-08-27 by the wire-contract guard when the phantom `generatedBy` field was removed.
- area: Reports & verification
- evidence: `apps/api/prisma/schema.prisma` `model Report` has no `generatedByUserId`; `reports.service.getForOrg()` includes only `deliveries` + `accesses`; both the web report page and mobile's `/inspections/[id]/report` render '—' for "signed by".
- problem: The report is the product's binding artifact and its tamper-proof panel claims to name a signer. The Ed25519 signature is the platform's, not a person's, so the panel is really asking "which human stands behind this call" — and the answer is not stored. The canonical snapshot does carry `aqlResult.decidedByUserId`, but that is an id, not a name.
- fix: Decide what "signed by" means first — the QA Manager who made the binding decision is the honest answer, and `AqlResult.decidedByUserId` already records it. Either resolve that id to a name on the report read, or add `generatedByUserId` to `Report` and set it in `generate()`. Do NOT backfill onto existing rows and do NOT touch `canonicalSnapshot`/`contentHash`/`signature` — a presentation fix on top of signed data, not a change to it.
- verify: A generated report shows a real person's name in the tamper-proof block; `GET /reports/verify/:token` still returns `valid:true` for reports signed before and after; `wire-contract.spec.ts` stays green.
- refs: found by `apps/api/src/common/wire-contract.spec.ts` · archive: INS-038 (signature coverage), INS-039 (audit actor identity)

---

## Low

### INS-034 · Workspace CRUD and onboarding modules untested   [LOW]
- status: done
- done: 2026-09-05 — `apps/api/src/guest/guest.service.spec.ts`, 26 tests: token → guest resolution (empty/unknown/revoked/expired/boundary/null-expiry, `lastAccessAt` stamp), the visibility predicate on list/get/download (factory-side guest excluded; same-company guest from another org excluded; exact predicate shape, no `OR`), photo presign + access logging + PDF download. Mutation-checked live: dropping the `orgId` conjunct reddens 8 tests, a party-agnostic relation `OR` reddens 5. The predicate itself was already correct — no service change. Note `Report` has no `factoryCompanyId` column (the factory identity is frozen inside the signed snapshot), so the realistic leak path is `inspection.factoryCompanyId`, which the spec models.
- area: Workspace CRUD
- evidence: `apps/api/src/guest/` has no `*.spec.ts`.
- problem: The guest module's magic-link auth and report-visibility predicate are unverified by unit tests (the integration suite does cover the guest read path).
- fix: Add a guest.service spec pinning: token→guest resolution, ACTIVE+unexpired checks, and the client-role-only visibility predicate (a factory's guest must never see the client's report).
- verify: Spec green; mutation-check that dropping `clientCompanyId` from the predicate fails a test.
- refs: [../done/specs/2026-06-06-inspect-mvp-requirements-design.md](../done/specs/2026-06-06-inspect-mvp-requirements-design.md) §4.2

### INS-087 · PO party pickers ignore trade role when ranking   [LOW]
- status: done
- done: 2026-09-05 — option (a). `CompaniesService.list()` adds `roleCounts { asClient, asFactory }` next to the unchanged flattened `_count` (the directory still renders that); `CompanyDto.roleCounts?` in `@inspect/shared-types`; `rankCompaniesByActivity(rows, role?)` in `@inspect/domain` ranks on the named role's count and falls back to today's behaviour when the role or the counts are absent (domain 34 → 39 tests). All four PO party pickers — web `purchase-orders/new` + quick-create dialog, mobile `purchase-orders/new` + quick-create sheet — now feed the Client picker `'client'` and the Factory picker `'factory'`, so the two orders differ for an org whose clients and factories are different companies.
- area: Console + mobile (purchase orders) / shared contract
- evidence: `packages/domain/src/company-ranking.ts` ranks by the flattened `_count.purchaseOrders`; `CompaniesService.list()` deliberately flattens the four role edges into one count, so the wire shape cannot distinguish roles.
- problem: INS-055 spec §0 P3 rejected `canBeClient`/`canBeFactory` flags and promised "rank by recently used in THAT role" instead. The replacement was never built — both pickers render identically ordered.
- fix: (a) expose per-role counts on the DTO (`asClient`/`asFactory` alongside the flattened counts) and rank each picker on its own edge; or (b) drop the promise and rank by name. (a) is the honest reading of the spec.
- verify: The Client picker's top entries differ from the Factory picker's for an org where different companies play the two roles; the flattened `_count` the directory renders is unchanged.
- refs: archive: INS-055 spec §0 P3 · `companies.service.spec.ts` "flattens the four role-edge counts"

### INS-085 · `pnpm api test` exits 134 / fails on Windows after tests report green   [LOW]
- status: done
- done: 2026-09-05 — `"maxWorkers": "50%"` pinned in `apps/api/package.json`'s `jest` block. The serial run on this machine is 691/691 across 43 suites; the `--runInBand` command stays the belt-and-braces Windows fallback if a parallel run ever crashes again. Mechanism (for the record): V8 OOM in parallel workers under memory pressure in the scrypt-heavy suites; never a code bug; Linux CI was always green.
- area: Infra & CI
- evidence: parallel-run failures land only in scrypt/crypto-heavy suites and only under low free RAM; `--runInBand` is deterministic-green; CI (Linux) green.
- problem: The API's verification command cries wolf on Windows, costing a diagnosis each time or training people to ignore it.
- fix: Set `maxWorkers` (e.g. `50%`) in `apps/api/jest` config; close after a green stretch of parallel runs on this machine.
- verify: `pnpm api test` exits 0 on Windows repeatedly without `--runInBand`; CI stays green.
- refs: [../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md](../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md) §3 P0-10

### INS-092 · UX friction audit residue (2026-09-04)   [LOW]
- status: done
- done: 2026-09-05 — every listed item. **Web:** `components/inspect/field.tsx` (`Field`/`Input`/`Textarea`/`Select`/`ReadOnlyValue`) re-pointed across the company, product, PO, user, guest and quick-create forms (the copy-pasted label style is gone; hand-rolled error panels → `ErrorBanner`); create-from-list actions stay on the list (`createCompany` returns the row and the directory shows "Created X."; product/PO creates redirect to their lists); PO client/factory/product rendered read-only with the "fixed once the PO exists" hint; one `components/inspect/breadcrumb.tsx` replaced three hand-rolled ones; directory row click uses `router.push`; Create Company has a `loading` guard; the add-member panel keeps its draft across toggles; `/inspections/new` lists one preset per name (`lib/presets.ts latestPresetPerName`, the selected older version pinned). **Mobile:** `components/ui.tsx` (`Field`/`Input`/`Button`/`Chip`/`TextButton`, 44pt floors) re-pointed across the form and list screens; reorder glyphs, deactivate link and filter chips are ≥44pt; `RefreshControl` on every data-loading `[id]`/`new` screen via `FormScreen.onRefresh` (edit screens refresh without re-seeding typed fields); `lib/fetch-missing.ts` retries only the resources that failed; a `ToastProvider` + `useToast()` gives success feedback after every create/save; `products/new` waits for the role probe; the AQL preview keeps the previous plan visible while updating; role changes are optimistic with rollback; the PO list has client-side search + a 30-row window; the dead `void seed;` is gone. **Also landed here:** photo evidence is displayed in CAPTURE ORDER — grouped by unit (cycle ascending), items by position — on the web review page (`lib/photo-evidence.ts`), the web report page/branded report, the mobile review screen (new "Photo evidence" section, local-first via the device cache) and the mobile report screen; and the mobile review screen's "Submit for review" is disabled while this device still holds uploads for the inspection (the capture screen's gate, mirrored). Web Vitest 47 → 60 (Field, Breadcrumb, presets, photo-evidence tests); mobile 44 → 46 (`fetch-missing`).
- area: Console + mobile
- evidence: audit recorded in the INS-091 spec §0; each line below names its file.
- problem: Papercuts found while auditing for INS-091 and deliberately left out of it. **Web:** no shared Field/Input/Label primitives — styles copy-pasted in ~8 forms; create-from-list actions redirect to the detail page and lose the list (`dashboard/actions.ts` createCompany, `products/actions.ts`, `purchase-orders/actions.ts`); PO client/factory/product immutable after create with no UI hint (`purchase-orders/[id]/edit-form.tsx`); no breadcrumb component (three hand-rolled); `directory-client.tsx` row click uses `window.location.href`; the Create Company submit lacks `loading=` (no double-submit guard); `users-client.tsx` "Add member" toggle discards typed input; `/inspections/new` preset dropdown lists every version of every preset (INS-076 residue). **Mobile:** no shared Field/Input/Button primitives; sub-44pt targets (`presets/new.tsx` reorder glyphs, `users.tsx` deactivate link, `companies/index.tsx` chips); no `RefreshControl` on any `[id]`/`new` screen; retry re-runs the whole `Promise.all`; no success feedback after create (no toast primitive); `products/new.tsx` form flashes before the role probe resolves; AQL preview flickers to a spinner on every debounce; `users.tsx` role change is non-optimistic; PO list has no search/paging (API `GET /purchase-orders` takes no query params); `presets/new.tsx` dead `void seed;`.
- fix: Pick per item; the shared-primitive extractions on each platform are the highest-leverage first steps.
- verify: Per item.
- refs: [BACKLOG.md](BACKLOG.md) INS-091 · INS-087 (per-role picker ranking, related)

---

### INS-093 · Mobile camera loop: free "Next" left holes, retake blocked on the network, uploads died with the screen   [HIGH]
- status: done
- done: 2026-09-04 — **Navigation:** the free "Next" button is gone. The cursor walks a `slotSequence` = every slot holding evidence (server ∪ device) plus exactly ONE empty slot, the `frontier`, which mirrors the server's `cycleState.nextSlot` rule with the device's photos overlaid (first missing item of the lowest partial unit, else a new unit above the highest index — discard gaps are never refilled). Prev/Next step along that sequence; "Jump to next shot" returns to the frontier; the only way to open a new slot is to shoot it. **Retake through the queue:** a capture carries an `intent` — `fill` (slot believed empty → a 409 is still a human-resolved conflict) or `replace` (deliberate retake → a filled slot is EXPECTED and replaced in place via the INS-081 retake endpoint, never a conflict). Retaking a shot still in flight supersedes it (upload aborted, bytes deleted). **Background uploads:** `photoQueue()` is a module singleton — presign → native `File.upload` PUT (progress + `AbortSignal`) → register|retake — with per-step timeouts (20 s API / 120 s PUT), an automatic backoff ladder (2/5/15/30/60 s) for failures, a foreground-resume kick, and a drain loop that re-reads the live queue so a capture mid-drain is never orphaned (the old `draining` guard silently dropped it). **On-device cache:** an uploaded entry becomes an `uploaded` cache record — bytes kept until the loop is submitted (or found locked), served local-first by `SlotImage` (hash-matched against the server's `contentHash`; stale bytes are never shown), swept after 30 days or when the file vanished. **End loop:** with uploads outstanding it opens the upload sheet in finishing mode (failures re-armed, live progress, conflicts need a decision) and submits automatically — after a confirm — once the queue is empty. **UX:** frozen-frame "Saving…" preview while hashing, shutter disabled until `onCameraReady`, upload strip with live progress, per-slot state badges, a gallery of every unit × item with jump-to-slot, a leave-with-uploads warning. `capture-core.ts` grew the pure rules (`frontier`, `slotSequence`, `stepCursor`, `snapCursor`, `supersede`, `markUploaded`, `backoffMs`, `selectNextUpload`, `withTimeout`, …) — **mobile Vitest 15 → 39 tests**. The screen is split into `components/capture/{gallery,upload-sheet,unit-sheet,end-gate,slot-image,ui}`. Verified by type-check + lint + tests + `expo export`, **and on the Android emulator (Expo Go, 2026-09-04) against the local API:** shutter → strip "1 uploading" → `Saved` badge, server row carries `deviceId` + `capturedAt`; Prev → Retake → shutter replaced the SAME photo row with a new hash (no network wait); End loop on a partial unit → gate naming the missing items → Finish/Discard both exercised (discard dropped the unit server-side and on-device); gallery listed unit 1 complete + the unit 2 frontier tile; End loop on a clean loop → confirm → SUBMITTED → review screen. Two fixes came out of the pass: `RetakePhotoInput` in `@inspect/shared-types` was narrower than the API (key + hash only), so a retake NULLed the row's `capturedAt`/`deviceId` — the DTO now carries the provenance fields and mobile sends them; and the gate's "Finish unit N" landed on item 1 instead of the missing slot — it now jumps to the frontier. One oddity stays unexplained: a fourth photo (unit 2 · Front view, plus a retake-mode toggle) appeared while no tap was being sent and the gallery was open; two deliberate Fast-Refresh repros did not reproduce it, the app has no capture path without a shutter press, and the resulting state matched a replay of the earlier Prev/Retake/shutter taps — treated as automation-side input, but worth watching on a physical phone. **2026-09-05 follow-up (network hardening):** `expo-network` added — the queue PAUSES while the OS reports offline and resumes the instant connectivity returns (no backoff wait), re-arming every retryable failure on reconnect and on foreground; failures are classified (`offline` / `transient` / `permanent`): socket-level errors and 5xx/429/timeouts retry on the ladder, a 4xx refusal is `permanent` — never auto-retried, surfaced as "Rejected — retake or discard" with a Retake action that jumps to the slot; the strip, the stage badge and the upload sheet show an explicit offline state ("saved on this device, uploads when back online"); End loop carries an outstanding-photo badge and the finishing sheet explains exactly what blocks submit (offline / rejected / decision). Mobile Vitest 39 → 46.
- area: Mobile (capture loop) / offline queue
- evidence: `apps/mobile/src/app/inspections/[id]/capture.tsx` (pre-change: `advanceCursor` on a "Next" button; `retakeWithQueued` awaited inside `capture()`; `drain()` guarded by a `draining` ref that returned early for a capture during a drain; `deleteLocal` right after register; `Alert` "wait for uploads" as the only end-loop answer).
- problem: The user's words: "the phone camera experience is weird and nonsensical". Tapping Next skipped empty slots and left units with holes the end gate then complained about; a retake needed connectivity and blocked the shutter; leaving the screen or losing signal lost the upload attempt; ending the loop mid-upload was a dead end; nothing showed what had been shot.
- fix: As in `done:`. The rules live once in the pure core; the shell is a singleton the UI subscribes to.
- verify: `pnpm --filter @inspect/mobile test` (39), `type-check`, `lint`, `expo export`. On device: shoot unit 1 fully, tap Prev twice, Retake, confirm the shutter fires with the API unreachable, restore the network and watch the strip drain; End loop with a shot in flight → finishing sheet → confirm → review screen; kill the app mid-upload and relaunch → the entry resumes as `pending`.
- refs: [BACKLOG.md](BACKLOG.md) INS-086 (the epic) · INS-081 (retake + unit-boundary rules) · INS-016 (clientRequestId idempotency, what makes the retry safe) · rules [.claude/rules/migration-discipline.md](../../.claude/rules/migration-discipline.md)

---

## ⚠️ Needs a human

> Nothing here is blocked on engineering. Each needs a credential or a decision only the account owner has.

1. **[INS-086](BACKLOG.md) device pass** — the API is deployed and `eas.json` carries the real origins
   ([INS-090](BACKLOG.md) done 2026-09-02); run `eas build --profile preview --platform android`
   (`eas` is already authenticated) and walk the ledger on a phone.
2. **[INS-002](BACKLOG.md)** — rotate the QCLink credentials (DB, Redis, S3, JWT secrets — the user
   has said everything will be rotated after INS-090; the remote signing key is already fresh) and
   decide on the git-history scrub.
3. **Product decisions parked in [STATUS](../STATUS.md) observations** — whether a preset's defect-tag
   selection should LIMIT populate's tag list (today populate offers the whole org catalog), and whether
   an archived company being silently editable via `PATCH /companies/:id` is acceptable.
