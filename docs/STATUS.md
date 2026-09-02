# Project Status — Inspect

> **Last verified: 2026-09-02.** This is the source-of-truth dashboard: current state only.
> The long per-session history that used to stack here was trimmed 2026-09-02 — it lives in git
> history (`git log -- docs/STATUS.md`) and in the backlog archive
> ([done/2026-09-02-backlog-archive.md](done/2026-09-02-backlog-archive.md)). Open work:
> [future/BACKLOG.md](future/BACKLOG.md). Screen-by-screen mobile state:
> [reference/screen-migration-map.md](reference/screen-migration-map.md).

## Where the project stands

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
3. `eas build --profile preview --platform android` (`eas` is already authenticated as
   donanlumina; project `@donanlumina/inspect` is linked). Walk the ledger on the device.

## What exists, by pillar

| Pillar | State |
|---|---|
| **Domain core** (AQL engine, tamper-proof crypto, audit chain, cycle state, auth primitives) | Pure TypeScript, unit-tested: **api 659 tests / 42 suites**. |
| **API** (NestJS 11 + Prisma 6, 24 org-scoped models) | All routes role-floored (OpenAPI carries `x-required-role`); DB-backed integration suite **147/16** runs green in CI against containers. Duplicate styleNumber/poNumber now proper 409s (fixed 2026-09-02). |
| **Web console** (Next.js 15) | All screens live-wired; clicked through end-to-end 2026-08-31 (signed report + guest portal verified in a real browser). Six live bugs found by the Phase 4 contract passes were fixed 2026-09-02 (see below). **38 Vitest tests.** |
| **Mobile** (`apps/mobile`, Expo SDK 57) | **25 routes — the full Phase 4 surface**: login · dashboard hub · inspections (list/new/capture/review/report) · reports · companies (list/detail/guests) · products×3 · purchase-orders×3 · users · invite · presets (list/detail/builder). Capture carries the spec §5.1 offline photo queue (hash-at-capture, stable clientRequestId, 409→human-resolved conflict, submit blocked while queued). **15 Vitest tests** on the pure capture core. Nothing device-verified yet. |
| **Shared packages** | `@inspect/shared-types` (every wire shape — ~14 more moved in 2026-09-02; guarded by `wire-contract.spec.ts`), `@inspect/api-client` (29 tests), `@inspect/domain` (**29 tests**: ROLE_RANK, status sets + STATUS_BUCKETS, report display rules, `reportNumber`, `initialsFrom`, `hashIndex`, `rankCompaniesByActivity`), `@inspect/design-tokens` (+`brandFallbacks`). |
| **Deploy** (Railway project QCLink — a DEV environment) | API `Main Application` live at `main-application-production-6fa4.up.railway.app` (Dockerfile build, `/health` check, pre-deploy `migrate deploy` + seed, fresh signing key), console `serene-vision` at `serene-vision-production-8387.up.railway.app`, Postgres + Redis + bucket. Auto-deploys on push to `main`. Runbook: [reference/deploy-railway.md](reference/deploy-railway.md). |
| **CI** (`.github/workflows/ci.yml`) | migrate→seed→type-check→api Jest→all Vitest suites→integration→builds→lint→OpenAPI staleness→single-resolved-React assertion. **Green on every 2026-09-02 push (10/10 commits).** |

**Verified numbers (2026-09-02):** type-check 11/11 · lint 0 errors (1 known font warning) ·
api 659/42 (serial on Windows — INS-085) · web 38/3 · domain 29/6 · api-client 29/2 · mobile 15/1 ·
integration 147/16 (CI) · `expo export` 25 routes.

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
  2026-08-31 click-through in git history for the full fixture set).

## Open backlog (6 items)

[INS-002](future/BACKLOG.md) credential rotation
(user-side) · [INS-086](future/BACKLOG.md) epic (device pass) · [INS-089](future/BACKLOG.md) record
the report signer · [INS-034](future/BACKLOG.md) guest module spec · [INS-087](future/BACKLOG.md)
per-role picker ranking · [INS-085](future/BACKLOG.md) Windows Jest workers (annotated).
