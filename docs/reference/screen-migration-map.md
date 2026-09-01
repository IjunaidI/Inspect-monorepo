# Screen migration ledger — web console → React Native

> **The resumable state of the RN migration.** A screen is not migrated until its row here reflects
> reality. Start every mobile session by reading this file.
> Design: [../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md](../in-progress/specs/2026-08-26-inspect-react-native-migration-design.md) ·
> Epic: [INS-086](../future/BACKLOG.md) · Procedure: the `migrate-screen` skill.
>
> **Last updated: 2026-09-02 (Phase 4 sweep, continued)** — **`/companies/[id]` is ported**: the merged
> INS-055 edit form (branding for the client role, address/GPS for the factory role), the tri-state
> `logoUrl` write semantics (untouched → omitted, removed → explicit null; UPLOAD deferred pending
> expo-image-picker), the half-a-GPS-pair client rule, archive with a native confirm, and an
> **archived banner + restore** — a state the web form renders no trace of (it silently allows edits;
> restore is only reachable from the dashboard table). Directory rows now open it. Two web fixes in the
> same change: the detail form's discarded archive `{error}` is now surfaced, and `OptionPicker` was
> extracted to `apps/mobile/src/components/` instead of forking. Earlier same day — **the dashboard
> ported and the company directory split out**: mobile `/dashboard` is the QA hub (the four STATUS_BUCKETS tiles — now a shared
> `@inspect/domain` partition composed from the transition sets, web re-pointed — pass-rate/DPHU with the
> null-is-“—” rule, entity counts, links onward) and mobile `/companies` is the directory (see the
> `/dashboard` note below for the v1 deviations). Two live web bugs fixed in the same change: the
> directory's fallback avatar colour was keyed on row index (changed page-to-page; now `hashIndex(id)`
> against the shared `brandFallbacks` palette in design-tokens) and its local `initialsOf` fork replaced
> by the shared `initialsFrom`. `expo export` bundles **12 routes**.
> Prior update (Phase 4 sweep) — **the report surface is ported**: `/reports` (debounced
> search, pull-to-refresh, error/401/403/empty told apart — the web page conflates all four into
> "No reports yet") and `/inspections/[id]/report` (live preview for any role, the idempotent generate
> fired only for QA_MANAGER+, tamper-proof block, **Open PDF** via the presigned `GET /reports/:id/pdf` —
> an action the web screen lacks entirely). Review now links to the report. §4.4 re-points:
> `reportNumber()` (three web copies), `conclusionFrom`, `formatInspectionType`, `formatGps` →
> `@inspect/domain`; `ReportPdfDownloadDto` → shared-types. `expo export` bundles **10 routes**.
> Prior update (Phase 4 begins) — **the mobile core loop is closed**: `/inspections/new`
> (QA creates: PO/preset/inspector pickers, live debounced AQL preview off `GET /inspections/aql-preview`,
> idempotent create → review) and `/inspections/[id]/review` (AQL result table, submit-for-review, the
> QA decision form with its required note, linked re-inspection carrying the original AQL plan) are built.
> Capture's submit now lands on review. The review status machine reads `@inspect/domain`'s shared sets —
> and the WEB review page was re-pointed at them in the same change (it held five local copies;
> `REPORTABLE`/`REINSPECTABLE` moved up to the package). `expo export` bundles **8 routes**.
> Prior update (Phase 3): **the capture screen exists**: `/inspections/[id]/capture`
> (guided full-screen camera, one slot at a time) with the spec §5.1 offline photo queue —
> hash-at-capture, presign→PUT→register drain with a stable `clientRequestId`, 409→conflict for a human,
> submit blocked while the queue is non-empty — plus a read-only locked state the web screen never had.
> Decisions live in the pure `src/lib/capture-core.ts`; **mobile's first test runner is Vitest (15 tests)
> over exactly that module.** The LOCKED/SUBMITTABLE/DECIDABLE status sets moved to `@inspect/domain` with
> the API re-pointed in the same change. Verified by type-check + lint + tests + a green `expo export`
> (6 routes) — **not on a device** ([INS-090](../future/BACKLOG.md)).
> Prior update (Phase 2 scaffold): `apps/mobile` exists (Expo SDK 57, expo-router,
> `@inspect/mobile` in the workspace). `/login` and `/inspections` are written and verified by
> type-check + lint + a green `expo export` bundle — but **not on a device**, so their rows stay
> `in-progress` until the EAS acceptance runs against a reachable API ([INS-090](../future/BACKLOG.md)).
> The auth provider is `apps/mobile/src/lib/session.ts` (SecureStore; the exchange itself stays in
> `@inspect/api-client`). Prior update 2026-08-27: routes corrected for [INS-055](../future/BACKLOG.md)
> (`/companies/[id]`, `/companies/[id]/guests`, `GET /company-guests`).
> **Phase 1 is done** — `@inspect/{api-client,domain,design-tokens}` exist, so every row below now has a
> shared client, shared tokens and a shared role gate to build against rather than reinventing them.
> The capture row is **not blocked**: [INS-083](../future/BACKLOG.md) dropped populate to an `INSPECTOR`
> floor with row-level scoping, so the app's headline screen is reachable by the role that will use it.
> ✅ [INS-088](../future/BACKLOG.md) is **closed**, so the `/login` row is unblocked: `client.login()`,
> `client.me(token)` and `client.refresh()` live in `@inspect/api-client` and `decodeJwtExp` is `Buffer`-free,
> so it runs in a React Native bundle. Mobile supplies a SecureStore-backed `AuthProvider`, **not** the
> exchange itself.
>
> ⚠️ Every row below is still blocked on [INS-090](../future/BACKLOG.md) for its *on-device* acceptance: the
> API has no reachable origin yet, so a physical device cannot talk to it.

