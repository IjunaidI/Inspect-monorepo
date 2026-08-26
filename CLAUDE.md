# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Inspect** is a tamper-proof, AQL-driven pre-shipment QC inspection platform for the textile/garment
industry — a multi-tenant B2B SaaS. An inspector walks a product through guided photo "loops", the system
runs an ISO 2859-1 / Z1.4 acceptance-sampling calc, a QA Manager makes the binding pass/fail call, and a
per-buyer-branded PDF report is generated and **Ed25519-signed** so the buyer can verify it independently.
MVP is **web-first** (admin/QA console + API); mobile camera capture is a deliberate Phase-2 follow-up.

> ## ⚠️ TEMPORARY — pre-production: the database holds nothing of value
>
> **This project is in development and has no production deployment.** The Railway database is a scratch
> dev database. **No data in it is important**, and no decision should be shaped by a wish to preserve it.
>
> Concretely, you do **not** need to weigh, hedge, or ask permission before:
> - dropping, recreating, truncating or reseeding any table;
> - writing destructive or irreversible migrations — including the `Company` model's merge and
>   table-drop phases ([INS-055](docs/future/BACKLOG.md) Phases 2 and 8);
> - `prisma migrate reset`, or a clean-break migration that abandons existing rows;
> - changing the schema freely, including renaming or removing columns and models.
>
> Pick the **correct end-state design** and migrate to it directly. Do not carry backfills, compatibility
> shims or lineage columns that exist only to protect dev rows — they are cost with no benefit here.
>
> What this does **not** relax: the domain invariants below, tenant isolation, and the tamper-proof/audit
> guarantees. Those are correctness properties of the code, not of the data, and every one of them still
> has to hold — and stay tested — after any reset. Signed-artifact rules (a report's canonical snapshot is
> frozen, verification must still pass) apply to reports the code produces *after* the change, even when
> every historical row is thrown away.
>
> **Remove this block before any real deployment or first real customer data.**

> **Start every session at [docs/STATUS.md](docs/STATUS.md)** — the source-of-truth dashboard. Open work is
> [docs/future/BACKLOG.md](docs/future/BACKLOG.md) (`INS-NNN` ids). Requirements (frozen v1.0):
> [docs/done/specs/2026-06-06-inspect-mvp-requirements-design.md](docs/done/specs/2026-06-06-inspect-mvp-requirements-design.md).
> Schema rationale + invariants: [docs/reference/inspect-schema.md](docs/reference/inspect-schema.md).

## Repository layout

A **pnpm + Turborepo monorepo** (real workspaces — `pnpm-workspace.yaml` globs `apps/*` + `packages/*`, so a
single `pnpm install` at the root installs everything):

- `apps/api/` — **NestJS 11 + Prisma 6** API (port **3000**, override via `API_PORT`). The RBAC authority + domain core.
- `apps/web/` — **Next.js 15** App-Router console (port **3001**, hardcoded in its `dev`/`start` scripts). React 19, NextAuth v5, Tailwind, shadcn/ui.
- `packages/shared-types/` — `@inspect/shared-types`: the **wire contract** — enum unions, JSON-column
  contracts, and every request/response DTO. Imported by both apps ([INS-008](docs/future/BACKLOG.md) done).
- `packages/api-client/` — `@inspect/api-client`: one dependency-free `fetch` client, parameterised by base
  URL and an **injected auth provider**. Owns HTTP, never auth — it must not read a cookie, `next/headers`
  or `expo-secure-store`. See [`.claude/rules/wire-contract.md`](.claude/rules/wire-contract.md).
- `packages/domain/` — `@inspect/domain`: platform-free rules with no I/O and no React. Holds the single
  `ROLE_RANK` table that both the API's `RolesGuard` and the console read.
- `packages/design-tokens/` — `@inspect/design-tokens`: the palette, font **stacks** and severity/role maps.
  Deliberately free of CSS — `var(--font-sans)` and `CSSProperties` are composed in `apps/web`.

All four packages build to `dist/` and are consumed through it; `apps/web`'s Vitest aliases `@inspect/*` to
package **source**, so a stale `dist` cannot fake a green suite. Node ≥ 20, pnpm 9.12.0 (root `package.json`).

