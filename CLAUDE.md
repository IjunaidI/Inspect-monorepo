# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Inspect** is a tamper-proof, AQL-driven pre-shipment QC inspection platform for the textile/garment
industry — a multi-tenant B2B SaaS. An inspector walks a product through guided photo "loops", the system
runs an ISO 2859-1 / Z1.4 acceptance-sampling calc, a QA Manager makes the binding pass/fail call, and a
per-buyer-branded PDF report is generated and **Ed25519-signed** so the buyer can verify it independently.
MVP is **web-first** (admin/QA console + API); mobile camera capture is a deliberate Phase-2 follow-up.

> **Start every session at [docs/STATUS.md](docs/STATUS.md)** — the source-of-truth dashboard. Open work is
> [docs/future/BACKLOG.md](docs/future/BACKLOG.md) (`INS-NNN` ids). Requirements (frozen v1.0):
> [docs/done/specs/2026-06-06-inspect-mvp-requirements-design.md](docs/done/specs/2026-06-06-inspect-mvp-requirements-design.md).
> Schema rationale + invariants: [docs/reference/inspect-schema.md](docs/reference/inspect-schema.md).

## Repository layout

A **pnpm + Turborepo monorepo** (real workspaces — `pnpm-workspace.yaml` globs `apps/*` + `packages/*`, so a
single `pnpm install` at the root installs everything):

- `apps/api/` — **NestJS 11 + Prisma 6** API (port **3000**, override via `API_PORT`). The RBAC authority + domain core.
- `apps/web/` — **Next.js 15** App-Router console (port **3001**, hardcoded in its `dev`/`start` scripts). React 19, NextAuth v5, Tailwind, shadcn/ui.
- `packages/shared-types/` — `@inspect/shared-types` (Zod contracts + enum unions). **Built but not yet wired into either app — see [INS-008](docs/future/BACKLOG.md).**

Node ≥ 20, pnpm 9.12.0 (declared in root `package.json`).

> **Maturity reality (2026-06-20):** the pure domain core (AQL, tamper-proof crypto, audit-chain, auth
> primitives) is unit-tested and solid (97 tests). Everything DB-bound — auth round-trip, all CRUD, the
> inspection lifecycle, populate, reports — **compiles and type-checks but has never run against a real
> Postgres/Redis** ([INS-001](docs/future/BACKLOG.md)). Treat "it's implemented" as "the logic exists," not "it works." See STATUS.md.

## Common commands

Run from the **repo root** unless noted — Turbo fans tasks out across both apps.

### Root (Turbo)
- `pnpm dev` — run API (`:3000`) + web (`:3001`) in watch mode together.
- `pnpm build` — `nest build` + `next build` across the workspace.
- `pnpm test` — runs each app's `test` (only `@inspect/api` has one: 97 Jest unit tests, no DB).
- `pnpm type-check` — strict `tsc --noEmit` across both apps.
- `pnpm lint` — ESLint across both apps. `pnpm format` — Prettier write.
- `pnpm api <script>` / `pnpm web <script>` — shorthand for `pnpm --filter @inspect/api` / `@inspect/web`.

### API (`pnpm api <script>`, or `cd apps/api`)
- `pnpm api dev` — `nest start --watch`. **Requires `DATABASE_URL` + `REDIS_URL`** or it throws on boot (see Gotchas).
- `pnpm api test` — Jest unit tests (`src/**/*.spec.ts`, `testEnvironment: node`, **no DB**). 97 passing.
- `pnpm api test:e2e` — Jest e2e (`test/jest-e2e.json`); currently one trivial spec ([INS-009](docs/future/BACKLOG.md)).
- `pnpm api prisma:migrate` — `prisma migrate dev` (apply/author migrations against `DATABASE_URL`).
- `pnpm api prisma:generate` — regenerate the Prisma client (also runs on `postinstall`).
- `pnpm api prisma:studio` — Prisma Studio.
- `pnpm --filter @inspect/api exec prisma db seed` — seed the **global defect library** (14 pre-classified defects; idempotent; wired via the `prisma.seed` → `ts-node --transpile-only prisma/seed.ts` hook).

### Web (`pnpm web <script>`, or `cd apps/web`)
- `pnpm web dev` — `next dev --turbopack -p 3001`. Talks to the API at `INSPECT_API_URL`; falls back to design demo data when the API is unreachable.
- `pnpm web build` / `pnpm web lint` / `pnpm web type-check`. No unit-test runner on the web side.

### First-run (once a DB exists — this is [INS-001](docs/future/BACKLOG.md))
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
- **Storage:** `S3_*` / `MINIO_*` for presigned photo uploads (MinIO locally).
- `turbo.json` `globalEnv` is the canonical list of vars that participate in caching — add new env vars there.

> ⚠️ **`.env.example` currently ships real-looking Railway credentials** (committed). Rotate + scrub before any
> deploy — [INS-002](docs/future/BACKLOG.md). `.gitignore` correctly ignores real `.env*`; only `.env.example` is tracked.

## Backend architecture (`apps/api`)

### Pure domain core (no NestJS, no DB — fully unit-tested)
The correctness-critical logic lives as plain TypeScript under `src/`, consumed by the DB-bound services:
- `src/aql/` — ISO 2859-1 / Z1.4 single-sampling Level II engine (`codeLetterForLotSize`, `sampleSizeForCodeLetter`, `planFor`, `computeSampling`, `evaluateInspection`). The Ac/Re grid is a **verified MVP band** (G–N at AQL {1.0,1.5,2.5,4.0,6.5} + critical Ac0); cells outside it **throw** — do not guess values, verify against ANSI/ASQ Z1.4 before extending.
- `src/tamper-proof/` — `canonicalize`, `contentHash` (sha256 over canonical payload + ordered photo hashes), Ed25519 `sign`/`verify` (`node:crypto`, zero deps).
- `src/audit/audit-chain.ts` — `entryHash` + `verifyChain` (tamper detection). `audit.service.ts` is the DB-bound persister.
- `src/auth/{rbac,password,jwt}.ts` — additive role hierarchy, scrypt hashing, HS256 JWT.
- `src/storage/sigv4.ts` — dependency-free AWS SigV4 presigned-upload signing.

