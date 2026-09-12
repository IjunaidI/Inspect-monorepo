# Project Status — Inspect

> **Last verified: 2026-09-12.** This is the source-of-truth dashboard: current state only.
> The long per-session history that used to stack here was trimmed 2026-09-02 — it lives in git
> history (`git log -- docs/STATUS.md`) and in the backlog archive
> ([done/2026-09-02-backlog-archive.md](done/2026-09-02-backlog-archive.md)). Open work:
> [future/BACKLOG.md](future/BACKLOG.md). Screen-by-screen mobile state:
> [reference/screen-migration-map.md](reference/screen-migration-map.md).

## Where the project stands

**Latest (2026-09-12): the design revamp has started — Phase 0 (mockups + docs) and Phase 1 (tokens v2)
are committed on local `main` (see Repository state below).** The account owner approved a master plan to re-skin the whole app
mobile-first in the look of the reference they supplied (`design/*.html`: cream canvas, forest-green
primary, sand + gold, Inter + Libre Baskerville + JetBrains Mono, 12px radius, bordered cards, Solar icons),
add a **capture-point library + drag-and-drop loop builder**, and a **Home tab** — backlog
[INS-094 … INS-101](future/BACKLOG.md), spec + plan
[docs/in-progress/*/2026-09-12-inspect-design-revamp*](in-progress/specs/2026-09-12-inspect-design-revamp-design.md).
**Phase 0 done:** the *Inspect Mobile v2* design canvas (8 phone artboards — Home QA / Home inspector /
Inspections / Library / Profile / Loop builder dragging / Add-capture-points sheet / Capture) is saved
online (link in the spec; regenerate with `node design/inspect-canvas/build.mjs`); reference doc
[reference/design-system.md](reference/design-system.md). **Phase 1 done in code:**
`@inspect/design-tokens` rebuilt as a real design system (semantic `ThemeColors` light + dark shape, type
scale with expo-google-fonts native keys, `space`/`radius`/`shadow`, tone/status/severity/role maps,
a 96-icon SVG map incl. 14 custom garment glyphs, `themeToCssVariables`, and a **frozen `report` palette**
that both the web `branded-report.tsx` and the API `report-pdf.ts` now read — the "keep in sync by value"
hand-rule is gone). The old `palette` keys survive as a `@deprecated` alias onto the new theme, so every
web and mobile screen already renders the v2 colours with zero screen edits. **Verified:** tokens 24/24
(incl. WCAG ≥ 4.5 for every tone pair), web 60/60, api **692/43** (+ the palette-parity pin), mobile 46/4,
type-check clean on api/web/mobile, web + mobile lint clean, **and on the Android emulator** (Expo Go
against the Railway API, 2026-09-12): `/inspections` renders the cream canvas, forest-green header
actions, warm hairline cards and re-coloured status chips — the alias flipped the whole app. Phase 1 is
complete; INS-094 is done.

**Phases 2 and 4 done (2026-09-12, INS-095 + INS-099): the mobile app has its foundation and its four
tabs.** Nine font faces (Inter · Libre Baskerville · JetBrains Mono) load behind the splash; `src/theme`
composes the tokens into RN styles (`text()` never emits `fontWeight`); the kit under
`src/components/ui/` (Icon over the token SVG map, Button, Field/Input, Chip, Badge/StatusChip, Card/
ListCard, ListRow, StatCard/Grid, IconTile, Header/BackButton, Screen, Section*, Sheet, ProgressBar,
Empty/Error/Skeleton, TabBar, Avatar) replaces both old primitive sheets — the old names still resolve
from the same import path while the remaining screens are re-skinned. Navigation is now
`Stack.Protected` (`(app)` when signed in, `login` when not, `invite` always) over a `(app)/(tabs)`
group — **Home · Inspections · Library · Profile**, Library hidden below QA — with every flow pushed
full-screen above the bar; URLs did not change, `/dashboard` redirects to `/`. The four tabs are the
real screens: Home (role-shaped quick start, pipeline stat cards, recent inspections/reports; inspector:
Continue/Start card + "Assigned to you"), Inspections (search + status-bucket chips), Library (hub with
live counts + most-used loop), Profile (identity, role, web console link, Sign out — `/auth/me` now
returns `email` + `name`). **Verified on the emulator (Expo Go → Railway API) for `qa.mobile@` (4 tabs)
and `inspector.mobile@` (3 tabs):** cold start → splash → Home; Sign out → login → sign in flips the guard
with no explicit navigation; the invite deep link opens while signed in; `expo export` green (4.7 MB
Hermes bundle — first recorded baseline); mobile tsc/lint clean, 46 tests; API auth specs 37/37.
Placeholder app-icon / splash artwork regenerated in the palette (`assets/brand/build-icons.mjs`).

**Phase 3 also done (2026-09-12, INS-097): the capture-point library exists end to end.** New Prisma
model `CapturePoint` (hybrid GLOBAL + ORG, mirroring `DefectCatalog`; the scope enum is now the shared
`CatalogScope`), `PresetLoopItem.capturePointId` as NON-authoritative lineage (pinned out of the
inspection snapshot by test), migration `20260912000000_capture_point_library` **applied to the shared
dev DB** and 55 global capture points seeded (idempotent). API `GET/POST/DELETE /capture-points`
(POST is find-or-create by folded name — a custom point typed in the builder becomes a reusable org row),
`POST /loop-presets` validates + persists the lineage and `GET /loop-presets/:id` joins it back.
`@inspect/domain` gained the chooser/builder rules (`groupCapturePoints`, `isInLoop`, `moveItem`,
`LOOP_TEMPLATES`, `resolveTemplate`), the Home counting rules (`statusCounts`, `bucketCounts`,
`nextForInspector`) and `latestPresetPerName` (moved from the web; the mobile preset picker now lists one
row per name too). **Verified:** integration `capture-points.e2e-spec.ts` **6/6** against the dev DB,
api unit suites green (capture-points 11, lineage 4, snapshot pin), `wire-contract.spec.ts` green,
`openapi.json` regenerated with the two new paths, domain 59/59, type-check api/web/mobile, lint on every
new file. The mobile builder that CONSUMES the library is Phase 5 (INS-098), after the kit (Phase 2).

**Before that (2026-09-05): the low/medium backlog is cleared and the camera loop is network-aware.**
Five items closed in one pass — [INS-089](future/BACKLOG.md) (the report signer is recorded and shown),
[INS-092](future/BACKLOG.md) (every web + mobile friction papercut: shared form primitives on both
platforms, breadcrumb, toasts, pull-to-refresh, partial retry, optimistic role change, PO search, latest-
version-only presets…), [INS-087](future/BACKLOG.md) (Client and Factory pickers rank on their own trade
role), [INS-034](future/BACKLOG.md) (guest visibility predicate pinned by 26 tests), [INS-085](future/BACKLOG.md)
(Jest workers pinned). Photo evidence is now displayed in **capture order** — by unit, then item — on the
review and report screens of both platforms. [INS-093](future/BACKLOG.md) grew connectivity awareness: the
upload queue pauses offline and resumes on reconnect, classifies failures (server rejections stop retrying
and offer Retake/Discard), and the loop cannot end — from the capture screen OR the review screen — while
any photo is still on the device. Open backlog is down to the two items only the account owner can move.

**Repository state (2026-09-12):** Phases 0–4 are committed on local `main` as four commits, **not yet
pushed**: `f4e43c3` feat(design) tokens v2 + frozen report palette + design canvas/spec/plan (INS-094) ·
`009ba3e` feat(api) capture-point library (INS-097) · `7229f3c` feat(mobile) foundation, kit, tabs, Home
(INS-095/099) · a docs commit (STATUS, BACKLOG, CLAUDE.md). They sit on top of the six earlier unpushed
commits (`b29f72c` camera loop → `6c7b84b` lockfile), so **ten commits** are waiting on `git push`. Only
`.claude/settings.local.json` (permission allowlist noise) was left uncommitted. **Eleven pre-existing prettier/CRLF lint errors** show on Windows in files this
session did not touch (`reports.service.spec.ts` and friends); CI on Linux is the honest read. Pushing auto-deploys the API to Railway, and that deploy's pre-deploy
`prisma migrate deploy` applies the new `20260904220908_report_generated_by` migration there (already
applied to the shared dev database, so it is a no-op for the data and forward-only). **One thing is
verified only by tests, not on a device:** the 2026-09-05 mobile work (offline pause/resume, rejected-upload
handling, the review-screen submit gate, the INS-092 papercuts). The 2026-09-04 camera flow was run on the
emulator; the offline behaviour needs a phone pass (airplane mode mid-loop, then back online) — fold it
into the INS-086 device pass.

**Before that: [INS-093](future/BACKLOG.md) (2026-09-04) — the mobile camera loop hardened.** The
first hands-on look at the capture screen found it "weird and nonsensical": a free "Next" button left
units with holes, a retake blocked on the network, and uploads died with the screen. Now the cursor
walks only shot slots plus one frontier, retakes are queued like any capture, uploads run in a
background singleton (progress, timeouts, backoff, resume on foreground), every photo is cached
on-device until the loop is submitted, End loop waits for uploads in a finishing sheet, and a gallery
shows every unit × item. Verified by tests, type-check, lint, `expo export` **and on
the Android emulator** (shoot → saved → retake in place → gate → discard → submit → review; two fixes
fell out, see the backlog entry).

**Before that: [INS-091](future/BACKLOG.md) (2026-09-04) — pickers create what is missing.** On
both platforms the Client / Factory / Product / PO pickers are searchable and end in "+ Add new…"; a
company, product or PO is created in a dialog (web) or bottom sheet (mobile), appended and selected,
nesting one level (PO → company/product). The new-inspection dead end ("create four things elsewhere")
is gone, every `alert()` on the console is an inline banner, every mobile form is keyboard-safe, mobile
can create a company, and the client's default preset is honoured. Verified end to end in Chrome and on
the Android emulator. The residue of the friction audit was [INS-092](future/BACKLOG.md), closed 2026-09-05.

**INS-086 (React Native app) Phase 4 is CODE-COMPLETE — every screen-migration-ledger row is
built.** 25 routes bundle green on Expo SDK 57. **The API is now reachable from a phone
([INS-090](future/BACKLOG.md) done 2026-09-02):** `https://main-application-production-6fa4.up.railway.app/health`
reports db + redis up and a login round-trip works from outside the local network. The whole epic
now waits on exactly one thing, by explicit user decision (2026-09-02): the **single on-device
acceptance pass**:

1. ~~Deploy the API~~ — done. Railway project **QCLink**, runbook
   [reference/deploy-railway.md](reference/deploy-railway.md). A fresh Ed25519 signing key was
   minted there; the remaining INS-002 rotation is user-side.
2. ~~Real origins into `apps/mobile/eas.json`~~ — done (`preview` + `production` carry
   `EXPO_PUBLIC_INSPECT_API_URL` / `EXPO_PUBLIC_INSPECT_WEB_URL`).
3. **The device pass has started (2026-09-04)** on a local Android 16 emulator running Expo Go against
   the Railway API (workflow in the session memory; phone: Expo Go → `exp://192.168.18.64:8081`).
   Test users in Acme Apparel Group: `qa.mobile@` / `inspector.mobile@acme-apparel.test`.
   First two defects found and fixed: every screen imported React Native's deprecated `SafeAreaView`
   (a no-op on Android — headers sat under the status bar) → all 21 screens now use
   `react-native-safe-area-context`; and the hub-level lists, dashboard and product form had no visible
   back control → one shared `BackButton` (`src/components/back-button.tsx`, pops the stack or falls
   back to a given route when there is no history) replaced 18 ad-hoc back links and was added to 8
   screens. Verified on the emulator: Inspections → Dashboard → Products → Back → Back. Also verified
   there (INS-091, driven via the `agent-device` MCP server): Inspections → New → PO picker →
   "+ Add new purchase order…" → nested "+ Add new company…" → PO created and selected with its
   parties shown → inspection created → review screen; one tap on Create works with the keyboard up.
4. `eas build --profile preview --platform android` (`eas` is already authenticated as
   donanlumina; project `@donanlumina/inspect` is linked). Walk the rest of the ledger on the device.

## What exists, by pillar

| Pillar | State |
|---|---|
| **Domain core** (AQL engine, tamper-proof crypto, audit chain, cycle state, auth primitives) | Pure TypeScript, unit-tested: **api 709 tests / 45 suites** (2026-09-12: + the frozen-report-palette parity pin, the capture-points service spec, the preset-lineage spec and the snapshot key pin). |
| **API** (NestJS 11 + Prisma 6, **25** org-scoped models) | **2026-09-12 (INS-097):** `CapturePoint` model + `capture-points` module (`GET/POST/DELETE /capture-points`, find-or-create, QA floor, audited), `PresetLoopItem.capturePointId` lineage validated on `POST /loop-presets` and joined on GET; `DefectScope` → `CatalogScope`; seed grows the 55-row global capture-point library; integration **153/17** locally (the new spec 6/6 against the dev DB). All routes role-floored (OpenAPI carries `x-required-role`); DB-backed integration suite runs green in CI against containers. Duplicate styleNumber/poNumber now proper 409s (fixed 2026-09-02). `POST /purchase-orders` answers in the list/get shape with its three parties (INS-091, 2026-09-04 — a just-created PO showed "—" for them). **2026-09-05:** `Report.generatedByUserId` recorded on generate and returned as `generatedBy` (INS-089); `GET /companies` rows carry `roleCounts {asClient, asFactory}` (INS-087); `guest.service.spec.ts` pins the visibility boundary (INS-034); Jest `maxWorkers` pinned (INS-085). |
| **Web console** (Next.js 15) | All screens live-wired; clicked through end-to-end 2026-08-31 (signed report + guest portal verified in a real browser). Six live bugs found by the Phase 4 contract passes were fixed 2026-09-02 (see below). **INS-091 (2026-09-04):** searchable `EntityPicker`s with inline company/product/PO quick-create (nested one level), `Modal` + `ErrorBanner` (no `alert()` left), the new-inspection dead end removed, client default preset honoured. **INS-092 (2026-09-05):** shared `Field`/`Input`/`Select` primitives, one `Breadcrumb`, create-from-list stays on the list, PO parties read-only with a hint, add-member draft kept, one preset per name in `/inspections/new`; photo evidence on the review + report pages grouped by unit in capture order; "Signed by" filled from the recorded signer. **60 Vitest tests.** |
| **Mobile** (`apps/mobile`, Expo SDK 57) | **2026-09-12 (INS-095/099):** v2 foundation — fonts behind the splash, `src/theme`, the `src/components/ui/` kit, `Stack.Protected` session gate, `(app)/(tabs)` = Home · Inspections · Library · Profile (custom `TabBar`, Library hidden below QA), every flow pushed above the bar, `/dashboard` → `/`; verified on the emulator for both roles. Remaining screens still render through the `palette` alias + shims until INS-096 M3–M7. Before that: **25 routes — the full Phase 4 surface**: login · dashboard hub · inspections (list/new/capture/review/report) · reports · companies (list/detail/guests) · products×3 · purchase-orders×3 · users · invite · presets (list/detail/builder). Capture carries the spec §5.1 offline photo queue (hash-at-capture, stable clientRequestId, 409→human-resolved conflict, submit blocked while queued). **INS-093 (2026-09-04) hardened the camera loop:** no free "Next" (the cursor walks shot slots + one frontier), retakes go through the queue (`intent: replace`), uploads run in a background singleton with progress/timeouts/backoff and survive leaving the screen, every photo is cached on-device until the loop is submitted, End loop waits for uploads in a finishing sheet, and a gallery shows every unit × item. **2026-09-05:** the queue is connectivity-aware (pauses offline, resumes on reconnect, classifies failures; rejected uploads offer Retake/Discard), the review screen shows photo evidence in capture order and refuses submit while uploads are pending, the report screen shows evidence by unit and the signer. **INS-092 (2026-09-05):** `components/ui.tsx` primitives, toasts, pull-to-refresh, partial retry, 44pt targets, optimistic role change, PO search. **46 Vitest tests.** **INS-091 (2026-09-04):** `OptionPicker` search + "+ Add new…", quick-create sheets for company/product/PO, `FormScreen` keyboard handling on 11 form screens, company create from the directory. Device pass in progress (see above). |
| **Shared packages** | `@inspect/shared-types` (every wire shape — ~14 more moved in 2026-09-02; guarded by `wire-contract.spec.ts`), `@inspect/api-client` (29 tests), `@inspect/domain` (**59 tests**: ROLE_RANK, status sets + STATUS_BUCKETS, report display rules, `reportNumber`, `initialsFrom`, `hashIndex`, `rankCompaniesByActivity` — per trade role since INS-087, `filterOptions`; **2026-09-12:** capture-point grouping/`isInLoop`/`moveItem`/`LOOP_TEMPLATES`, `latestPresetPerName` (from web), Home `bucketCounts`/`nextForInspector`), **`@inspect/design-tokens` v2 (INS-094, 2026-09-12: `colors` light/dark, `typography`, `layout`, `semantic`, frozen `report`, 96-icon `icons` map, `css` emitter, `@deprecated palette` alias — 24 tests incl. WCAG contrast; now also a dependency of `apps/api` for the report palette).** |
| **Deploy** (Railway project QCLink — a DEV environment) | API `Main Application` live at `main-application-production-6fa4.up.railway.app` (Dockerfile build, `/health` check, pre-deploy `migrate deploy` + seed, fresh signing key), console `serene-vision` at `serene-vision-production-8387.up.railway.app`, Postgres + Redis + bucket. Auto-deploys on push to `main`. Runbook: [reference/deploy-railway.md](reference/deploy-railway.md). |
| **CI** (`.github/workflows/ci.yml`) | migrate→seed→type-check→api Jest→all Vitest suites→integration→builds→lint→OpenAPI staleness→single-resolved-React assertion. **Green on every 2026-09-02 push (10/10 commits).** The 2026-09-04 INS-091 commits have not been pushed yet, so CI has not seen them; locally every gate is green. |

**Verified numbers (2026-09-12):** type-check clean (api, web, mobile) · lint 0 errors on every file touched
today (web 1 known font warning; 11 pre-existing CRLF prettier errors in untouched API specs on Windows) ·
api **709/45** · web 56/8 (4 preset tests moved to domain) · domain **59/10** · api-client 29/2 ·
design-tokens **24/1** · mobile 46/4 · integration: the new `capture-points.e2e-spec.ts` 6/6 against the
dev DB (the other 16 suites last ran green in CI 2026-09-05; no existing route changed) · `openapi.json`
regenerated (+2 paths) · mobile `expo export --platform android` green, **4.7 MB Hermes bundle** (first
recorded baseline, after fonts + svg + kit) · emulator: both roles walked through Home / Inspections /
Library / Profile, sign-out → sign-in through the guard, invite deep link.

## Fixed along the Phase 4 sweep (2026-09-02)

- **API:** duplicate `styleNumber` and duplicate `poNumber` leaked Prisma P2002 as raw 500s → both
  are now 409s naming the value (+5 unit tests).
- **Web:** report-number derivation forked across three files (now `reportNumber` in domain); the
  directory's avatar colour keyed on row index so it changed page-to-page (now `hashIndex(id)`);
  a local `initialsOf` fork (now shared `initialsFrom`); the archive button and the guest revoke
  button both silently discarded their server-action `{error}` (now surfaced inline); the report
  page fired the generate POST blind for every role.
- **Recorded observations, not fixed** (product calls — see BACKLOG "Needs a human"): the web
  report page renders from the LIVE inspection row rather than the signed `canonicalSnapshot`
  (post-signing renames diverge from what `contentHash` covers) and re-derives a per-class verdict
  locally; `ReportDto` carries no `verificationToken` so neither platform links QA users to public
  verify; archived companies are silently editable (`GET/PATCH` don't check `archivedAt`); preset
  defect-tag selection doesn't limit populate's tag list.

## Known deferrals (mobile)

- Reference-image upload (preset builder) and company-logo upload — both wait on an
  **expo-image-picker** decision; display/remove/duplicate-carry work today.
- Direct add-member (email+password, no invite) stays web-only; invite is the mobile path.
- TanStack Query (spec §5) deliberately not introduced — plain-state pattern everywhere; adopt when
  a screen actually needs caching.

## Environment gotchas that still matter

- **Windows Jest:** run the API suite serially — `apps/api/node_modules/.bin/jest --runInBand`
  ([INS-085](future/BACKLOG.md): parallel workers die of V8 OOM under memory pressure; Linux CI is
  the honest read).
- **Shared packages resolve `dist/`** — rebuild before the API/`next build`/jest sees a change
  (`pnpm type-check` orders it; a stale dist cost two debugging loops on 2026-09-02).
- The Prisma CLI does **not** read the repo-root `.env` — export `DATABASE_URL` explicitly; never
  hand-extract the multi-line `REPORT_SIGNING_PRIVATE_KEY_PEM`.
- `pnpm` 9.15.9 is on PATH; `npx -y pnpm@9.12.0` crashes — use the PATH pnpm or app-local `.bin`.
- Bootstrap admin password converges to `BOOTSTRAP_ADMIN_*` on every `prisma db seed` — locally AND on
  every Railway deploy (the service carries the same value as the root `.env`; keep them equal or the
  password flip-flops). Re-seed if login 401s. Nest `--watch` restarts cause transient one-request failures — retry before blaming code.
- **The root `.env` and the deployed API share one Postgres** (the local `DATABASE_URL` is the
  public proxy of Railway's `Postgres-k9HN`). A local `migrate reset` resets the deployed DB too.
- **Railway routes AND health-checks on `PORT`; the API listens on `API_PORT`.** The service pins
  `PORT=3000` + `API_PORT=3000` and the domain targets 3000 — drop any one and it 502s / fails the
  deploy health check while the logs say "successfully started". Pre-deploy is `sh -c "…"` because Railway
  runs the string without a shell; a settings change only lands via a from-source deploy, never `redeploy`.
- Dev workspace for manual passes: **Acme Apparel Group** (owner@acme-apparel.test — see the
  2026-08-31 click-through in git history for the full fixture set; `qa.mobile@` /
  `inspector.mobile@acme-apparel.test` are the device-pass users).
- **Emulator + local API:** Metro must bake `EXPO_PUBLIC_INSPECT_API_URL=http://10.0.2.2:3000` (the
  emulator's host alias) before `expo start`, or the app calls `localhost:3000` = the phone itself and
  every screen fails to load. Launch the emulator and dev servers detached via PowerShell
  `Start-Process`; Git Bash `cmd //c start … /min` mangles the flag into a path.
- **Web component tests** (`apps/web`, since INS-091) need `oxc: { jsx: { runtime: 'automatic' } }` in
  `vitest.config.mts` — Next's tsconfig says `jsx: preserve`, which Vite 8 would otherwise obey — and a
  `// @vitest-environment jsdom` pragma per component test file; the server-side suite stays on `node`.

## Open backlog (10 items)

**The design revamp (2026-09-12):** done — [INS-094](future/BACKLOG.md) tokens v2 + frozen report
palette · [INS-095](future/BACKLOG.md) mobile foundation · [INS-097](future/BACKLOG.md) capture-point
library · [INS-099](future/BACKLOG.md) Home tab. Open — [INS-096](future/BACKLOG.md) mobile screen
re-skin batches (M2 tabs done; M3–M7 open) · [INS-098](future/BACKLOG.md) drag-and-drop loop builder ·
[INS-100](future/BACKLOG.md) web follow-through · [INS-101](future/BACKLOG.md) dark mode (parked). Phase order and gates:
[the plan](in-progress/plans/2026-09-12-inspect-design-revamp.md).

**Carried over:** [INS-002](future/BACKLOG.md) credential rotation (user-side) · [INS-086](future/BACKLOG.md)
epic (the on-device acceptance pass on a physical phone — the visual pass folds into it).

## Next steps, in order

1. `git push` — deploys the API to Railway. **Do this soon:** the shared dev DB already carries the
   `CatalogScope` enum rename and the `capture_points` table, while the deployed API still runs the
   pre-rename Prisma client — `/defect-catalog` writes on the remote API may fail until it redeploys.
2. **Phase 5 (INS-098)** the drag-and-drop loop builder on top of the library and the kit
   (`react-native-sortables`, chooser sheet, custom → library, edit sheet with the accessible
   Move up/down). Then Phase 6 (capture/review/report re-skin), 7 (remaining screens + shim cleanup),
   8 (web), 9 (device pass).
3. `eas build --profile preview --platform android` and walk the ledger on a phone (INS-086), now
   including the visual pass.
4. INS-002 credential rotation (user-side); the parked product decisions above.