**Planned (React Native migration, [INS-086](docs/future/BACKLOG.md)) — do not assume this exists yet:**
`apps/mobile/` (Expo, iOS + Android, arrives in Phase 2). The three shared packages above landed in
Phase 1 ([INS-086](docs/future/BACKLOG.md), 2026-08-27). Design:
[docs/in-progress/specs/2026-08-26-inspect-react-native-migration-design.md](docs/in-progress/specs/2026-08-26-inspect-react-native-migration-design.md).
Per-screen state lives in [docs/reference/screen-migration-map.md](docs/reference/screen-migration-map.md);
the procedure is the `migrate-screen` skill.

### Per-directory instructions

Stack-specific conventions live next to the code and load on demand — [apps/api/CLAUDE.md](apps/api/CLAUDE.md),
[apps/web/CLAUDE.md](apps/web/CLAUDE.md) — plus path-scoped rules in `.claude/rules/` (`wire-contract.md`,
`migration-discipline.md`). **The domain invariants below deliberately stay in this file**: only the
project-root `CLAUDE.md` is re-injected after context compaction, and they are too important to silently
drop out of a long session.

> **Maturity reality (2026-07-11):** the pure domain core (AQL, tamper-proof crypto, audit-chain, auth
> primitives) is unit-tested and solid (204 unit tests, verified 2026-08-01). The DB-bound surface — auth round-trip
> incl. refresh, CRUD create paths, the full inspection lifecycle, populate (incl. the S3 byte path), signed reports +
> public verify — is **verified live**: the DB-backed integration suite (`pnpm api test:integration`) runs green against a
> real Postgres/Redis, locally and in CI ([INS-001](docs/future/BACKLOG.md)/INS-009 closed). Update/delete paths
> and several service internals still lack specs (INS-034/INS-007/INS-019/INS-021). See STATUS.md.

## Common commands

Run from the **repo root** unless noted — Turbo fans tasks out across both apps.

### Root (Turbo)
- `pnpm dev` — run API (`:3000`) + web (`:3001`) in watch mode together.
- `pnpm build` — `nest build` + `next build` across the workspace.
- `pnpm test` — runs each app's `test` (only `@inspect/api` has one: 204 Jest unit tests, no DB).
- `pnpm type-check` — strict `tsc --noEmit` across both apps.
- `pnpm lint` — **currently broken repo-wide** ([INS-048](docs/future/BACKLOG.md): ESLint 9 without a flat config; `next lint` deprecated). `pnpm format` — Prettier write.
- `pnpm api <script>` / `pnpm web <script>` — shorthand for `pnpm --filter @inspect/api` / `@inspect/web`.

### API (`pnpm api <script>`, or `cd apps/api`)
- `pnpm api dev` — `nest start --watch`. **Requires `DATABASE_URL` + `REDIS_URL`** or it throws on boot (see Gotchas).
- `pnpm api test` — Jest unit tests (`src/**/*.spec.ts`, `testEnvironment: node`, **no DB**). 204 passing (2026-08-01).
- `pnpm api test:integration` — DB-backed integration suite (`test/integration/`: negative RBAC matrix, token refresh, full core loop, tamper-evidence, byte upload). Needs a migrated+seeded `DATABASE_URL`+`REDIS_URL` (repo-root `.env` locally; service containers in CI — `.github/workflows/ci.yml`). The byte-upload spec self-skips when the configured `S3_ENDPOINT`/`S3_BUCKET` is unreachable or missing; `REQUIRE_STORAGE=1` (CI sets it) turns that skip into a hard failure.
- `pnpm api prisma:migrate` — `prisma migrate dev` (apply/author migrations against `DATABASE_URL`).
- `pnpm api prisma:generate` — regenerate the Prisma client (also runs on `postinstall`).
- `pnpm api prisma:studio` — Prisma Studio.
- `pnpm --filter @inspect/api exec prisma db seed` — seed the **global defect library** (14 pre-classified defects; idempotent; wired via the `prisma.seed` → `ts-node --transpile-only prisma/seed.ts` hook).

### Web (`pnpm web <script>`, or `cd apps/web`)
- `pnpm web dev` — `next dev --turbopack -p 3001`. Talks to the API at `INSPECT_API_URL`; falls back to design demo data when the API is unreachable.
- `pnpm web build` / `pnpm web lint` / `pnpm web type-check`. No unit-test runner on the web side.