### NestJS wiring
- **Global guards** (`app.module.ts`): `JwtAuthGuard` then `RolesGuard` are registered as `APP_GUARD`, so **every route is protected by default**. Opt out / scope with `@Public()`, `@Roles(min)`, and `@CurrentUser()` (in `src/auth/`).
- **Feature modules** mirror the domain: `buyers`, `suppliers`, `products`, `purchase-orders`, `loop-presets`, `defect-catalog`, `inspections`, `populate`, `reports`, `guest`, `orgs`, `invitations`, `users`, `buyer-guests`. Most are CRUD controller+service with no spec yet.
- **`PrismaModule`** is global; inject `PrismaService`. **`CacheModule`** is Redis-backed (Keyv). `ScheduleModule` is registered (no cron jobs yet).
- **Prisma schema:** `apps/api/prisma/schema.prisma` is the **single canonical schema** (25 models, `orgId`-scoped). (A root `LoopQC_schema.prisma` mirror existed historically and was removed 2026-06-20 — there is now exactly one schema.)

## Frontend architecture (`apps/web`)

- **Routing:** screens under `app/(console)/` (dashboard, inspections/new, presets, populate, review, report, users) and `app/{login,invite,portal,report}/`. `(console)` is a route group (shared shell layout), not a URL segment.
- **Auth:** NextAuth v5 **Credentials** (`lib/auth.ts`) POSTs to the API `/auth/login`, then GETs `/auth/me`; the session carries the API-issued JWT + role + orgId. The API stays the canonical RBAC authority.
- **Data layer:** `lib/api.ts` currently exposes **only `apiGet` + `loadOrFallback`** (live read with a hardcoded demo fallback). **There is no `apiPost/Put/Patch/Delete` helper yet** — adding it is [INS-022](docs/future/BACKLOG.md) and unblocks every write screen. Today **only the Login screen performs a live mutation**; ~8 screens are static design placeholders.
- **Design system:** `components/inspect/` (`tokens.ts`, `shell.tsx`, `branded-report.tsx`) — Inter + JetBrains Mono, `#037BF4` accent, hairline UI. `components/ui/` is shadcn/Radix. Don't introduce a second component vocabulary.

## Domain invariants (uphold these in every new write path)

These are the product's core guarantees. Several are **enforced only at the app layer today** (the DB does not
back them yet — tracked as [INS-010..INS-018](docs/future/BACKLOG.md)); when you add a write path, you are responsible for them:

- **Tenant isolation:** every tenant-scoped query is filtered by `orgId`. Platform Admin (`role=PLATFORM_ADMIN`, `orgId=null`) is the **only** cross-tenant principal. Never trust a child row's denormalized `orgId` without checking it against its org-scoped parent.
- **Additive RBAC:** `INSPECTOR ≤ QA_MANAGER ≤ ORG_OWNER ≤ PLATFORM_ADMIN` via `hasAtLeast`. Photo upload + the whole populate step are **Platform-Admin-only** in the MVP.
- **Immutability:** submitted inspections and generated reports are frozen — no edits, no hard-deletes (status/archive only). Corrections happen via a new **linked, billable re-inspection** (`supersedesInspectionId`).
- **Snapshots:** data feeding a signed artifact is frozen as resolved JSON at creation (`loopPresetSnapshot`, `aqlPlan`/`computedSampling`, `brandingSnapshot`, `Report.canonicalSnapshot`), not a live FK. Edits to a preset must not mutate historical inspections.
- **Audit:** every mutation should append one `AuditLog` row inside the same transaction, hash-chained via `prevEntryHash` with a monotonic per-org `sequence`. (Currently wired into only 2 services — [INS-006](docs/future/BACKLOG.md).)
- **DefectInstance = catalog XOR custom**; writes accept an optional `clientRequestId` and dedupe on `@@unique([orgId, clientRequestId])`.
- **Reference data in code, not DB:** the ISO 2859-1 tables live in `src/aql/`; only the global defect library is seeded.

## Gotchas

- **The API won't boot without `DATABASE_URL` + `REDIS_URL`.** `CacheModule` throws `REDIS_URL is required`; Prisma needs `DATABASE_URL`. There is no dev-mode silent fallback — bring up `docker-compose.dev.yml` first.
- **Nothing DB-bound has ever run** ([INS-001](docs/future/BACKLOG.md)). When you touch a DB-bound path, you are likely the first to execute it — verify against a real DB, don't assume "compiles" means "works."
- **One canonical schema.** `apps/api/prisma/schema.prisma` is the only Prisma schema. (The old root `LoopQC_schema.prisma` mirror was removed 2026-06-20 — don't recreate it.)
- **`@inspect/shared-types` is built but unlinked** ([INS-008](docs/future/BACKLOG.md)) — both apps currently redeclare their own enums/DTOs, so the client/server contract can drift.
- **The web client cannot write yet** ([INS-022](docs/future/BACKLOG.md)) — `lib/api.ts` is read-only. Don't assume a console button posts; most are inert placeholders.
- **The console shell shows a hardcoded user** (`Riya Saraf/owner`) and has no sign-out ([INS-028](docs/future/BACKLOG.md)) — it does not yet reflect the real session.
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
