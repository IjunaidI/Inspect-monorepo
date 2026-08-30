# Project Status — Inspect

> **Last verified: 2026-08-31 — [INS-086](future/BACKLOG.md) Phase 2 scaffold BUILT (`apps/mobile` exists) +
> the [INS-090](future/BACKLOG.md) Dockerfiles fixed.** Work sits on branch `ins-086-phase2-mobile-scaffold`
> (2 commits, unmerged); note `main` also carries one unpushed docs commit (`8b241aa`, the handoff itself).
> **What landed:**
> **(1) Both Dockerfiles were May-17 relics** that did exactly what `717c5d8` diagnosed — copied only the app,
> never `packages/`, and built with a bare `--filter <app> build`. Rewritten to the verified contract:
> copy `packages/`, FULL `pnpm install --frozen-lockfile` (the shared packages build with bare `tsc` resolved
> from the ROOT devDependencies, so a filtered install leaves tsc missing), build via `pnpm build:api` /
> `build:web`, openssl for Prisma on slim, and `.dockerignore` moved to the repo root where the root build
> context actually reads it. Verified as far as this machine allows (all `packages/*/dist` deleted →
> `pnpm build:api` green); **Docker is not installed here, so the image build is proven by the next deploy.**
> **(2) `apps/mobile` scaffolded per the handoff** — Expo SDK 57 (current template), expo-router, RN 0.86,
> `@inspect/mobile` in the workspace with all four shared packages. `/login` and `/inspections` (read-only
> list) are written; `src/lib/session.ts` is the ONLY new auth code — a SecureStore `AuthProvider` with the
> console's 60s refresh skew; the exchange, DTOs, tokens and role gate are all imports. `orgId` is always
> null (D1). Ledger rows flipped to in-progress.
> **(3) The spec §7 React footgun fired, as a TYPE break:** mobile's `@types/react` 19.2.18 won pnpm's
> hidden hoist and broke the CONSOLE's type-check (lucide d.ts vs 19.0.0). Fixed the way the handoff
> prescribed — **React pinned once at the root** (`pnpm.overrides`: react/react-dom 19.2.3, @types ~19.2.2);
> web moved 19.0.0→19.2.3 and its 38-test acceptance suite passed UNCHANGED. The same hoist mechanism let
> eslint-config-expo's `eslint-plugin-react-hooks@7` shadow the bare-name resolution web's FlatCompat uses
> (3 phantom lint errors on untouched files); web now pins `eslint-plugin-react-hooks@5.2.0` locally, and
> mobile's new code complies with the stricter v7 rule instead of suppressing it.
> **(4) Toolchain findings Phase 2 existed to make:** SDK 57 runs under pnpm's ISOLATED installs — no
> `nodeLinker: hoisted`, no hand-written `metro.config.js`; and Metro consumes the shared packages' CJS
> `dist/` fine (plan decision D1 validated) — `expo export` bundles all five routes green.
> **Verified:** type-check **11/11** · lint **3/3, 0 errors** (1 known font warning) · build **6/6** ·
> web **38/3 UNCHANGED** · api unit **656/42** (`--runInBand`) · domain **11/2** · api-client **29/2** ·
> `expo export` green. **NOT verified:** anything on a device — the EAS physical-device acceptance is still
> blocked on [INS-090](future/BACKLOG.md) (no reachable origin); the integration suite was not re-run (no
> API-side change); **CI has still never been read from this machine** (`gh` is unauthenticated — user-side);
> and the manual console click-through remains undone and remains the highest-value hour available.
>
> Prior entry: **2026-08-27 — [INS-086](future/BACKLOG.md) **Phase 1 SHIPPED, merged and pushed**.**
> Merged to `main` as `6ad5a41`; `main` is in sync with `origin/main`. **Ready for handoff: the next task is
> Phase 2, scaffolding `apps/mobile` — see the HANDOFF block under Active work.** CI ran for the first time
> on that push and **its result has not been read from this machine**; confirm it before building on top.
> `@inspect/{api-client,domain,design-tokens}` now exist alongside `shared-types`, and `apps/web` is
> re-pointed at all three. The seam that matters is `createApiClient({ baseUrl, auth })`: HTTP no longer
> reaches into `next/headers` / `next-auth/jwt` itself but receives an **injected auth provider**, so the
> console keeps its server-side-only token model (INS-045) while mobile can hand it a Keychain-backed one.
> `apps/web/lib/api.ts` fell from **635 lines to 232**, and what is left is genuinely Next-specific.
> **The acceptance was "no behavioural change", and it held:** the console's 32 characterization tests
> ([INS-082](future/BACKLOG.md)) passed **unchanged** at every step — they were the instrument, never edited.
> **The phase went beyond the spec's Phase-1 row by explicit choice.** Two items drafted as deferrals were
> folded in: the **34 wire DTOs** moved to `shared-types` (so `apps/web/lib/api.ts` declares no wire shape at
> all — this is what finally closes [INS-008](future/BACKLOG.md)), and **`apps/api/src/auth/rbac.ts` now reads
> `ROLE_RANK` from `@inspect/domain`**, putting the additive hierarchy in exactly one source file. Spec §4.4
> demands each migration *reduce* total logic; moving only the console's copy would have left it at two.
> **Three findings worth carrying forward.**
> **A follow-up drift pass found three more live bugs of ONE shape, and closed the hole they came through.**
> `apiGet<T>(path)` **asserts** a response shape rather than checking one, so a wire DTO that disagrees with
> the API is invisible to `tsc`, to `next build` and to every suite. Cross-checking every DTO field against
> its Prisma model surfaced **five** phantoms, three of them user-visible:
> **(a)** `DefectCatalogItemDto.severity` where `GET /defect-catalog` sends `defaultSeverity` — the populate
> screen groups its defect chips with `catalog.filter(c => c.severity === …)`, so **all three severity groups
> were empty and an inspector could not tag a single catalog defect** on the product's headline screen. It
> was a duplicate, wrong declaration of a row `DefectCatalogDto` already described correctly; deleted, not
> patched. **(b)** `ReportDto.generatedBy`, a relation `Report` has no column for — the branded report's
> tamper-proof block has always rendered `'—'` for "signed by" ([INS-089](future/BACKLOG.md) to record it
> properly; the phantom is removed so nothing reads it again). **(c)** `InspectionDto.inspectorId`, dead and
> dangerous: the only `inspectorId` in the schema lives *inside* `tamperProof` and means the ACTUAL
> submitter, which the schema comment explicitly distinguishes from the assigned inspector.
> **(d)** `GuestReportPhotoDto.inspectionLoopId` — a name **INS-081** retired when loops became loop *items*,
> while `guest.service` selects `inspectionLoopItemId`. It was itself unmapped by the guard's first version,
> which is why the guard now also asserts that **every** DTO is either mapped to a model or explicitly
> declared computed: escaping by omission is the quiet way a guard stops guarding.
> **The hole is now closed permanently:** `apps/api/src/common/wire-contract.spec.ts` asserts every wire DTO
> field exists on the model it describes, with an explicit allowlist for genuine decorations (presigned
> `viewUrl`, `_count`, server-computed `cycleState`). It lives in `apps/api` because the API is the producer
> and `schema.prisma` is its source of truth. Mutation-verified: reintroducing `buyer` fails it. It carries a
> non-vacuity guard too, since a regex that silently matches nothing would make it worse than no test at all.
> It also states what it does **not** catch — nested object shapes, a field the service's `select` omits, and
> types — so a green run is not mistaken for a verified wire. Closing those needs response schemas in
> `openapi.json`, which [INS-084](future/BACKLOG.md) deliberately left out (routes and role floors only).
> **Also fixed in that pass:** [INS-088](future/BACKLOG.md) — `login`/`me`/`refresh` moved into
> `@inspect/api-client`, so `lib/auth.ts` now holds no raw `fetch`, no `Buffer` and no hand-assembled
> `Authorization` header, and Phase 2 cannot implement the exchange a second time. `decodeJwtExp` was rebuilt
> on `atob` + `decodeURIComponent` (neither the edge runtime's `middleware.ts` nor a React Native bundle has
> `Buffer`), with the UTF-8 and base64url-padding cases tested; `next build` still emits Middleware at
> 86.6 kB, which is the edge-safety proof. **Stale INS-055 vocabulary** was swept out of user-facing copy —
> the reports list's column header still read "Buyer", and `/inspections/new`'s empty state told users to
> "create a buyer, supplier, product and PO", naming two screens that no longer exist. **And Prisma's
> interactive-transaction timeout went from the 5s default to 15s**, set once on `PrismaClient` so it covers
> all 31: the integration suite produced `P2028 Transaction already closed … 5292ms` as a 500 on
> `POST /inspections/:id/submit`, because that transaction runs the AQL evaluation, `AqlResult`,
> `BillableEvent`, the status lock and a hash-chained audit append whose advisory lock serialises same-org
> writers. No invariant relaxes — the work is identical, it just gets time to finish before the network kills
> it.
>
> **(1) A real, user-visible bug was hiding behind an optional field.** `ApiReportListItem` declared `buyer`
> while the API selects `clientCompany`, so `app/(console)/reports/page.tsx` rendered `r.buyer?.name ?? '—'`
> — **an em-dash in the reports list's client column for every row since INS-055 shipped.** Optional
> properties make a stale read invisible to `tsc` *as long as the type sits next to its only consumer*;
> moving the DTO into a package turned it into a compile error on the first type-check. This is the class of
> defect the "no manual console pass" gap was always going to be hiding.
> **(2) The vitest alias that protects the suite also hides a missing dependency.** `@inspect/api-client` was
> absent from `apps/web/package.json` and the web suite still went green, because the alias resolves
> `@inspect/*` to package source regardless. `tsc` and `next build` are the real wiring gate — the suite is
> not. Recorded in the root `CLAUDE.md` gotchas.
> **(3) One HTTP call site was deliberately left outside the client.** `lib/auth.ts` still hand-rolls
> `POST /auth/login`, `GET /auth/me` and `POST /auth/refresh` — the three endpoints mobile needs *first*.
> Not folded in because `refreshApiAccessToken` is imported by `middleware.ts` on the **edge runtime**, which
> makes it a re-point with a runtime constraint rather than a lift-and-shift. Filed as
> [INS-088](future/BACKLOG.md); it blocks Phase 2.
> **Two decisions the spec left open, now closed.** *Packaging:* all four packages build to `dist/`, **not**
> source-as-entry as §2.1 suggested — `ts-jest` will not transform TypeScript inside `node_modules`, so a
> source entry would have broken all 634 API tests in a phase whose whole point is being boring. The
> stale-`dist` risk is removed where it is dangerous by aliasing `@inspect/*` to package **source** in
> `apps/web/vitest.config.mts`, so the acceptance instrument always tests what was just written. Revisit for
> Metro in Phase 2. *Spec §9's open question:* `@inspect/domain` does **not** absorb `cycle-state.ts` — the
> console reads `inspection.cycleState` off the API response and never computes it, so there is no
> duplication to remove and no reason to make the API depend on a package it does not need.
> **Verified:** `pnpm type-check` **10/10 clean** · `pnpm lint` **0 errors** (1 pre-existing font warning) ·
> `pnpm build` **6/6** · **web 38 passing / 3 files** (32 unchanged + 6 new token assertions) ·
> **api unit 656 / 42 suites, exit 0** (634 at the extraction, +22 from the new wire-contract guard) ·
> new package suites **`@inspect/domain` 11/2** and **`@inspect/api-client` 29/2**.
> **Integration: 147 passing / 16 suites, exit 0 — the first fully green full run.** Getting there is the
> evidence for the `P2028` diagnosis: three full `--runInBand` runs went **129/147** (5 suites failed, 805s),
> **146/147** (1 suite, 849s) then **147/147** (873s), with the Prisma transaction-timeout fix landing between
> the second and third. The failures never overlapped — `audit-chain` alone produced 3 failures, then 6, then
> 0 on identical code, and passed on `main` too — which is what ruled this branch out as the cause before the
> real one was named. One green run is not proof the flakiness is gone; **CI against containerized Postgres is
> the honest read and has still never run.**
>
> **⚠️ Still NOT verified — and the first item has now cost real money twice:**
> 1. **No manual console pass has ever been performed.** Two sessions of automated green hid two
>    user-visible breakages a single click-through would have caught in a minute: the reports list's client
>    column was an em-dash on every row, and **no catalog defect could be tagged at all** on the populate
>    screen. Both are fixed — but populate is the screen Phase 3 ports to the phone, so anything still wrong
>    there gets carried into the app. This is now the highest-value hour anyone can spend on this project.
> 2. **The API has never run outside `localhost`** ([INS-090](future/BACKLOG.md)) — a deploy to a **remote
>    dev** environment is under way as of 2026-08-27 (there is still no production); the build-order blocker
>    is fixed (`pnpm build:api` / `pnpm build:web`), the rest of the deploy is not. A phone cannot reach
>    `localhost:3000`, so this is what gates Phase 2.
> 3. **CI has still never run on Linux** — `pnpm lint`, the OpenAPI staleness gate, the three INS-055
>    migrations replaying from scratch, and now `wire-contract.spec.ts`. **Phase 1 was pushed on 2026-08-27**
>    (`main` in sync with `origin/main`), so CI has now had its first chance to run — **its result has not been
>    read from this machine**, and confirming it green is the first thing to do.
> 4. **The dev database has no curated workspace** — all 104 orgs are `E2E Org …` fixtures, so a manual pass
>    needs an org + two companies + a product + a PO created first.
> 5. **The PO party pickers still do not rank by role** ([INS-087](future/BACKLOG.md)).
>
> **New gotcha from this phase:** a shared package must be **rebuilt** before the API or `next build` sees a
> change — they resolve `dist/`, and only `pnpm build` / `pnpm type-check` (which carry
> `dependsOn: ["^build"]`) rebuild it for you. Also note `pnpm install` runs `prisma generate`, which fails
> with `EPERM … query_engine-windows.dll.node` while any node process holds the engine; `pnpm install
> --ignore-scripts` is the way through when the schema has not changed.
>
> Prior entry: **2026-08-26 ([INS-055](future/BACKLOG.md) SHIPPED — `Company` is the only counterparty).**
> `Buyer`, `Supplier` and `BuyerGuest` are gone from the schema and the code. Trade role now lives on the
> **edge** (`clientCompanyId` / `factoryCompanyId`), so one company can be the client on one PO and the
> factory on another — the thing the old two-table split could not express. **Phase 0 of the RN programme is
> code-complete and Phase 1 (extraction) is unblocked:** the contract it freezes is the final one.
> **Executed against a re-scoped plan.** The authored 10-phase plan was rewritten in place: the pre-production
> data policy deleted the 1:1 backfill, the lineage columns, the human-adjudicated dedupe, the
> RENAME-to-save-live-tokens migrations and the staged drop, leaving **9 tasks**. Everything that was a decision
> about the *code* survived intact — the two-FK role model, the guest-visibility predicate, canonical v1/v2
> versioning, and the partial CI unique index. All eight P1–P8 product defaults were honoured with no override.
> **Three findings worth carrying forward.**
> **(1) The plan's task split was wrong and the tests proved it.** PO / Inspection / Report / guests were four
> tasks; each denormalizes its parties from the previous one, so the moment the PO stopped writing `buyerId`
> the whole chain went null. They shipped as one commit.
> **(2) Dropping a column does NOT drop the trigger that guards it.** Both INS-014 immutability triggers
> reference `NEW."buyerId"` **by name**; Postgres resolves record fields only when a trigger *fires*, so the
> guard began raising *"The column `new` does not exist in the current database"* on every UPDATE of a
> submitted inspection — a 500 on `POST /inspections/:id/decision`. `pnpm type-check`, `pnpm lint` and **634
> unit tests were all green while that was broken**; only the DB-backed integration suite caught it. Fixed in a
> **separate** migration, because editing an applied one is the checksum drift that blocked `migrate dev` at
> the start of this session.
> **(3) The v1 guarantee is now proven by a fixture the test builds itself**, signing a `buyer`/`supplier`-shaped
> payload with the real key — repeatable, and it survives `prisma migrate reset`. The original gate depended on
> rows surviving a migration, which the data policy deletes. The requirement was always about the **format**.
> **Verified against a reset + reseeded database:** `pnpm lint` 0 errors · `pnpm type-check` 4/4 ·
> **api unit 634 / 41 suites exit 0** · web 32 / 2 · **integration 147 / 16 suites, exit 0 with ZERO SKIP lines**
> (`db-invariants` 12/12 real, not vacuous) · `pnpm build` 3/3 · `prisma migrate diff` "No difference detected" ·
> `openapi.json` regenerated (**`PLATFORM_ADMIN` is down to the 2 `/admin/orgs` operations** — exactly the
> surface the mobile app excludes by design).
> **Merged and closed out.** The work landed on `main` via `032e8ea` (no-ff merge of
> `ins-055-company-model`, which is deleted). `main` is **9 commits ahead of `origin/main` and unpushed** —
> that is the state the session was left in, not an oversight.
>
> **⚠️ NOT verified — the honest gaps, in the order they would bite:**
> 1. **No manual console pass was performed.** Every claim above comes from automated suites. Nobody opened
>    `pnpm dev` and clicked through the new Companies directory, the merged detail form, the two-party PO
>    picker or the guests screen. The API surface is proven live by 147 integration tests; the *screens* are
>    proven only by `tsc` + `next build` + the 32 Vitest tests, none of which render a page.
> 2. **The dev database has no curated workspace.** All **104 orgs / 252 companies / 194 inspections** in it
>    are integration-test fixtures (`E2E Org …`, `E2E Client …`) left by the suites; there is not one
>    hand-made row. Anyone doing a manual pass must create an org + companies + PO first, or the console
>    shows nothing but E2E noise.
> 3. **CI has still never run on Linux.** Unproven there: `pnpm lint` (ESLint 9 flat configs), the OpenAPI
>    staleness gate, and now the **three INS-055 migrations replaying from scratch** — including the ordering
>    where migration B breaks the INS-014 triggers and migration C repairs them. That sequence is correct on
>    this machine only because both were applied in order; a fresh replay is the thing to watch.
> 4. **The PO party pickers do not actually rank by role.** `rankedFor()` in
>    `purchase-orders/new/create-form.tsx` takes a `role` argument and ignores it, because `CompanyDto._count`
>    is flattened across both edges and cannot separate them ([INS-087](future/BACKLOG.md)). Spec §0 P3 promised "rank by recently used in
>    this role" as the replacement for capability flags; today both pickers sort by total PO count then name.
>    Harmless, but it is a promise not kept — fixing it means exposing per-role counts on the DTO.
>
> **Environment gotchas that cost time this session** (all reproducible, none are code defects):
> `pnpm` **9.15.9 is on PATH directly** — `npx -y pnpm@9.12.0` crashes with a V8 fatal error, and
> `pnpm --filter @inspect/api exec jest` reports "Command jest not found"; use
> `apps/api/node_modules/.bin/jest`. The **Prisma CLI needs the repo-root `.env` exported**
> (`set -a && . ./.env && set +a`) — it does not read `../../.env` the way the API's `ConfigModule` does.
> `prisma migrate reset` refuses to run for an AI agent without
> `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=<the user's exact consent text>`, and **prior consent in the
> conversation does not count** — it must be asked for each time.
>
> Prior entry: ** 2026-08-26 (RN migration designed + scaffolded; **Phase 0 substantially complete — 7 of 9
> items closed**).** Approach A is specified ([INS-086](future/BACKLOG.md)) and Phase 0 — the hardening that makes
> the platform safe to refactor — is done except for one user-side item and one deliberately deferred epic.
> **Closed this session:** [INS-082](future/BACKLOG.md) the console's first test suite (Vitest, 32 tests, each
> behaviour mutation-verified); **INS-010/011/014/015/018/046** — the DB-level invariants proved live, and the
> backlog's "Needs a human" note claiming the migration was unapplied had been **stale for three weeks** (it went in
> during INS-081); the genuinely-missing `organization_name_unique` migration applied after renaming an empty
> duplicate "Polo" org, so **all 5 migrations are now applied**; [INS-008](future/BACKLOG.md) the shared-types
> contract, swept in two passes (enums, then the counterparty DTOs the INS-055 gate names) with all 17 enum tuples
> first diffed against the Prisma enums so the sweep could not change a value; [INS-083](future/BACKLOG.md) populate
> opened to `INSPECTOR` with row-level scoping; [INS-048](future/BACKLOG.md) ESLint 9 flat configs for both apps and
> lint is now a **CI gate**; [INS-084](future/BACKLOG.md) a committed OpenAPI contract carrying every route's role
> floor; [INS-034](future/BACKLOG.md) reduced to `guest` alone. [INS-055](future/BACKLOG.md)'s **plan Phase 0 gate is
> met** (P1–P8 signed off, INS-008 verified real, baseline measured) with Phases 1–9 deliberately unstarted.
> **Two findings worth carrying forward:** populate was `@Roles('PLATFORM_ADMIN')` on the *whole* controller, so an
> app with no admin mode could not have captured a single photo — and the fix was not the role floor but the bare
> `findUnique(id)` behind it, which had no tenant filter at all and was safe only while its one caller was
> cross-tenant by design; and [INS-085](future/BACKLOG.md)'s Windows Jest exit-134 **did not reproduce** across four
> consecutive runs on Node 24, so it is annotated rather than closed. The OpenAPI contract independently confirms the
> RBAC re-grade: all 7 populate routes now read `INSPECTOR`, and the **only** `PLATFORM_ADMIN` operations left in the
> entire API are `GET`/`POST /admin/orgs` — exactly the surface the mobile app excludes by design, which means the
> app can now reach everything it needs.
> **Verified end-to-end at close:** `pnpm lint` 0 errors · `pnpm type-check` 4/4 · `pnpm test` 3/3 (**api 597 / 41
> suites**, web 32 / 2) · `pnpm build` 3/3 · **integration 139 passing / 15 suites, exit 0** against the live
> Postgres + Redis + S3, with **zero SKIP lines** so the DB-invariant assertions are real rather than vacuous.
> **Still open in Phase 0:** [INS-002](future/BACKLOG.md) credential rotation (user-side — needs the Railway
> account). [INS-055](future/BACKLOG.md) is the remaining critical-path work and is **now materially smaller**: a
> ⚠️ TEMPORARY policy block was added to the repo-root `CLAUDE.md` on 2026-08-26 declaring this a pre-production
> project whose database holds **nothing of value**, so destructive migrations, clean breaks, resets and free schema
> changes need no hedging. Most of the Company plan's 10 phases exist purely to preserve rows and can be collapsed —
> see the next-session block below. The invariants, tenant isolation and tamper-proof guarantees are unaffected:
> they are properties of the code, not the data, and must still hold and stay tested after any reset.
> **CI is deliberately unverified this session** — 11 commits sit unpushed on `main` and the two new gates (lint,
> OpenAPI staleness) have never run on Linux.
>
> Prior entry: **2026-08-26 (RN migration designed + scaffolded; Phase 0 started — [INS-082](future/BACKLOG.md) DONE:
> `apps/web` has a test suite for the first time).** **Phase 0 progress:** [INS-082](future/BACKLOG.md) landed —
> Vitest in `apps/web` (`pnpm web test`, picked up by root `pnpm test`) with **32 characterization tests across 2
> files** covering the behaviours Phase 1's extraction puts at risk: the additive role hierarchy and its
> fail-closed branch, `ApiError` carrying the HTTP status, the `X-Org-Id` rule (PLATFORM_ADMIN + assumed org only —
> **never** another role holding a stale cookie), the `__Secure-` cookie-name detection, `loadOrFallback`'s full
> branch table (live / unreachable→fallback / 404→fallback / 401 rethrow / 403 rethrow / org-context-403→redirect),
> and the 60s-skew token refresh. **Each behaviour was proven by mutation, not merely by passing** — dropping the
> PLATFORM_ADMIN check, removing the 401 re-throw, and flipping `apiRoleAtLeast`'s fail-closed default each fail
> exactly the one test that should catch them. Verified: `pnpm test` 3/3 tasks green (**api 569 / 39 suites**, web
> 32 / 2), `pnpm type-check` clean 4/4, `pnpm web build` clean. Two incidental findings: the API unit count is
> **569**, not the 565 recorded on 2026-08-13 (drift, corrected below), and **[INS-085](future/BACKLOG.md)'s
> Windows Jest exit-134 did not reproduce** — `pnpm api test` exited 0 on four consecutive runs under Node
> v24.18.0, so the item is annotated rather than closed (four runs cannot prove absence).
>
> The RN programme is filed as [INS-086](future/BACKLOG.md) — a 5-phase epic on **Approach A**: extract the
> platform-free layer into `@inspect/{shared-types,api-client,domain,design-tokens}` shared by both apps, and
> write UI per platform (Server Components, NextAuth's JWE cookie, Tailwind and shadcn do not cross to RN;
> the `Api*` contract, design tokens, role gates and HTTP call sites do). The design half of the session changed
> no application code; the Phase 0 work above did. Design deliverables: the spec
> ([in-progress/specs/2026-08-26-inspect-react-native-migration-design.md](in-progress/specs/2026-08-26-inspect-react-native-migration-design.md)),
> five new backlog items ([INS-082](future/BACKLOG.md) web test runner · [INS-083](future/BACKLOG.md) populate
> RBAC re-grade · [INS-084](future/BACKLOG.md) OpenAPI · [INS-085](future/BACKLOG.md) Jest exit-134 ·
> [INS-086](future/BACKLOG.md) the epic), and the `.claude/` scaffolding — path-scoped rules
> (`wire-contract`, `migration-discipline`), the `migrate-screen` skill, the read-only `screen-cartographer`
> subagent, per-app `CLAUDE.md` files for `apps/api` and `apps/web`, and the screen ledger at
> [reference/screen-migration-map.md](reference/screen-migration-map.md). **Two findings worth flagging:**
> populate is `@Roles('PLATFORM_ADMIN')` on the **whole controller**
> (`populate.controller.ts:25` — presign, register, retake, discard, defects, measurements), so an app with
> no admin mode cannot capture a single photo ([INS-083](future/BACKLOG.md) — still open, and it blocks Phase 3);
> and `apps/web` had **no test runner**, which would have made the Phase 1 extraction unverifiable — closed the
> same day by [INS-082](future/BACKLOG.md), since `tsc` cannot see a behaviour change in `lib/api.ts`. Decisions recorded in the spec §0: full console parity minus
> Platform Admin plus camera, iOS + Android; **offline photo queue**, not full offline-first; **both platforms
> maintained long-term** (which is what makes the "move logic to `@inspect/domain` and re-point web in the same
> change" rule non-negotiable); and [INS-055](future/BACKLOG.md) (Company model) moves **into Phase 0** with all
> eight of its P1–P8 product defaults confirmed, so the contract frozen in Phase 1 is the final one — a shipped
> app build cannot be force-updated the way a console is redeployed. `/admin/orgs`, `/portal` and `/r/[token]`
> stay web-only permanently.
> Prior entry: **2026-08-13 (INS-081 — the loop model reshaped).** A preset **is one loop**, holding ordered
> **single-image loop items**; populate walks them repeatedly, one **cycle per inspected unit**, and can only be
> ended on a cycle boundary — finish the unit or discard it, no third option. Defect tags and the measurement
> sheet moved up to loop level (recorded defects pin to `(cycle, item)`, measurements to a cycle);
> `requiredShotCount` is gone. `@@unique([inspectionLoopItemId, cycleIndex])` makes one-image-per-slot a
> **database** guarantee, and a pure `cycleState()` is shared by the submit guard and the console so the two
> cannot drift. Retake replaces a slot's bytes in place with both content hashes in the audit chain.
> **unit 565 passing / 39 suites, integration 129 passing / 14 suites** against the live Postgres+Redis+S3,
> the 24-step smoke loop green end-to-end (incl. public signature verification on the new snapshot shape),
> `pnpm type-check` and `pnpm build` clean across 3 packages. ⚠️ The clean-break migration was **applied to the
> Railway dev DB** and its `TRUNCATE ... CASCADE` reached further than planned — **buyers, buyer_guests and
> purchase_orders were emptied too** (via `Buyer.defaultLoopPresetId`), so those must be recreated before the
> console can drive an inspection by hand. Details in the spec's §9.
> Prior entry: **2026-08-01 (full backlog-clearing pass — 22 items closed. Report PDF rendering (INS-003),
> audit-on-write across every mutating service (INS-006), the audit sequence race (INS-012), report delivery
> (INS-020), end-to-end AQL configurability (INS-063), rate limiting (INS-047), and the populate/reports/
> lifecycle test gaps (INS-007/019/021) all landed. **unit 533 passing / 38 suites, integration 120 passing /
> 13 suites** against the live Postgres+Redis+S3, `pnpm type-check` clean, `pnpm web build` clean. A
> DB-level-invariants migration (INS-010/011/014/015/018/046) is authored, schema-validated and probed
> against live data but **NOT applied** — see the "Needs a human" section at the end of
> [future/BACKLOG.md](future/BACKLOG.md). Prior entry: object storage verified live against a managed S3-compatible bucket — presigned PUT/GET
> round-trip with sha256 match, CORS preflight OK from the console origin, objects private to unsigned GET; disproves
> INS-060 H1/H2/H3. Storage/MinIO doc + comment staleness swept across CLAUDE.md, `sigv4.ts`, `ci.yml`, the byte spec
> and the buyer-facing report copy; unit 204 green, type-check clean. Prior entry: 2026-07-25 — INS-079 shipped,
> Platform Admin org onboarding + org assumption, `X-Org-Id` resolved in `JwtAuthGuard` only for a verified
> PLATFORM_ADMIN, honest audit attribution via `actorTypeFor` at all 15 call sites, closing INS-078; unit 200 /
> integration 68 green, `pnpm web build` clean).** Source-of-truth dashboard. Keep it current after every session
> (see [CLAUDE.md → Documentation workflow](../CLAUDE.md)). Backlog: [future/BACKLOG.md](future/BACKLOG.md).
> Product: a tamper-proof, AQL-driven pre-shipment QC inspection platform for textiles/garments
> (multi-tenant B2B SaaS; web-first MVP, mobile deferred). Requirements: [done/specs/2026-06-06-inspect-mvp-requirements-design.md](done/specs/2026-06-06-inspect-mvp-requirements-design.md).

## Tests
- **Mobile: no test runner yet** (2026-08-31, [INS-086](future/BACKLOG.md) Phase 2 scaffold). Verified by
  `pnpm type-check` (11 tasks now cover it), `pnpm lint` (expo flat config) and a green `expo export`
  bundle — the same "tsc is the wiring gate" caveat as web applies. Add a runner with the first
  behaviour-bearing screen (Phase 3's capture loop), not before.
- **Web (Vitest, unit): 38 passing across 3 suites** (measured 2026-08-27 at [INS-086](future/BACKLOG.md)
  Phase 1 close). `apps/web/lib/roles.test.ts` (12), `apps/web/lib/api.test.ts` (20) and the new
  `apps/web/components/inspect/tokens.test.ts` (6). **The first 32 are the acceptance instrument for the
  Phase 1 extraction and passed unchanged through all of it** — a red one there is a real regression, never a
  test to update. The 6 new ones assert the composed `ui.font` / `mono` strings verbatim, because a mangled
  font stack fails no build. Run with `pnpm web test`; included in root `pnpm test`.
- **API wire-contract guard: 22 assertions** in `apps/api/src/common/wire-contract.spec.ts`
  ([INS-086](future/BACKLOG.md)) — every DTO field must exist on the Prisma model it describes, every DTO
  must be mapped or explicitly declared computed, and both parsers must have matched something. This is the
  test that would have caught all five phantom fields; it is mutation-verified (reintroducing `buyer` fails
  it) and it documents what it cannot see (nested shapes, omitted `select`s, types).
- **`@inspect/domain` (Vitest): 11 passing across 2 suites** ([INS-086](future/BACKLOG.md) Phase 1) —
  `roles.test.ts` (6: the additive hierarchy, the fail-closed branch for an unknown or missing role, and the
  shape of the single `ROLE_RANK` table both the API and the console now read) and `text.test.ts` (5).
- **`@inspect/api-client` (Vitest): 29 passing across 2 suites** ([INS-086](future/BACKLOG.md) Phase 1) —
  proves the client works with **zero framework mocks**: injected bearer + `X-Org-Id`, **no auth headers ever
  on the public helpers**, `ApiError` carrying status/path/body, validation-array joining, the non-JSON
  fallback message, and 204/empty decoding. The contrast with `apps/web/lib/api.test.ts`'s mock preamble is
  the coupling this package removed. `auth.test.ts` (16, [INS-088](future/BACKLOG.md)) covers the credential
  exchange: login sending no bearer even with a provider configured, `me` using the token it is GIVEN rather
  than the provider's, refresh returning null rather than throwing on every failure path, and `decodeJwtExp`
  on non-ASCII payloads and unpadded base64url — the two cases a naive `atob` gets wrong.
- **API (Jest, unit): 634 passing across 41 suites, exit 0** (measured 2026-08-26 at INS-055 close). Net of
  INS-055: **+20** `reports/canonical.spec.ts` (the pure v1/v2 readers, incl. hostile-marker and spoofed-key
  cases), **+68** `companies/*.spec.ts` (the merged Buyers+Suppliers suites plus `kind` validation and the
  `_count` flattening), **+9** `company-guests.service.spec.ts` (ported, plus a new case proving the audit row
  does **not** contain the magic-link token), **+2** PO self-dealing; **−** the deleted buyers/suppliers/
  buyer-guests suites. Note: root `pnpm test` OOMs under Jest's parallel workers on the dev machine;
  `jest --runInBand` exits 0 (see [INS-085](future/BACKLOG.md)).
- **Integration (Jest, real DB): 147 passing across 16 suites, exit 0** (re-measured 2026-08-27 after the
  Prisma transaction-timeout fix — the first fully green full run; ~14 min against the remote dev DB). New: `company-model.e2e-spec.ts` (8) — PO self-dealing → 400, a cross-org party
  → 400, both parties read back through their relations, **the three guest-visibility boundary tests**
  (a factory-role guest sees zero reports and 404s on the client's report id; a client-role guest sees exactly
  that company's; a guest of one org sees none of another's), and canonical **v1 verifies `valid:true` /
  v2 verifies `valid:true`**. `db-invariants.e2e-spec.ts` ran **12/12 with zero SKIP lines**, so its
  assertions are real — which is what caught the dropped-column trigger defect.
- **Integration (Jest, real DB): 129 passing across 14 suites** (measured 2026-08-13). New in INS-081: `populate-cycles.e2e-spec.ts` — submit blocked mid-cycle naming the unit and its missing item, unblocked by either finishing or discarding the unit, 409 on a filled slot pointing at retake, retake-in-place, per-unit measurement idempotency, and the LOCKED guard covering retake + discard.
- **Superseded baseline — API (Jest, unit): 533 passing across 38 suites** (measured 2026-08-01, all pure-unit, no DB). Grew from 204/26 in the backlog-clearing pass with: `audit.service.spec.ts` (INS-013 — sequence assignment, prevEntryHash linkage, the advisory lock, P2002 retry), `populate.service.spec.ts` (INS-007 — the LOCKED set, catalog-XOR-custom, the cross-tenant orgId derivation, replay/conflict), `reports.service.spec.ts` + `report-pdf.spec.ts` (INS-019/003), `storage.service.spec.ts` (INS-060 placeholder-credential guard), `throttler.config.spec.ts` (INS-047, incl. right-to-left X-Forwarded-For resolution), `dashboard-metrics.spec.ts` (INS-068 DPHU/passRate), `aql-plan-input.spec.ts` (INS-063), `suppliers.service.spec.ts` (INS-071), `products.service.spec.ts` (INS-074), `buyers.controller.spec.ts`, an extended `inspections.service.spec.ts` (INS-021 create/submit/decision lifecycle), and audit-on-write assertions in the buyers + populate specs (INS-006).
- **Superseded baseline — API (Jest, unit): 204 passing** across 26 suites — all pure-unit, **no DB**. Exact per-suite counts, measured 2026-08-01: (AQL 39 + aql-preview 3, auth 26 [rbac 5 / jwt 6 / password 5 / auth.service 10], tamper-proof 14 [canonicalize 5 / content-hash 5 / signature 4], audit-chain 7, storage/sigv4 8, inspection-mapping 6, inspections.service 12, app 1; invitations 10, buyers 10 — security review + sweep; mail 9 + mail-inspection 2, users 16, orgs 4, buyer-guests 4 — INS-004; list-query 5, config 5, loop-presets 10 — 2026-07-12 sweep; **2026-07-18 (meeting batch 1):** `mail-inspection.spec.ts` (status-change email templates) + extended `inspections.service.spec.ts` (submit-evidence gate), `users.service.spec.ts` (self-guards/reactivate/direct-add), `buyers.service.spec.ts` (restore/idempotent re-archive); **new 2026-07-25 (INS-079):** `jwt-auth.guard.spec.ts` (11 cases — the `X-Org-Id` tenant boundary: honored only for a verified PLATFORM_ADMIN, ignored for each org role, absent header leaves orgId null) + `audit/actor-type.spec.ts` (`actorTypeFor` helper) + extended `auth.service.spec.ts`/`buyers.service.spec.ts`/`inspections.service.spec.ts`/`users.service.spec.ts` (actor-attribution at the real call sites).)
- **Integration (Jest, real DB): 120 passing across 13 suites** (measured 2026-08-01). New this pass: `audit-chain.e2e-spec.ts` (INS-012 — concurrent audited mutations produce a gap-free per-org sequence with no P2002 reaching callers, and `verifyChain` passes over the real rows), `populate-invariants.e2e-spec.ts` (INS-007/016 — replay idempotency, the cross-inspection 409, post-lock refusal), `aql-config.e2e-spec.ts` (INS-063 — per-class plan stored and re-derived; 400 not 500 on an out-of-band value or a grid hole), `dashboard-kpi.e2e-spec.ts` (INS-068, tenant-isolated, hand-computed fixture), `rate-limit.e2e-spec.ts` (INS-047 — 429 proven by setting a low limit before boot), and `db-invariants.e2e-spec.ts` (INS-010/011/014/015/018/046 — every test self-skips until the migration is applied, so it is green today and becomes a real assertion the moment it lands).
- **Superseded baseline — Integration (Jest, real DB): 68 passing** across 6 suites (`pnpm api test:integration`, env-driven — repo-root `.env` locally, service containers in CI): the **negative auth/RBAC matrix** (401/403/cross-org; INS-035/036 regressions), the **live token-refresh round-trip**, the **full core loop** + DB-level tamper-evidence (INS-038) + post-lock immutability, the **presigned byte path incl. the GET round-trip** (upload → viewUrl → bytes hash-match, INS-049), **defect replay idempotency** (INS-044), list `_count` aggregates + `q/take/skip` slicing + cross-org search isolation (INS-005/050/051), the **dashboard summary** tenant guard, the **public invitation lookup** state machine (200/404/410, INS-054), `meeting-batch1.e2e-spec.ts` (inspector assigned-scope + start/reset, the submit-evidence gate, PATCH reassign + frozen-after-submit, archive→restore round-trip + cross-org 404, the reports list isolation + no-snapshot + INSPECTOR 403, users self-guards + last-owner + reactivate→login, direct-add→login), **4 more from the 2026-07-18 final whole-branch review**: the platform-admin populate read (C1) + its ORG_OWNER 403, PATCH-assigning a deactivated inspector → 400, unassigning an IN_PROGRESS inspection → 400, and INSPECTOR refused PATCH /inspections/:id → 403, and **new 2026-07-25** `admin-org-assumption.e2e-spec.ts` (8 tests) — the tenant-boundary proof: an admin who assumes org A sees org A's data and not org B's, a write while assuming lands an `AuditLog` row attributed to `actorType: PLATFORM_ADMIN` + the real admin's userId and `verifyChain` still passes (the **first test in this repo to call `verifyChain` against real database rows**), an ORG_OWNER sending `X-Org-Id` is unaffected, and `POST /admin/orgs` 403s a non-admin.
- **CI:** `.github/workflows/ci.yml` (2026-07-11) — Postgres 16 + Redis 7 service containers, MinIO via docker run, per-run Ed25519 key; migrate → seed → type-check → unit → integration → build on every push/PR to main. Lint is NOT gated yet ([INS-048](future/BACKLOG.md) — lint is broken repo-wide).
- **Web: Vitest as of 2026-08-26** (see the first bullet). Before [INS-082](future/BACKLOG.md) the console was verified by `tsc` + `next build` only; coverage today is the two `lib/` modules bound for shared packages, not the screens — no component or route tests exist yet, and `@testing-library/react` is intentionally not installed until the first component test needs it.

## Maturity legend
`production-ready` · `working-with-gaps` · `built-unverified` (compiles + type-checks, **never run against a real DB**) · `planned`

## Where each pillar stands

| Pillar | Maturity | State (one line) | Governing doc | Open backlog |
|---|---|---|---|---|
| AQL domain core | production-ready | Pure ISO 2859-1 / Z1.4 single-sampling Level II engine, fully unit-tested (~39 cases); verified band G–N at AQL {1.0,1.5,2.5,4.0,6.5} + critical Ac0; no DB. | [done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md](done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md) | — |
| Data model & schema | production-ready | **24-model** orgId-scoped Prisma schema, **8 migrations, all applied**. [INS-055](future/BACKLOG.md) unified Buyer+Supplier into one `Company` (trade role on the EDGE: `clientCompanyId`/`factoryCompanyId`); `CompanyGuest` replaces `BuyerGuest`. The DB-level invariants (INS-010/011/014/015/018/046) are applied and **proved live with zero SKIP lines** (12/12). Business keys enforced by partial CI unique indexes. | [reference/inspect-schema.md](reference/inspect-schema.md) | — |
| Tamper-proof & audit | working-with-gaps | canonicalize/content-hash/Ed25519 + audit-chain helper unit-tested (14 + 7); the 2 wired `audit.append` calls (`org.created`, `report.generated`) **executed live 2026-06-20**. **2026-07-11 security review: the audit payload hash now covers actor identity + app-assigned timestamp (INS-039 done) so attribution can't be silently forged; the per-org sequence race is confirmed (INS-012) and its misleading comment corrected.** **The INS-038 tamper guarantee now has a live regression test** (integration suite mutates the stored canonical → public verify flips to invalid). **INS-055: the canonical payload is now VERSIONED** — new reports embed `canonicalVersion: 2` INSIDE the signed envelope; v1 reports (buyer/supplier keys) still verify `valid:true`, proven by a self-built fixture, and `readCanonicalParties()` is the single reader both shapes go through. The INS-014 report/inspection immutability triggers were repointed at the Company columns (a dropped column does NOT drop the trigger that names it). Still: `audit.service` has no DB spec (INS-013), `audit.append` wired into most mutating services (`companies`, `inspections`, `orgs`, `products`, `reports`, `users`, `company-guests` — verified 2026-07-25 via `grep -rl "audit\.append" apps/api/src --include=*.service.ts`; coverage remains partial even within those — e.g. buyers/suppliers/products only audit archive+restore, not create/update) (INS-006), append-only is caller-discipline (no DB triggers, INS-011). | [done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md](done/plans/2026-06-06-inspect-phase1-foundation-domain-core.md) | — *(none open)* |
| Auth & RBAC | working-with-gaps | JWT(HS256)+scrypt+additive RBAC libs unit-tested (25); the **full loop exercises both `PLATFORM_ADMIN` and `ORG_OWNER` live** (2026-06-20). **2026-07-11 security review: removed the source-visible JWT dev-secret fallback and now fail closed at boot without a strong secret (INS-036 done — was a full auth-bypass/forge-admin hole); equalized login timing to stop account enumeration (INS-042 done).** **2026-07-11 INS-009: token refresh + the negative RBAC matrix (401/403/cross-org, forged/expired tokens) verified live by the integration suite.** **2026-07-25 (INS-079): `JwtAuthGuard` now resolves an `X-Org-Id` header into `actingAsOrgId`, honored ONLY for a verified PLATFORM_ADMIN and ignored outright for every other role (11 guard unit tests + a live tenant-boundary integration test prove the boundary — an ORG_OWNER's response is byte-identical with/without the header); all 15 audit-log call sites now attribute assumed-org actions to `actorType: PLATFORM_ADMIN` + the real admin's id via `actorTypeFor`, closing the hole the INS-039 fix would otherwise have reopened.** Rate limiting (INS-047) still open. | [done/plans/2026-06-06-inspect-phase2-auth-tenancy.md](done/plans/2026-06-06-inspect-phase2-auth-tenancy.md) | — *(none open)* |
| Tenancy & onboarding | working-with-gaps | Invite-only org→Org-Owner onboarding + buyer-guest magic-link **verified live end-to-end** (2026-06-20). **2026-07-11 security review: closed a BLOCKER cross-tenant account-takeover in invitation accept (INS-035 done, unit-tested) and switched invitation tokens from the guessable cuid() default to a CSPRNG (INS-037 done).** **Invitation + magic-link emails now sent** via `MailService` (INS-004 done, 2026-07-11 — SMTP_URL transport or dev/json fallback; copyable link still returned as fallback; real-SMTP delivery not yet exercised). | [done/plans/2026-06-06-inspect-phase2-auth-tenancy.md](done/plans/2026-06-06-inspect-phase2-auth-tenancy.md) | — *(none open)* |
| Workspace CRUD | working-with-gaps | Buyers/Suppliers/Products/POs CRUD **create-path verified live** (2026-06-20 smoke loop). **2026-07-11 security review: Buyer.defaultLoopPresetId is now org-validated on create+update (INS-041 done, unit-tested) — closes a cross-tenant preset reference.** Still no full specs (INS-034), **write audit entries only on archive+restore** (INS-061, done) **but none on create/update** (INS-006 — verified 2026-07-25: `buyers`/`suppliers`/`products` `.service.ts` each call `audit.append` only inside `archive()`/`restore()`), Buyers/Suppliers/Products list endpoints carry relation `_count` (POs/inspections/reports) since the INS-005 dynamic-data sweep (done 2026-07-12). | [done/specs/2026-06-06-inspect-mvp-requirements-design.md](done/specs/2026-06-06-inspect-mvp-requirements-design.md) | [INS-034](future/BACKLOG.md) |
| Loop presets | working-with-gaps | Versioned loop-preset create **verified live** (2026-06-20). **Web builder wired (2026-06-28, INS-024)**: full `'use client'` builder with loop sidebar, shot counter, togglable defect chips (live catalog, grouped by severity), measurement fields, custom defect creation, createPreset/archivePreset/createDefect server actions. `/presets/new?from=:id` seeds builder from existing preset. `/presets/[id]` read-only detail page. List has live search/sort/MoreVertical (archive + duplicate). Service still has no spec; photo reference-image upload deferred (INS-023). | [done/specs/2026-06-06-inspect-mvp-requirements-design.md](done/specs/2026-06-06-inspect-mvp-requirements-design.md) | — *(none open; [INS-075](future/BACKLOG.md) superseded)* |
| Inspection lifecycle | working-with-gaps | `inspections.service` create(snapshot)/submit(evaluate→AqlResult+BillableEvent+lock)/decision **verified live end-to-end** (2026-06-20 smoke: code-J, AQL PASS → APPROVED). **2026-07-11 security review: supersedesInspectionId is now org-validated on create (INS-040 done) — closes a cross-tenant link + RE_INSPECTION billing-kind manipulation.** Service still has no unit spec (INS-021); immutability is app-layer status sets only (INS-014). | [done/specs/2026-06-06-inspect-mvp-requirements-design.md](done/specs/2026-06-06-inspect-mvp-requirements-design.md) | — *(none open)* |
| Populate console | working-with-gaps | **2026-08-13 (INS-081): reshaped into a guided cycle** — one loop item on screen at a time, upload advances, the last item rolls to the next unit; a grid exposes every (unit, item) slot; retake replaces a slot in place; the end gate offers exactly two mid-cycle exits (finish or discard the unit) and the API enforces the same rule independently. Photos are slot-addressed and `assignPhotoToLoop` is deleted. `populate.service` **verified live** (2026-06-20) incl. the **cross-tenant Platform-Admin path** (orgId derived from the inspection): presign + register-photo + assign-to-loop + tag-defect + measurement. **2026-07-11: the real photo BYTE path (presigned PUT + true-hash register) now has an e2e that runs in CI vs MinIO** (self-skips locally without Docker); post-lock immutability regression-tested. **2026-07-25 (INS-079): the Platform Admin now reaches the populate console through an assumed org** rather than needing a dedicated cross-tenant entry point — `GET /inspections/:id`, `GET /defect-catalog`, and `POST /inspections/:id/submit` all resolve against the assumed org like any other request, closing INS-078. **2026-08-27:** `populate.service` now has its unit spec (INS-007 done) and the whole populate surface reads `INSPECTOR` (INS-083) — the role floor the mobile app actually carries. ⚠️ The defect-tagging chips were broken until 2026-08-27: the console filtered the catalog on `severity` while `GET /defect-catalog` sends `defaultSeverity`, so every severity group rendered empty and **no catalog defect could be tagged at all**. Fixed, and now guarded by `wire-contract.spec.ts` — but this is the screen Phase 3 ports to the phone and it has never been exercised by hand. | [done/specs/2026-06-06-inspect-mvp-requirements-design.md](done/specs/2026-06-06-inspect-mvp-requirements-design.md) | — *(none open)* |
| Defect catalog | working-with-gaps | Hybrid global(14 seeded)+per-org+free-text catalog; **list read + global-MINOR resolution verified live** (2026-06-20 smoke); controller untested; catalog-XOR-custom enforced app-side only. | [done/specs/2026-06-06-inspect-mvp-requirements-design.md](done/specs/2026-06-06-inspect-mvp-requirements-design.md) | — *(none open)* |
| Reports & verification | working-with-gaps | `reports.service` signed-report generation + **public `GET /reports/verify/:token` verified live** (2026-06-20 smoke). **2026-07-11 security review: the Ed25519-signed canonical now covers the defect list + evidence, quantity/carton verification, notes and decision attribution (INS-038 done — previously alterable under a valid signature), is jsonb-round-trip-normalized, and generate() is now idempotency-safe under concurrency (INS-043 done).** **All four gaps this row used to list are closed** — the PDF binary renders (INS-003), the service has a unit spec (INS-019), delivery sends (INS-020) and `canonicalSnapshot` is non-nullable (INS-046). **2026-08-27:** the canonical payload is versioned (v1 and v2 both verify `valid:true`) and read through the single `readCanonicalParties()`. Open: **nothing records WHO signed** — `Report` has no `generatedByUserId`, so the tamper-proof block shows '—' ([INS-089](future/BACKLOG.md)). | [done/specs/2026-06-06-inspect-mvp-requirements-design.md](done/specs/2026-06-06-inspect-mvp-requirements-design.md) | [INS-089](future/BACKLOG.md) |
| Guest portal | working-with-gaps | Magic-link guest **backend verified live** (2026-06-20 smoke). **Web portal wired (2026-06-28, INS-025)**: `/portal?token=TOKEN` reads the token server-side, fetches `GET /guest/reports?token=…` (unauthenticated), renders buyer-branded report list sidebar + `BrandedReport` detail panel; invalid/expired token shows an error card; "Verify" link → `/r/:verificationToken`; "Download PDF" enabled when `pdfStorageKey` set (INS-003 done — the PDF renders). | [done/specs/2026-06-06-inspect-mvp-requirements-design.md](done/specs/2026-06-06-inspect-mvp-requirements-design.md) | — *(none open)* |
| Web console | working-with-gaps | Next.js 15 console; all major screens wired: operator-loop spine (INS-026/027/028), inspections lifecycle (INS-023/017/032/033), loop presets builder (INS-024), workspace directory (2026-06-28), **guest portal + invite flow (2026-06-28, INS-025/029/030)**: `/portal` live token auth + buyer report list + branded report view; `/invite?token=…` accept form activates account + redirects to login; `/users` inline Invite form with copyable link; per-row role `<select>` live-patches role; Deactivate action via MoreVertical. Shell NAV has Products + Purchase Orders. Photo byte PUT gated on MinIO (INS-023 infra). **Write helpers (apiPost/Put/Patch/Delete) confirmed live + used across every server action → INS-022 done (2026-07-11).** **2026-07-25 (INS-079): Platform Admin now has a working console** — `/admin/orgs` (list, create-org-with-first-owner-invite, Enter workspace), an httpOnly cookie carrying the assumed org (`X-Org-Id` attached only in `apiGet`/`apiSend`), scope-aware nav, a non-dismissible "operating inside «Org»" banner, role-aware middleware routing, and a console `error.tsx` 403 safety net (no-org 403s now redirect server-side from `loadOrFallback` instead of crashing the render) — closing INS-078. **Every gap this row used to list is closed:** list counts (INS-031), PDF rendering (INS-003), the raw API JWT is no longer on the client-visible session (INS-045 — it stays in the encrypted NextAuth cookie), and the shell shows the real org name (INS-080). **2026-08-27 ([INS-086](future/BACKLOG.md) Phase 1):** one Companies directory replaces the Buyers/Suppliers tabs, `lib/api.ts` is a thin Next adapter over `@inspect/api-client`, and `tokens.ts`/`roles.ts` compose from shared packages. Two live bugs found and fixed by the wire-contract audit: the reports list's client column was an em-dash on every row, and **no catalog defect could be tagged at all** on populate. Open: [INS-087](future/BACKLOG.md) picker ranking — and **the console has still never been clicked through by a human**. | [done/specs/2026-06-06-inspect-mvp-requirements-design.md](done/specs/2026-06-06-inspect-mvp-requirements-design.md) | [INS-087](future/BACKLOG.md) |
| Infra & CI | working-with-gaps | Stack **boots and drives the full loop green** against the Railway managed Postgres+Redis (2026-06-20, 25-step smoke; `/health` db+redis up); `.env.example` scrubbed (INS-002, live-cred rotation pending). **2026-07-11: 36-test integration suite green vs the live DB + GitHub Actions CI (containerized Postgres/Redis/MinIO) — INS-009 done; INS-001 closed.** **2026-08-27 ([INS-086](future/BACKLOG.md) Phase 1): the workspace is now FOUR packages** — `shared-types` (the whole wire contract, INS-008 closed), `api-client` (HTTP behind an injected auth provider), `domain` (the single `ROLE_RANK`), `design-tokens`. All build to `dist/`; `apps/web`'s Vitest aliases them to `src`. `pnpm build` 6 tasks, `type-check` 10, `lint` 0 errors. **The integration suite reached 147/147 on 2026-08-27** after Prisma's interactive-transaction timeout was raised from the 5s default to 15s (`P2028` was killing `submit()` at 5292ms against the remote DB); it had gone 129/147 then 146/147 before that. Still: local MinIO needs Docker; **CI has never run on Linux** and **Phase 1 is entirely unpushed** (merged to `main` as `6ad5a41`; 18 commits); and **the API is deployed nowhere** — no Dockerfile, no `railway.json`, no deploy workflow, which is the hard blocker for a phone ([INS-090](future/BACKLOG.md)). | [reference/inspect-build-index.md](reference/inspect-build-index.md) | [INS-002](future/BACKLOG.md), [INS-085](future/BACKLOG.md) |

## Active work

### ▶️ HANDOFF — start here: [INS-086](future/BACKLOG.md) Phase 2, scaffold `apps/mobile`

> **⚠️ Update 2026-08-31: the scaffold below is DONE** on branch `ins-086-phase2-mobile-scaffold` — steps 1–6
> executed (with the React pin landing as `pnpm.overrides` after the footgun fired in types), the
> `AuthProvider` + `/login` + `/inspections` written, the Dockerfiles fixed for [INS-090](future/BACKLOG.md).
> **What Phase 2 still needs to close:** the [INS-090](future/BACKLOG.md) deploy to a reachable HTTPS origin
> (user-side: run the Railway deploy against the rewritten Dockerfiles), an Expo/EAS account (user-side), and
> the physical-device acceptance. The section is kept for its context; treat the steps as executed.

**State on handoff (2026-08-27):** Phase 1 is merged (`6ad5a41`) and **pushed** — `main` is in sync with
`origin/main`, working tree clean. Gates on the merged tree: api **656/42**, web **38/3**, domain **11/2**,
api-client **29/2**, integration **147/147**, type-check **10/10**, lint **0 errors**, build **6/6**.
The backlog has **7 open items** and only two matter: the deploy and this epic.

#### The immediate task

Create the Expo app, get auth working, render the inspections list. **Phase 2's acceptance (spec §6) is one
read-only screen on a PHYSICAL DEVICE via EAS** — deliberately small, because the toolchain is where RN
monorepo projects die and that is worth discovering with one screen at risk rather than twenty.

**Setup, verified against Expo's current monorepo guide (2026-08-27) — do NOT work from memory here, several
of these changed recently:**

1. `pnpm create expo-app apps/mobile`. Name it `@inspect/mobile`, `private: true`. The root
   `pnpm-workspace.yaml` already globs `apps/*`, so it joins the workspace with no config change.
2. **Do not hand-write `metro.config.js`.** SDK 52+ configures Metro for monorepos automatically via
   `expo/metro-config`. If a template ships `watchFolders`, `resolver.nodeModulesPath`,
   `resolver.extraNodeModules` or `resolver.disableHierarchicalLookup`, **delete them** and
   `npx expo start --clear`. Hand-rolled monorepo Metro config is now the bug, not the fix.
3. **pnpm linking depends on the SDK version.** SDK **54+** supports pnpm's isolated installs directly. On
   **SDK 53 or earlier**, add `nodeLinker: hoisted` to `pnpm-workspace.yaml` — and note that changes linking
   for the whole workspace, so re-run every suite afterwards before assuming it was free.
4. **Pin React once at the root** (spec §7's named footgun — a duplicate React in the workspace). Expo's doc
   shows a `resolutions` block; pnpm's own mechanism is `pnpm.overrides`. **Check which the installed pnpm
   honours rather than trusting either** — then have CI assert a single resolved React version.
5. Add the workspace deps: `@inspect/{api-client,domain,design-tokens,shared-types}`, all `workspace:^`
   (matching the existing convention — never a version range, or it may resolve a published package).
6. Give it `type-check` and `lint` scripts so root `pnpm type-check` / `pnpm lint` cover it. Turbo picks them
   up from the `apps/*` glob automatically.

#### What to write, and what NOT to

**Write the `AuthProvider` — not the auth exchange.** The exchange already exists and is shared:

```ts
client.login(email, password)  // -> { accessToken, refreshToken }
client.me(accessToken)         // -> { userId, email, role, orgId, orgName }
client.refresh(refreshToken)   // -> fresh pair + expiry, or null; never throws
decodeJwtExp(token)            // Buffer-free, works in an RN bundle
```

Mirror `apps/web/lib/api.ts`'s `nextAuthContext()`: one function returning `{ token, orgId }`, backed by
`expo-secure-store` instead of the NextAuth cookie. **`orgId` is always null on mobile** — org assumption is
Platform-Admin-only and the app has no Platform Admin mode (decision D1). Then:

```ts
const client = createApiClient({ baseUrl: API_URL, auth: secureStoreAuthProvider });
const inspections = await client.get<InspectionDto[]>('/inspections');
```

**Import, do not re-create:** every wire DTO from `@inspect/shared-types`, `roleAtLeast` / `initialsFrom`
from `@inspect/domain`, and `palette` / `severity` / `roles` / the font stacks from `@inspect/design-tokens`
(compose them into `StyleSheet` the way `apps/web` composes them into CSS — the package is deliberately
CSS-free). **Never import from `apps/web`,** and never add a second `fetch` call site.

**Permanently web-only — do not port, do not add mobile routes for:** `/admin/orgs`, `/portal`,
`/r/[token]`. See `.claude/rules/migration-discipline.md`, which loads automatically for `apps/mobile/**`.

#### The one real blocker

[INS-090](future/BACKLOG.md) — **the API still has no reachable origin.** A deploy to a remote dev
environment is in progress and the build-order blocker is fixed (`pnpm build:api`), but until it is done a
physical device cannot reach the API, so Phase 2 cannot be *finished*. It can be *started*: point
`INSPECT_API_URL` at the dev machine's LAN address and work on the simulator or a phone on the same wifi.
Just do not mistake that for the acceptance — it leaves TLS, CORS, cold starts and token lifetime over a
slow link untested, which is exactly what Phase 2 exists to flush out. **An Expo/EAS account is user-side**
and needed for the device build.

#### Do this before Phase 3, not after

**Click through the console once.** Phase 3 ports populate to the phone, and populate is where the
catalog-defect bug was hiding — every severity group rendered empty, so no catalog defect could be tagged at
all. Porting a screen nobody has driven by hand carries its bugs into native, where they cost far more.
Budget an hour, and create an org + two companies + a product + a PO first: all 104 orgs in the dev DB are
`E2E Org …` fixtures.

#### Decisions taken 2026-08-27 (do not re-litigate)

- **The monorepo stays.** `wire-contract.spec.ts` only works because `schema.prisma` and the DTOs live in one
  repo; the re-point rule (§4.4) is atomic only in one repo; and a shipped app build cannot be force-updated,
  so contract drift is *more* expensive with mobile, not less. Revisit only if a separate team owns mobile.
- **Graphify evaluated and deferred.** It is a code knowledge-graph/indexer, not a change tracker — the
  parity job is already done, and enforced, by the screen ledger plus `wire-contract.spec.ts`. If adopted
  later, gitignore its generated `graph.json` / `GRAPH_REPORT.md`: a committed snapshot is a new stale
  artifact, which is the problem this session spent its time removing.
- **Packaging stays `dist`-based** (plan decision D1). Metro consumes the CJS builds fine, so change nothing
  up front; revisit source-as-entry only if it actually hurts, and keep `@inspect/domain` on `dist` because
  `apps/api` consumes it through `ts-jest`.

#### Also open, none of it blocking

[INS-089](future/BACKLOG.md) record who signed a report (needs a schema change) ·
[INS-002](future/BACKLOG.md) rotate the old dev credentials, and mint a fresh Ed25519 signing key ·
[INS-087](future/BACKLOG.md) PO picker role ranking · [INS-034](future/BACKLOG.md) the `guest` module's spec ·
[INS-085](future/BACKLOG.md) the Windows Jest OOM (use `--runInBand`).

#### Operational notes for whoever picks this up

- **Run the API suites with `jest --runInBand`** (`apps/api/node_modules/.bin/jest`). Root `pnpm test` OOMs
  under Jest's parallel workers on this machine (`FATAL ERROR: Zone Allocation failed`) — the real cause of
  [INS-085](future/BACKLOG.md)'s phantom exit-134. Note `pnpm --filter @inspect/api exec jest` reports
  "Command jest not found"; `pnpm` 9.15.9 is on PATH and `npx -y pnpm@9.12.0` crashes.
- **The integration suite takes ~14 minutes** and needs the repo-root `.env` exported
  (`set -a && . ./.env && set +a`) — the Prisma CLI does not read `../../.env` the way `ConfigModule` does.
  It was flaky before the transaction-timeout fix; if a suite fails, **re-run it in isolation before blaming a
  change** — `audit-chain` once produced 3 failures, then 6, then 0 on identical code.
- **`pnpm install` runs `prisma generate`**, which fails with `EPERM … query_engine-windows.dll.node` while
  any node process holds the engine. `pnpm install --ignore-scripts` is the way through when the schema has
  not changed.
- **A shared package must be rebuilt** before the API or `next build` sees a change — they resolve `dist/`,
  and only `pnpm build` / `pnpm type-check` (which carry `dependsOn: ["^build"]`) do it for you. `apps/web`'s
  Vitest is aliased to package **source**, so it cannot see a stale `dist` — and equally cannot see a
  **missing** workspace dependency. Trust `type-check` for wiring, not the suite.

- **🚧 React Native migration — design + scaffolding done, Phase 0 next (2026-08-26, [INS-086](future/BACKLOG.md)).**
  Approach A (shared logic core, UI per platform) is specified and the `.claude/` machinery to execute it
  screen-by-screen exists. **Phase 0 is the immediate work and it is platform hardening, not mobile code:**
  Tier 1 blocking — ✅ [INS-082](future/BACKLOG.md) (web test runner) **DONE 2026-08-26**; remaining: [INS-008](future/BACKLOG.md) (the
  shared-types import sweep — the dependency edge and turbo build order exist, **zero real imports** do),
  [INS-083](future/BACKLOG.md) (populate → `INSPECTOR`), and reseeding the dev DB whose buyers/buyer_guests/
  purchase_orders were emptied by INS-081's `TRUNCATE … CASCADE`. Tier 2 — apply the authored
  DB-level-invariants migration (INS-010/011/014/015/018/046; written, `prisma validate` clean, live probe
  found 0 violating rows, acceptance test already written and self-skipping — it needs one
  `prisma migrate deploy`), [INS-048](future/BACKLOG.md) lint, the remaining [INS-034](future/BACKLOG.md)
  specs for `defect-catalog` + `purchase-orders`, and [INS-002](future/BACKLOG.md) credential rotation
  (now also gating EAS/app-store credentials). Tier 3 — [INS-084](future/BACKLOG.md),
  [INS-085](future/BACKLOG.md). [INS-055](future/BACKLOG.md) lands **inside** Phase 0, after INS-008, per its
  own spec §8. Nothing in Phases 1–4 starts until Phase 0 closes; Phase 1 is extraction only, with **no mobile
  code in the tree**, and its acceptance is that the console behaves identically.
- **✅ Backlog-clearing pass (2026-08-01).** A sweep of every open `INS-NNN` item closed **22**:
  **tamper-proof & audit** — [INS-006](future/BACKLOG.md) audit-on-write now covers every mutating service
  (buyers/suppliers/products create+update, purchase-orders, loop-presets, defect-catalog, buyer-guests,
  invitation accept, and the whole populate evidence path), each appended INSIDE the business transaction;
  [INS-012](future/BACKLOG.md) killed the per-org sequence race with a transaction-scoped
  `pg_advisory_xact_lock`; [INS-013](future/BACKLOG.md) gave `audit.service` its first spec. **Found and
  fixed en route:** `actorTypeFor` keyed only on `actingAsOrgId`, so a Platform Admin populating
  cross-tenant — who never assumes an org — was recorded as an ordinary `USER`, quietly reopening the
  INS-039 attribution hole; it now keys on the principal's role.
  **Reports** — [INS-003](future/BACKLOG.md) renders the branded PDF from the FROZEN canonical snapshot
  (never live relations) and attaches `pdfStorageKey` without ever letting a rendition failure break the
  signed record; [INS-020](future/BACKLOG.md) delivers it to buyer guests with `ReportDelivery` /
  `ReportAccess` rows; [INS-019](future/BACKLOG.md) specs the signing path.
  **Lifecycle + populate** — [INS-063](future/BACKLOG.md) makes per-class AQL configurable end to end
  (400s instead of 500s on an out-of-band plan; the verified engine grid untouched);
  [INS-021](future/BACKLOG.md)/[INS-007](future/BACKLOG.md) close the two biggest test gaps;
  [INS-016](future/BACKLOG.md) decides the idempotency contract that was left open (same-inspection replay
  returns the original row, cross-inspection reuse is a 409 instead of silently attaching nothing);
  [INS-018](future/BACKLOG.md) ties the billable kind to the supersedes chain.
  **Console + hardening** — [INS-047](future/BACKLOG.md) rate-limits the public routes (per-route, not a
  blanket guard, with right-to-left `X-Forwarded-For` resolution so a client cannot mint a fresh bucket);
  [INS-060](future/BACKLOG.md) stops the console registering phantom photos and stops the API signing URLs
  for placeholder credentials; [INS-068](future/BACKLOG.md) real KPI tiles; [INS-071](future/BACKLOG.md)
  structured supplier coordinates; [INS-072](future/BACKLOG.md) buyer-logo upload storing the DURABLE key,
  never a presigned URL; [INS-077](future/BACKLOG.md) hex validation before it freezes into a signed
  snapshot; [INS-073](future/BACKLOG.md)/[INS-074](future/BACKLOG.md)/[INS-076](future/BACKLOG.md) UX;
  [INS-080](future/BACKLOG.md) the real org name; [INS-045](future/BACKLOG.md) the API JWT out of the
  browser-visible session. [INS-055](future/BACKLOG.md)'s spec + phased plan were written (implementation
  deliberately not started — it needs product decisions).
  **Left for the account owner** (see the "Needs a human" section at the end of
  [future/BACKLOG.md](future/BACKLOG.md)): applying the authored DB-level-invariants migration
  ([INS-010](future/BACKLOG.md)/[INS-011](future/BACKLOG.md)/[INS-014](future/BACKLOG.md)/[INS-015](future/BACKLOG.md)/[INS-018](future/BACKLOG.md)/[INS-046](future/BACKLOG.md) — written, schema-validated,
  probed against live data, refused by the sandbox permission classifier), [INS-002](future/BACKLOG.md)
  credential rotation, the [INS-055](future/BACKLOG.md) product decisions, and the
  [INS-075](future/BACKLOG.md) terminology choice. Not blocked, just out of time:
  [INS-008](future/BACKLOG.md) (dependency wired, import sweep remaining),
  [INS-034](future/BACKLOG.md) (three modules left), [INS-048](future/BACKLOG.md) (lint untouched).
- **✅ INS-079 — Platform Admin org onboarding + org assumption (2026-07-25).** Fixes a live-reported crash: logging in as the seeded Platform Admin (`orgId: null`) 403'd immediately trying to render `/dashboard`, with no route to onboard an org or see any tenant data. API: `JwtAuthGuard` resolves an `X-Org-Id` header into `AuthUser.actingAsOrgId`, honored **only** for a verified `PLATFORM_ADMIN` and ignored outright for every other role, so all 14 existing `requireOrgId` call sites keep working untouched (11 new guard unit tests prove the boundary). Blocking companion: all 15 hardcoded `actorType: 'USER'` audit literals now call `actorTypeFor(actor)`, so an admin acting inside an assumed tenant is honestly attributed as `PLATFORM_ADMIN` + their real user id instead of laundered as an ordinary org user — `ReportsService.generate` was additionally threaded with an actor (it previously recorded none at all). Web: a new `/admin/orgs` console (list, create-org-with-first-owner-invite, Enter workspace), an httpOnly cookie carrying the assumed org, `X-Org-Id` attached in `apiGet`/`apiSend` only, scope-aware nav, a non-dismissible "operating inside «Org»" banner, role-aware middleware routing, and a console `error.tsx` 403 safety net (no-org 403s now redirect server-side from `loadOrFallback` instead of crashing the render). Closes [INS-078](future/BACKLOG.md) as a consequence — the populate-console navigability/403 gaps it described all traced back to the admin never having org context, which org assumption now supplies. Verified: **unit 200 passing / 26 suites, integration 68 passing / 6 suites** (incl. `admin-org-assumption.e2e-spec.ts` — the first test in this repo to call `verifyChain` against real database rows), `pnpm type-check` clean across 3 packages, `pnpm web build` clean (two pre-existing ESLint warnings only, not introduced here). Manual verification (Chrome DevTools against `pnpm dev`): admin login no longer crashes and lands on an Organizations-only console (nav shows only Organizations, sidebar reads "Platform administration", zero console errors); a fresh `GET /dashboard` as an un-assumed admin redirects to `/admin/orgs`; Enter workspace shows the non-dismissible banner + full org nav + dashboard tiles rendering **live per-org data** (not the demo fallback — proving `X-Org-Id` scoping end to end); Exit returns to `/admin/orgs` with the org nav gone; an ORG_OWNER session is unchanged and `/admin/orgs` redirects owners to `/dashboard`; a live tenant-boundary check confirmed an ORG_OWNER's `GET /buyers` response is byte-identical with and without an `X-Org-Id` header, an admin without it 403s, and an admin with it 200s. Found and filed, not fixed (out of scope): [INS-080](future/BACKLOG.md) — every org user's sidebar/topbar shows the hardcoded demo org name `Asha Inspection Services` instead of their real one; this also surfaced a false claim in the 2026-07-12 sweep entry below, corrected in place. Spec + plan: [done/specs/2026-07-25-inspect-platform-admin-org-assumption-design.md](done/specs/2026-07-25-inspect-platform-admin-org-assumption-design.md) · [done/plans/2026-07-25-inspect-platform-admin-org-assumption.md](done/plans/2026-07-25-inspect-platform-admin-org-assumption.md).
- **✅ Meeting batch 1 (2026-07-18).** 12 of the 2026-07-17 product-feedback triage items ([future/BACKLOG.md](future/BACKLOG.md)) shipped on `feat/2026-07-18-meeting-batch-1` (16-task subagent-driven plan, each task code-reviewed clean): **lifecycle correctness** — [INS-056](future/BACKLOG.md) `submit()` now hard-blocks (400, naming every short loop) when a loop has fewer photos than its `requiredShotCount`, and the report preview maps an undecided `qaDecision` to PENDING instead of a fabricated REJECTED; [INS-064](future/BACKLOG.md) fixed the web loop-payload contract drift (`ApiInspectionLoop` now reads the real wire names `zoneName`/`position`/`requiredShotCount`), the prerequisite that had left the populate photo meter reading "N of 0 required". **RBAC + permission hardening** — [INS-057](future/BACKLOG.md) gives INSPECTOR a real assigned-scope (list/get/submit service-scoped to `assignedInspectorId`, foreign rows 404) plus `POST /:id/start` and `POST /:id/reset`; [INS-058](future/BACKLOG.md) adds self-role-change/self-deactivate 403s, last-active-owner protection, and `PATCH /users/:id/reactivate`; [INS-059](future/BACKLOG.md) adds direct add-member (`POST /users`, ACTIVE immediately, invite guards reused); [INS-065](future/BACKLOG.md) relaxes `GET /users` to QA_MANAGER (fixing the empty inspector-assignment dropdown) and role-filters the sidebar nav (fail-closed) + gates `/inspections/new` server-side. **Reversibility + visibility** — [INS-061](future/BACKLOG.md) adds idempotent `POST /:id/restore` on buyers/suppliers/products (audit rows on archive + restore); [INS-062](future/BACKLOG.md) adds an org-scoped `GET /reports` list (QA floor, q/take/skip, joins, never `canonicalSnapshot`) + a `/reports` console screen with verify links; [INS-066](future/BACKLOG.md) adds `PATCH /inspections/:id` (pre-submission reassign + lotSize with sampling recompute, 400 not 500 on out-of-band plans; SUBMITTED+ stays frozen) plus a row action menu (Open/Copy link/Start/Reset/Reassign); [INS-067](future/BACKLOG.md) adds an Archived chip, dimmed rows, an AA-passing badge, a tokenized `ui.danger` red, and the design system's first modal (`ConfirmDialog`, used for the cannot-be-stopped start confirmation and Archive). **Notifications + polish** — [INS-069](future/BACKLOG.md) sends internal status-change emails (submit → ACTIVE QA_MANAGER+ recipients, decision → assigned inspector + owners), fired post-commit and never-throwing; [INS-070](future/BACKLOG.md) scrubs the platform legend + dead platform-status paths from the org-facing users screen, replaces the DEACTIVATED→"Cross-tenant" mislabel with real badges, and adds the reactivate affordance + a direct-add form. Verified: **unit 183 passing / integration 60 passing**, `pnpm type-check` clean, `pnpm web build` clean. Spec + plan: [done/specs/2026-07-18-inspect-meeting-batch-1-design.md](done/specs/2026-07-18-inspect-meeting-batch-1-design.md) · [done/plans/2026-07-18-inspect-meeting-batch-1.md](done/plans/2026-07-18-inspect-meeting-batch-1.md). A whole-branch review followed the 16-task plan and fixed what it found: the platform-admin populate read path (C1 — the submit gate had otherwise dead-ended the console loop), role gates on the review and users screens (the two RBAC relaxations had exposed screens whose controls 403), ACTIVE-only inspector assignment, the IN_PROGRESS-unassign refusal, and a controlled role select that reverts a refused change — plus [INS-078](future/BACKLOG.md) was filed for the residual platform-admin console gaps the review could not fix in-branch.
- **🗒️ Product-feedback triage (2026-07-18).** The 2026-07-17 product-review meeting's decisions + next steps were verified against the code by a 10-agent read-only sweep and filed as **[INS-055..INS-077](future/BACKLOG.md)** (9 HIGH / 10 MEDIUM / 4 LOW; no code changed). Headliners: the **Company-model epic** ([INS-055](future/BACKLOG.md) — unify Buyer/Supplier; spec first, additive phased migration; the signed-canonical payload shape and the buyer-guest visibility scope are the invariants at stake) and **submit() minting a PASS from absent evidence** ([INS-056](future/BACKLOG.md) — no completeness gate; the UI can't even warn because of the [INS-064](future/BACKLOG.md) loop-payload contract drift that leaves the populate photo meter reading "N of 0 required"). Permission gaps: self-role-change/self-deactivation/last-owner guards are web-only ([INS-058](future/BACKLOG.md)), INSPECTOR is locked out of ALL inspection routes by the controller-wide QA floor and no start transition exists ([INS-057](future/BACKLOG.md)), and QA_MANAGER's inspector-assignment dropdown 403s empty ([INS-065](future/BACKLOG.md)). The reference-image "failed to fetch" bug root-caused to the browser→storage byte path ([INS-060](future/BACKLOG.md): presign mints URLs to a dead/unprovisioned S3 endpoint — CHANGE_ME creds pass the guard, no bucket-init, no storage-host CORS; populate silently registers phantom photos on top). Found already shipped (only labels/polish remain): brand-color picker, required-shots default 1, duplicate-on-edit preset behavior, PLATFORM_ADMIN hidden at the API, inspector create-block. Discussed but not filed: third-party LLM cost optimization (OpenRouter) — no LLM surface in the product yet.
- **✅ Dynamic-data hardening sweep (2026-07-12).** A 4-agent audit found **59 stale/hardcoded/static pieces**; a full spec + 17-task plan ([done/specs/2026-07-12-inspect-dynamic-hardening-design.md](done/specs/2026-07-12-inspect-dynamic-hardening-design.md) · [done/plans/2026-07-12-inspect-dynamic-hardening.md](done/plans/2026-07-12-inspect-dynamic-hardening.md)) made every one functional: **truth fixes** (static /populate + /report mocks retired, fake shell affordances removed, honest invite/guest UX with `emailSent` + real expiries, phantom API fields dropped, demo-fallback sampling numbers gone); **dynamic core** — [INS-005](future/BACKLOG.md) `_count` aggregates + `GET /dashboard/summary`, [INS-031](future/BACKLOG.md) real counts/tiles/last-activity, `/auth/me` returning `orgName` (**correction, 2026-07-25: this was never actually wired into the shell** — `app/(console)/layout.tsx` passes `org={undefined}` for every non-admin session, which falls back to the hardcoded demo constant `DEFAULT_ORG`; filed as [INS-080](future/BACKLOG.md)), `lastLoginAt` stamped, inspection detail carries loop photos/defects/measurements (populate evidence no longer vanishes on reload), real report meta incl. per-buyer brand color; **features** — [INS-049](future/BACKLOG.md) presigned photo **viewing** (thumbnails + CI-verified byte round-trip), [INS-050](future/BACKLOG.md) server `q/take/skip` + real pagination, [INS-051](future/BACKLOG.md) org-scoped `GET /search` + ⌘K palette, [INS-052](future/BACKLOG.md) preset-builder reorder/reference-image upload/AQL-II honesty guard, [INS-053](future/BACKLOG.md) config hardening (CORS allowlist, env TTLs, fail-loud S3, fail-closed bootstrap), [INS-054](future/BACKLOG.md) verified `/invite` via public invitation lookup (200/404/410), [INS-044](future/BACKLOG.md) DefectInstance idempotency **migration** applied. Suite: **162 unit / 44 integration** green vs the live DB, type-check + `next build` clean.
- **✅ INS-001 CLOSED + both in-progress plans completed (2026-07-11).** The two remaining `docs/in-progress` plans ([INS-001 stand-up](done/plans/2026-06-20-ins-001-stand-up-and-verify.md), [phase-2 auth & tenancy](done/plans/2026-06-06-inspect-phase2-auth-tenancy.md)) were driven to completion and moved to `done/`: **(a)** [INS-009](future/BACKLOG.md) done — a 36-test Jest integration suite (`apps/api/test/integration/`) folds the smoke loop into CI-runnable tests and adds the **negative RBAC matrix** (401 garbage/forged-dev-secret/expired/refresh-as-access; 403 role floors + no-org-admin guard; cross-org 404s + INS-035 cross-tenant-invite refusal), the **live token-refresh round-trip**, **DB-level tamper-evidence** (mutate stored canonical → public verify flips invalid → restore) and post-lock immutability — all green vs the live Railway DB; **(b)** `.github/workflows/ci.yml` runs migrate→seed→type-check→unit→integration→build against containerized Postgres 16/Redis 7/MinIO on push/PR; **(c)** [INS-004](future/BACKLOG.md) done — invitation + buyer-guest magic-link email via `MailService` (see entry below); **(d)** [INS-023](future/BACKLOG.md)'s byte path — presigned PUT of real bytes + true-hash register — exercised in CI. Suite counts: **135 unit / 36 integration**, type-check clean; **CI run #1 green on GitHub** (all steps, MinIO byte path included). A post-merge **adversarial review pass** (5 dimensions → 2 skeptics per finding) confirmed and this session fixed: SMTP sends now use **short timeouts** (nodemailer's 30–120s defaults would stall invite/onboarding requests on a black-holed SMTP host), a **malformed/scheme-less SMTP_URL degrades loudly to dev/json mode instead of crashing boot**, dev/json mode now **actually logs** each message (the docs claimed it did; it didn't), invite/guest responses expose `emailSent`, the storage probe is **bucket-aware** (+`REQUIRE_STORAGE=1` in CI so a MinIO regression can't silently drop INS-023 coverage), and the tamper test restores the snapshot in a `finally`. Found en route: the Railway bootstrap-admin password had drifted from the regenerated root `.env` (re-seeded to converge — the seed upsert is designed for this) and the stock `app.e2e-spec.ts` supertest import had never compiled (fixed). Filed [INS-048](future/BACKLOG.md) (lint broken repo-wide → not CI-gated). **Still open, user-side ([INS-002](future/BACKLOG.md)): rotate the Railway creds; decide on history scrub.**
- **✅ Business-logic + security review pass (2026-07-11).** A multi-agent bug hunt (10 subsystem finders → 2 adversarial verifiers per finding) swept the domain core; the **AQL engine came back clean**. It surfaced and this session **fixed 9** confirmed defects: **1 BLOCKER** — cross-tenant account takeover via invitation accept ([INS-035](future/BACKLOG.md)); **4 HIGH** — forge-PLATFORM_ADMIN via a source-visible JWT dev-secret fallback ([INS-036](future/BACKLOG.md)), guessable cuid() invitation tokens ([INS-037](future/BACKLOG.md)), the signed report canonical omitting the defect list/quantity/notes ([INS-038](future/BACKLOG.md)), and forgeable audit attribution ([INS-039](future/BACKLOG.md)); **2 MEDIUM** — unvalidated `supersedesInspectionId` ([INS-040](future/BACKLOG.md)) and cross-tenant `Buyer.defaultLoopPresetId` ([INS-041](future/BACKLOG.md)); **2 LOW** — login-timing enumeration ([INS-042](future/BACKLOG.md)) and non-idempotent report generation ([INS-043](future/BACKLOG.md)). Added **11 regression tests** (invitations + buyers service specs) → **111 green**, type-check clean. New follow-ups filed: [INS-044](future/BACKLOG.md) (DefectInstance idempotency), [INS-045](future/BACKLOG.md) (web session leaks the API JWT), [INS-046](future/BACKLOG.md) (canonicalSnapshot NOT NULL), [INS-047](future/BACKLOG.md) (rate limiting); [INS-012](future/BACKLOG.md)/[INS-016](future/BACKLOG.md) annotated. Also flipped [INS-022](future/BACKLOG.md) (web write helpers) to **done**.
- **INS-001 + INS-002 (started 2026-06-20; INS-001 closed 2026-07-11).** DB-free readiness landed first: `.env.example` scrubbed to placeholders, a local `.env` + a fresh Ed25519 signing key generated, `prisma validate` + `prisma generate` green. Runbook + findings: [done/plans/2026-06-20-ins-001-stand-up-and-verify.md](done/plans/2026-06-20-ins-001-stand-up-and-verify.md).
- **DB-free prep also landed (2026-06-20):** the web write helper `apiPost/Put/Patch/Delete` + `ApiError` ([INS-022](future/BACKLOG.md), type-checked) and the first-Platform-Admin bootstrap in `prisma/seed.ts` (Task 0 — env-driven, idempotent) — so once a DB exists the stand-up is migrate → seed (admin included) → log in → drive the loop.
- **✅ Stack runs end-to-end (2026-06-20).** Wired `.env` to the **Railway managed Postgres + Redis** (public TCP proxy) instead of local Docker. `prisma migrate deploy` applied the init migration to an empty Postgres 16 (**all 25 tables created**); `db seed` loaded the 14 global defects + bootstrapped the first Platform Admin. The **API boots on :3000** and `GET /health` returns **`database: up` + `redis: up`**; `POST /auth/login` (bootstrap admin) issues a JWT and `GET /auth/me` returns the principal — the auth round-trip (scrypt + JWT + guards) and tenant-scoping (an org-scoped route correctly 403s the no-org admin) are **verified live**. The **web console runs on :3001**.
- **✅ Full loop verified live (2026-06-20).** A committed, framework-free smoke driver (`apps/api/scripts/smoke-loop.mjs`) drove **all 25 steps 2xx** against the Railway DB: admin login → create org → accept owner invite → workspace CRUD → inspection → **cross-tenant Platform-Admin populate** → submit (AQL → PASS, code J) → QA decision → Ed25519-signed report → **public verify** (valid+hashMatches+signatureValid) → buyer-guest magic-link fetch. INS-001 acceptance (a)+(b) met. Runbook + step list: [done/plans/2026-06-20-ins-001-stand-up-and-verify.md](done/plans/2026-06-20-ins-001-stand-up-and-verify.md).
- **INS-001 acceptance (c) closed 2026-07-11** (see the top entry): 36-test integration suite green vs the live DB + CI against containerized services; the byte path is exercised in CI.
- **INS-002 still pending (user-side):** rotate the Railway `POSTGRES_PASSWORD`/`REDIS_PASSWORD` (these are temp creds, but they remain in git **history**; working tree is clean) and decide whether to scrub history.
- **Now unblocked:** every HIGH web-write item (INS-022/023/024/026/027) and the aggregation/audit-on-write work can be developed + verified against a DB that is known to run.
- **✅ Web operator-loop spine wired + verified live (2026-06-20).** First frontend-integration slice (subagent-driven: 5 tasks, each task-reviewed, + a clean whole-branch review): real session/sign-out, PO-driven create → submit → QA decision, an inspections list, and a read-only `GET /inspections/aql-preview` endpoint (TDD, reuses the verified engine). Pattern: Server Components (reads) + Server Actions (writes), JWT server-side only. Runtime check: NextAuth login → `/inspections` + `/inspections/new` render 200 with the real Org-Owner identity and live PO/preset/AQL data; API suite 100 green, type-check clean. Closes [INS-026](future/BACKLOG.md)/[INS-027](future/BACKLOG.md)/[INS-028](future/BACKLOG.md). Spec + plan: [done/specs/2026-06-20-inspect-web-operator-loop-spine-design.md](done/specs/2026-06-20-inspect-web-operator-loop-spine-design.md) · [done/plans/2026-06-20-inspect-web-operator-loop-spine.md](done/plans/2026-06-20-inspect-web-operator-loop-spine.md).
- **✅ Inspections lifecycle wired (2026-06-28).** 7-task plan executed: (A) `lib/api.ts` extended with populate + report + verify shapes; (B) populate server actions (presign/register/defect/measurement); (C) `/inspections/[id]/populate` PLATFORM_ADMIN workspace client component; (D) `BrandedReport` refactored to typed `BrandedReportData` prop + `/inspections/[id]/report` page; (E) public `/r/[token]` verify page outside console group; (F) `?status=` filter bar on inspections list; (G) review page contextual links (Populate / View report / Re-inspect) + `reInspection()` server action. `pnpm type-check` 3/3 clean, 100 API tests green. Closes [INS-023](future/BACKLOG.md)/[INS-017](future/BACKLOG.md)/[INS-033](future/BACKLOG.md); advances [INS-032](future/BACKLOG.md). Plan: [done/plans/2026-06-20-inspect-web-inspections-lifecycle.md](done/plans/2026-06-20-inspect-web-inspections-lifecycle.md).
- **✅ Loop presets builder wired (2026-06-28, INS-024).** 6-task plan executed: (A) `lib/api.ts` extended with `ApiMeasurementField`, `ApiAllowedDefect`, `ApiPresetStep`, `ApiLoopPresetDetail`, `ApiDefectCatalog` + `aqlLevel`/`updatedAt` on `ApiLoopPreset`; (B) `presets/actions.ts` server actions (`createPreset`, `archivePreset`, `createDefect`); (C) `presets/new/builder.tsx` full `'use client'` builder — loop sidebar, +/− shot counter, severity-grouped defect chips (toggleable, live catalog), measurement fields, custom defect creation; (D) `presets/new/page.tsx` async server shell loading catalog + optional seed; (E) `presets/[id]/page.tsx` read-only detail page with "Edit (new version)" link; (F) `presets-list.tsx` `'use client'` list with search/sort/MoreVertical (archive + duplicate). `pnpm type-check` clean, 100 API tests green. Closes [INS-024](future/BACKLOG.md). Plan: [done/plans/2026-06-20-inspect-web-loop-presets.md](done/plans/2026-06-20-inspect-web-loop-presets.md).
- **✅ Guest portal + invite flow wired (2026-06-28, INS-025/029/030).** 4-phase plan executed: (A) `lib/api.ts` extended with `apiGetPublic`/`apiPostPublic` (unauthenticated helpers) + `ApiGuestReport` + `ApiInvitation`; (B) `/portal` fully live — server component reads `?token=`, fetches `GET /guest/reports?token=…`, passes to `PortalClient` (report list sidebar + `BrandedReport` panel, status chips, Verify/Download PDF links, error cards for missing/invalid token); (C) `/invite` accept form — reads `?token&email&role` from URL, `AcceptForm` client component wired to `acceptInvitation` server action (`POST /invitations/accept`), redirects to `/login?invited=1` with a success banner; (D) `/users` wired — inline invite form (`POST /users/invite`) shows copyable link on success; per-row role `<select>` live-patches via `PATCH /users/:id/role`; Deactivate via MoreVertical. `pnpm type-check` clean, 100 API tests green. Closes INS-025, INS-029, INS-030. Plan: [done/plans/2026-06-28-inspect-web-portal-and-invite.md](done/plans/2026-06-28-inspect-web-portal-and-invite.md).
- **✅ Workspace directory wired (2026-06-28).** 8-phase plan executed: (A) `lib/api.ts` extended with `ApiBuyer.branding/defaultLoopPresetId`, `ApiSupplier.gps`, `ApiProduct`, `ApiBuyerGuest`, `ApiPurchaseOrder.totalQuantity`; (B) `dashboard/actions.ts` server actions for buyer/supplier CRUD; (C) `dashboard/directory-client.tsx` full `'use client'` directory — tab switch (buyers/suppliers), search filter, per-row MoreVertical (edit/archive/manage-guests), inline Add Buyer + Add Supplier forms via `useActionState`; (D) `buyers/[id]/` detail + edit-form (name/logoUrl/color/preset), `suppliers/[id]/` detail + edit-form (name/address/gps); (F) `products/` — list, new, `[id]` edit/archive (actions.ts); (G) `purchase-orders/` — list, new (buyer/supplier/product selects), `[id]` edit/delete; (H) `buyers/[id]/guests/` — invite form (email+expiry) with copyable token display + revoke buttons; shell NAV extended with Products + Purchase Orders nav items. `pnpm type-check` clean, 100 API tests green. Plan: [done/plans/2026-06-20-inspect-web-workspace-directory.md](done/plans/2026-06-20-inspect-web-workspace-directory.md).

- **✅ Email delivery wired (2026-07-11, INS-004).** `@Global` `MailModule` + `MailService` (`nodemailer`): `SMTP_URL` SMTP transport, or dev/json fallback (logged once at boot) when unset. `users.invite`, `orgs.create` (first ORG_OWNER, sent after the transaction commits), and `buyer-guests.invite` now await `sendUserInvitation` / `sendBuyerGuestMagicLink`, building links on `WEB_BASE_URL` (`/invite?token&email&role`, `/portal?token`, URL-encoded). Send methods **never throw** — failures log + return `{sent:false}` so the business write survives; each response keeps the copyable link as fallback. New env: `SMTP_URL`/`MAIL_FROM`/`WEB_BASE_URL` (`.env.example` + `turbo.json` globalEnv). 24 new unit tests (mail/users/orgs/buyer-guests specs, incl. post-merge security reconciliation + review fixes) — API suite **135 green**, type-check clean. Not yet exercised against a real SMTP server. Report-delivery email remains [INS-020](future/BACKLOG.md) (blocked on INS-003 PDF).

## Map
- Shipped: [done/](done/) · In progress: [in-progress/](in-progress/) · Drafts: [future/](future/) · Living refs: [reference/](reference/) · Backlog: [future/BACKLOG.md](future/BACKLOG.md)
- Historical handoff (superseded by this dashboard): [done/plans/2026-06-07-inspect-status-and-next-steps.md](done/plans/2026-06-07-inspect-status-and-next-steps.md)