### First-run (local stack; the dev DB to date has been the Railway-managed one via the root `.env`)
```
cp .env.example .env            # then ROTATE the committed secrets — see INS-002
docker compose -f docker-compose.dev.yml up -d      # Postgres 16 + Redis 7 + MinIO
pnpm install
pnpm api prisma:migrate && pnpm --filter @inspect/api exec prisma db seed
pnpm dev                        # API :3000 + web :3001
```

## Environment

The API loads env from the **repo-root `.env`** first, then `apps/api/.env` (`ConfigModule` in
`apps/api/src/app.module.ts` resolves `../../.env` then `.env`). Copy `.env.example` → `.env` at the root.

- **Required for the API to boot:** `DATABASE_URL` (Postgres, Prisma) and `REDIS_URL` (the global `CacheModule`
  throws `REDIS_URL is required` if unset). There is no silent-off fallback.
- **Auth/signing:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `REPORT_SIGNING_PRIVATE_KEY_PEM` (Ed25519), plus
  `AUTH_SECRET` / `NEXTAUTH_URL` for the web console and `INSPECT_API_URL` (the base URL the console calls server-side).
- **Storage:** `S3_*` for presigned photo uploads — any S3-compatible endpoint (managed bucket, or local MinIO via `docker-compose.dev.yml`). `MINIO_ROOT_*` is read only by that compose file, never by the API.
- `turbo.json` `globalEnv` is the canonical list of vars that participate in caching — add new env vars there.

> ⚠️ **`.env.example` is scrubbed to placeholders** (`${{...}}` Railway template refs + `CHANGE_ME`) — verified. What
> remains open in [INS-002](docs/future/BACKLOG.md): the real-looking credentials are still in **git history**, and the
> live Railway secrets are unrotated. `.gitignore` correctly ignores real `.env*`; only `.env.example` is tracked.

## Backend architecture (`apps/api`)

### Pure domain core (no NestJS, no DB — fully unit-tested)
The correctness-critical logic lives as plain TypeScript under `src/`, consumed by the DB-bound services:
- `src/aql/` — ISO 2859-1 / Z1.4 single-sampling Level II engine (`codeLetterForLotSize`, `sampleSizeForCodeLetter`, `planFor`, `computeSampling`, `evaluateInspection`). The Ac/Re grid is a **verified MVP band** (G–N at AQL {1.0,1.5,2.5,4.0,6.5} + critical Ac0); cells outside it **throw** — do not guess values, verify against ANSI/ASQ Z1.4 before extending.
- `src/tamper-proof/` — `canonicalize`, `contentHash` (sha256 over canonical payload + ordered photo hashes), Ed25519 `sign`/`verify` (`node:crypto`, zero deps).
- `src/inspections/cycle-state.ts` — `cycleState(items, photos)` → `{completedCycles, partialCycles, nextSlot, totalPhotos}`. The single definition of "is that unit complete", consumed by the submit guard, the populate read and the report snapshot. `cycleIndex` is 0-based in storage, rendered 1-based, and **may have gaps** after a discard (a new cycle takes `max+1`).
- `src/audit/audit-chain.ts` — `entryHash` + `verifyChain` (tamper detection). `audit.service.ts` is the DB-bound persister.
- `src/auth/{rbac,password,jwt}.ts` — additive role hierarchy, scrypt hashing, HS256 JWT.
- `src/storage/sigv4.ts` — dependency-free AWS SigV4 presigned-upload signing.

### NestJS wiring
- **Global guards** (`app.module.ts`): `JwtAuthGuard` then `RolesGuard` are registered as `APP_GUARD`, so **every route is protected by default**. Opt out / scope with `@Public()`, `@Roles(min)`, and `@CurrentUser()` (in `src/auth/`).
- **Feature modules** mirror the domain: `companies`, `products`, `purchase-orders`, `loop-presets`, `defect-catalog`, `inspections`, `populate`, `reports`, `guest`, `orgs`, `invitations`, `users`, `company-guests`. Most are CRUD controller+service with no spec yet.
- **`PrismaModule`** is global; inject `PrismaService`. **`CacheModule`** is Redis-backed (Keyv). There is **no** `ScheduleModule` — it was removed as dead in INS-053; re-add it only when a real scheduled job lands.
- **Prisma schema:** `apps/api/prisma/schema.prisma` is the **single canonical schema** (24 models, `orgId`-scoped). (A root `LoopQC_schema.prisma` mirror existed historically and was removed 2026-06-20 — there is now exactly one schema.)