## Status values

`not-started` · `in-progress` · `done` · `web-only` (never ports, by design) · `n/a` (stub/redirect)

## Role floors

The mobile app carries `INSPECTOR`, `QA_MANAGER` and `ORG_OWNER`. It has **no `PLATFORM_ADMIN`**. Any row
whose floor reads `PLATFORM_ADMIN` is blocked until the API is re-graded.

---

## Console screens

| Web route | RN route | Key API | Role floor | Phase | Status | Item |
|---|---|---|---|---|---|---|
| `/login` | `/login` | `POST /auth/login`, `GET /auth/me` | public | 2 | in-progress (built 2026-08-31; device acceptance blocked on INS-090) | INS-086 |
| `/inspections` | `/inspections` | `GET /inspections` | `INSPECTOR` | 2 | in-progress (built 2026-08-31; device acceptance blocked on INS-090) | INS-086 |
| `/inspections/[id]/populate` | `/inspections/[id]/capture` | `GET/POST /inspections/:id/populate/*`, `POST /inspections/:id/submit` | `INSPECTOR` ✅ | 3 | in-progress (built 2026-08-31: guided camera + offline queue + submit gate; device acceptance blocked on INS-090) | INS-086 |
| `/dashboard` | `/dashboard` + `/companies` | `GET /dashboard/summary`, `GET /companies` | `QA_MANAGER` | 4 | in-progress (built 2026-09-02: KPI hub + the directory SPLIT to its own `/companies` screen — search/kind/archived filters, load-more; directory is read-only v1: create/edit/archive land with `/companies/[id]`; device acceptance blocked on INS-090) | INS-086 |
| `/inspections/new` | `/inspections/new` | `POST /inspections`, `GET /inspections/aql-preview` | `QA_MANAGER` | 4 | in-progress (built 2026-08-31: PO/preset/inspector pickers, live AQL preview, idempotent create; device acceptance blocked on INS-090) | INS-086 |
| `/inspections/[id]/review` | `/inspections/[id]/review` | `POST /inspections/:id/decision` | view: any · decide: `QA_MANAGER` | 4 | in-progress (built 2026-08-31: AQL result, submit-for-review, decision form, linked re-inspection; device acceptance blocked on INS-090) | INS-086 |
| `/inspections/[id]/report` | `/inspections/[id]/report` | `POST /inspections/:id/report` (idempotent), `GET /inspections/:id`, `GET /reports/:id/pdf` | view: any · signed report: `QA_MANAGER` | 4 | in-progress (built 2026-09-02: live preview + signed report, QA-gated generate, Open PDF via presigned URL; device acceptance blocked on INS-090) | INS-086 |
| `/reports` | `/reports` | `GET /reports` | `QA_MANAGER` | 4 | in-progress (built 2026-09-02: debounced search, distinct error/401/403/empty states; device acceptance blocked on INS-090) | INS-086 |
| `/presets` | `/presets` | `GET /loop-presets` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/presets/[id]` | `/presets/[id]` | `GET /loop-presets/:id` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/presets/new` | `/presets/new` | `POST /loop-presets`, `GET /defect-catalog` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/companies/[id]` | `/companies/[id]` | `GET/PATCH/DELETE /companies/:id`, `POST /companies/:id/restore` | `QA_MANAGER` | 4 | in-progress (built 2026-09-02: edit form incl. tri-state logo remove + GPS pair rule, archive w/ confirm, archived banner + restore the web page lacks; logo UPLOAD deferred — needs expo-image-picker; device acceptance blocked on INS-090) | INS-086 |
| `/companies/[id]/guests` | `/companies/[id]/guests` | `GET/POST /company-guests` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/products` `/products/new` `/products/[id]` | same | `GET/POST/PATCH /products` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/purchase-orders` `…/new` `…/[id]` | same | `GET/POST/PATCH /purchase-orders` | `QA_MANAGER` | 4 | not-started | INS-086 |
| `/users` | `/users` | `GET /users` (QA), `PATCH /users/:id/role` (owner) | `QA_MANAGER` / `ORG_OWNER` | 4 | not-started | INS-086 |
| `/invite` | `/invite` | `GET/POST /invitations` | public | 4 | not-started | INS-086 |

**Note on `/dashboard`:** the *company directory* lives here (`directory-client.tsx`), not at `/companies` —
there is no list route. Since [INS-055](../future/BACKLOG.md) it is ONE list with a `kind` filter, not the
old Buyers/Suppliers tab pair, because a company can be the client on one PO and the factory on another.
**Decided 2026-09-02:** on the phone the directory IS its own screen — mobile `/companies`
(`apps/mobile/src/app/companies/index.tsx`), linked from the `/dashboard` hub. Deliberate v1 deviations,
each recorded in the screen header: one debounced server-side search (the web stacks a client-side
current-page filter on top of Enter-to-search), stable id-hashed fallback avatar colours (the web's
index-keyed colours changed page-to-page — fixed on web in the same change via `hashIndex`), read-only
until `/companies/[id]` ports (create/edit/archive stay on the web), and load-more instead of a pager.

**Note on the guests screen:** guests attach to a company acting in its **client** role only — there is no
factory-side portal. Report visibility keys on `clientCompanyId` AND `orgId`; a party-agnostic predicate
would hand a factory's guest the client's signed report. That is a security boundary, not a filter.

**Note on `/presets/new`:** the preset builder is the console's most complex authoring surface
(loop items, severity-grouped defect chips, measurement fields, custom defect creation). Expect it to be the
hardest Phase 4 screen. Consider it last.

## Permanently web-only

| Web route | Why it never ports |
|---|---|
| `/admin/orgs` | Platform Admin. Excluded from the app by decision D1. |
| `/portal` | Buyer guest portal. Buyers will not install an app to read a report. |
| `/r/[token]` | Public signature verification. Must open for anyone holding the link, including a buyer's own auditor. |

## Not applicable

| Web route | Why |
|---|---|
| `/populate` | Bare `redirect('/inspections')` stub. |
| `/report` | Bare `redirect('/inspections')` stub. |
| `/logout` | Web session mechanics; native clears SecureStore instead. |
| `/api/*` | Next.js route handlers (NextAuth, guest proxy, search). No native equivalent. |