## Frontend architecture (`apps/web`)

- **Routing:** screens under `app/(console)/` (dashboard, inspections/new, presets, populate, review, report, users) and `app/{login,invite,portal,report}/`. `(console)` is a route group (shared shell layout), not a URL segment.
- **Auth:** NextAuth v5 **Credentials** (`lib/auth.ts`) POSTs to the API `/auth/login`, then GETs `/auth/me`; the session carries the API-issued JWT + role + orgId. The API stays the canonical RBAC authority.
- **Data layer:** `lib/api.ts` exposes `apiGet`/`loadOrFallback` (live read with demo fallback), the write helpers `apiPost/Put/Patch/Delete` + `ApiError` ([INS-022](docs/future/BACKLOG.md) done), and unauthenticated `apiGetPublic`/`apiPostPublic`. All major screens are wired live via Server Components (reads) + Server Actions (writes); the JWT stays server-side (but leaks via the session — [INS-045](docs/future/BACKLOG.md)).
- **Design system:** `components/inspect/` (`tokens.ts`, `shell.tsx`, `branded-report.tsx`) — Inter + JetBrains Mono, `#037BF4` accent, hairline UI. `components/ui/` is shadcn/Radix. Don't introduce a second component vocabulary.

## Domain invariants (uphold these in every new write path)

These are the product's core guarantees. Several are **enforced only at the app layer today** (the DB does not
back them yet — tracked as [INS-010..INS-018](docs/future/BACKLOG.md)); when you add a write path, you are responsible for them:

- **Tenant isolation:** every tenant-scoped query is filtered by `orgId`. Platform Admin (`role=PLATFORM_ADMIN`, `orgId=null`) is the **only** cross-tenant principal. Never trust a child row's denormalized `orgId` without checking it against its org-scoped parent.
- **Additive RBAC:** `INSPECTOR ≤ QA_MANAGER ≤ ORG_OWNER ≤ PLATFORM_ADMIN` via `hasAtLeast`. Photo upload + the whole populate step are **Platform-Admin-only** in the MVP.
- **Trade role belongs to the EDGE (INS-055):** one `Company` model is every counterparty. Whether it is the client or the factory is carried by `clientCompanyId` / `factoryCompanyId` on `PurchaseOrder`/`Inspection` (and `clientCompanyId` on `Report`) — never by a column on the row. Do not add `Company.role`, `canBeClient` or `canBeFactory`; `kind` (`INTERNAL|THIRD_PARTY`) is the orthogonal *ownership* axis. **Guest report visibility keys on `clientCompanyId` AND `orgId`**, at every call site: a party-agnostic `OR: [{clientCompanyId}, {factoryCompanyId}]` hands a factory's guest the client's signed report.
- **Immutability:** submitted inspections and generated reports are frozen — no edits, no hard-deletes (status/archive only). Corrections happen via a new **linked, billable re-inspection** (`supersedesInspectionId`).
- **Loop shape (INS-081):** a `LoopPreset` **is one loop** holding ordered `PresetLoopItem`s, each taking **exactly one** image. Defect tags and the measurement sheet are **loop-global**, never per item. Populate walks the items repeatedly — one **cycle per inspected unit** — and a recorded defect pins to the `(cycleIndex, item)` slot while a measurement pins to the cycle.
- **One image per slot:** `@@unique([inspectionLoopItemId, cycleIndex])` on `Photo`. A second photo aimed at a filled slot is a **409 pointing at retake**, told apart from the `clientRequestId` replay by the P2002 constraint target. Retake updates the row **in place** (the slot is the identity) and audits **both** content hashes.
- **A loop ends only on a cycle boundary:** `submit()` refuses when any cycle is partial (naming the unit and its missing items) or when no cycle is complete. `computedSampling.sampleSize` is a **displayed target, never a gate** — over- and under-shooting are both legal and both recorded on the report. The rule lives once, in the pure `src/inspections/cycle-state.ts`, and is shared by the guard and the console so they cannot drift.
- **Snapshots:** data feeding a signed artifact is frozen as resolved JSON at creation (`loopPresetSnapshot`, `aqlPlan`/`computedSampling`, `brandingSnapshot`, `Report.canonicalSnapshot`), not a live FK. Edits to a preset must not mutate historical inspections.
- **Canonical payload is VERSIONED, never rewritten (INS-055):** new reports embed `canonicalVersion: 2` **inside** the signed payload (`client`/`factory` keys); reports signed before INS-055 have no marker and are v1. Nothing may ever `UPDATE` `reports.canonicalSnapshot`/`contentHash`/`signature` — not to normalize, not to backfill. Read parties through `readCanonicalParties()` in `@inspect/shared-types`, the single place that knows both shapes; `Report.canonicalVersion` is an unsigned mirror for ops and is **never** the dispatch authority.
- **Audit:** every mutation should append one `AuditLog` row inside the same transaction, hash-chained via `prevEntryHash` with a monotonic per-org `sequence`. (Currently wired into only 2 services — [INS-006](docs/future/BACKLOG.md).)
- **DefectInstance = catalog XOR custom**; writes accept an optional `clientRequestId` and dedupe on `@@unique([orgId, clientRequestId])`.
- **Reference data in code, not DB:** the ISO 2859-1 tables live in `src/aql/`; only the global defect library is seeded.

## Gotchas

- **The API won't boot without `DATABASE_URL` + `REDIS_URL`.** `CacheModule` throws `REDIS_URL is required`; Prisma needs `DATABASE_URL`. There is no dev-mode silent fallback — bring up `docker-compose.dev.yml` first.
- **Verify DB-bound changes with the integration suite.** The core paths are proven live (INS-001 closed), but update/delete paths and service internals are thinner — run `pnpm api test:integration` (and extend it) rather than assuming "compiles" means "works." The bootstrap-admin password converges to `BOOTSTRAP_ADMIN_*` on every `prisma db seed` (by design — re-seed if login 401s after regenerating `.env`).
- **One canonical schema.** `apps/api/prisma/schema.prisma` is the only Prisma schema. (The old root `LoopQC_schema.prisma` mirror was removed 2026-06-20 — don't recreate it.)
- **A shared package must be rebuilt before the API or `next build` sees a change** — they resolve `dist/`, and only `pnpm build`/`type-check` (which carry `dependsOn: ["^build"]`) rebuild it for you. `apps/web`'s Vitest is the exception: it aliases `@inspect/*` to `src`, which also means a **missing** workspace dependency still passes the web suite and only fails at `tsc`/`next build`. Trust type-check, not the suite, for wiring.
- **Object storage is a managed S3-compatible bucket** (`S3_*` in the repo-root `.env`), verified live: presigned PUT/GET round-trip, private objects, permissive CORS. So the byte-upload spec now **runs** locally rather than skipping. CI still uses a MinIO container. Note managed endpoints answer `403` for *any* bucket name, so the suite's probe cannot prove a bucket exists there — a wrong `S3_BUCKET` surfaces as a failing presigned PUT, not a skip. Local `docker-compose.dev.yml` still requires Docker Desktop.
- **Windows + pnpm:** if `pnpm` isn't on PATH, use `npx -y pnpm@9.12.0 <cmd>` or `apps/api/node_modules/.bin`. The API reads the **repo-root** `.env` (`../../.env`), not just `apps/api/.env`.

## Documentation workflow

Planning + tracking live under `docs/{done,in-progress,future}/{plans,specs}/` + `docs/reference/`.
[docs/STATUS.md](docs/STATUS.md) is the source-of-truth dashboard; [docs/future/BACKLOG.md](docs/future/BACKLOG.md)
is the backlog (`INS-NNN` ids); [docs/README.md](docs/README.md) explains the layout and lifecycle.

**After any development or session:**
1. Flip the touched `INS-NNN` backlog item's `status` (→ `done`, with a `done:` line, when verified).
2. Update [docs/STATUS.md](docs/STATUS.md)'s **"Last verified"** date and any pillar row you changed.
3. On merge, move the spec + plan from `docs/in-progress/` → `docs/done/` (keep the dated filename).
4. Review doc-affecting changes before committing (links resolve; STATUS + BACKLOG agree with the code).

New specs/plans start in `docs/in-progress/specs|plans/` (paired `YYYY-MM-DD-<topic>` stem, `-design` on the
spec) — **not** the retired `docs/superpowers/` path. Use `superpowers:writing-plans` to expand a backlog item
into a TDD plan, and TDD for all new domain logic.
