# INS-001 + INS-002 — Stand up the stack & verify the core loop end-to-end

> **🟢 Core loop verified (2026-06-20).** Backlog: [INS-001](../../future/BACKLOG.md) (stand up + verify) + [INS-002](../../future/BACKLOG.md) (secret hygiene). Dashboard: [../../STATUS.md](../../STATUS.md).
> The full `login → org → invite/accept → workspace CRUD → inspection → populate → submit → AQL → decision → signed report → verify` loop now runs **2xx end-to-end against the Railway Postgres+Redis** via a committed smoke driver (acceptance (a)+(b) met). Only the containerized CI integration test ([INS-009](../../future/BACKLOG.md)) and real photo-byte upload to MinIO/S3 ([INS-023](../../future/BACKLOG.md)) remain.

**Goal:** prove that everything DB-bound — Prisma migrations, the auth round-trip, the inspection lifecycle,
populate, AQL evaluation, and signed-report generation — actually runs against a real Postgres/Redis, by driving
the core loop (`login → create inspection → populate → submit → AQL evaluate → sign report → verify token`)
end-to-end, plus a first smoke e2e. This is the gate that turns the `built-unverified` pillars into something real.

## Done so far (2026-06-20, DB-free)
- **INS-002 (scrub):** `.env.example` real-looking Railway credentials replaced with `CHANGE_ME` placeholders; verified no committed secret remains in any tracked file's working tree.
- **Local `.env` generated** at the repo root (gitignored) with local-dev values matching `docker-compose.dev.yml`, fresh `AUTH_SECRET` + `JWT_ACCESS/REFRESH_SECRET` (32-byte base64url), and a freshly generated **Ed25519** `REPORT_SIGNING_PRIVATE_KEY_PEM` (PKCS8).
- **Schema + client validated (DB-free):** `prisma validate` → "schema is valid 🚀"; `prisma generate` → client generated.
- **Task 0 implemented:** first-Platform-Admin bootstrap added to `prisma/seed.ts` (env-driven `BOOTSTRAP_ADMIN_EMAIL`/`PASSWORD`/`NAME`, idempotent upsert, reuses the tested scrypt hasher). Type-checks clean. Dev creds preset in the local `.env` (`admin@inspect.local`). Finding #3 resolved.
- **INS-022 also landed (DB-free prep):** `apiPost/Put/Patch/Delete` + an `ApiError` that surfaces NestJS messages added to `apps/web/lib/api.ts` (type-checks clean) — unblocks the console write screens (tracked separately as [INS-022](../../future/BACKLOG.md)).

## Live run — 2026-06-20 ✅ (Railway server DB+Redis, not local Docker)
Switched `.env` DB+Redis to the **Railway managed services** via their public TCP proxies (`thomas.proxy.rlwy.net:52257` / `shinkansen.proxy.rlwy.net:25052`) — local Docker was unavailable. Results:
- Server DB was **empty** (verified before writing). `prisma migrate deploy` applied `00000000000000_init` → **all 25 tables created**; `db seed` loaded 14 global defects (CRITICAL 3 / MAJOR 7 / MINOR 4) + the bootstrap Platform Admin.
- **API boots on :3000.** `GET /health` → `200 {database: up, redis: up}`. `POST /auth/login` (bootstrap admin) → JWT; `GET /auth/me` → `{role: PLATFORM_ADMIN, orgId: null}`. `GET /defect-catalog` → `403 "requires an organization context"` — **correct** tenant-scoping (admin has no org), not a bug.
- **Web console runs on :3001.**
- **Fix applied during the run:** `package.json` `prisma.seed` changed `ts-node …` → `node -r ts-node/register/transpile-only …` (bare `ts-node` isn't on PATH when Prisma spawns the seed on Windows). Finding #2 (Prisma env discovery) was handled by passing `DATABASE_URL` inline to the CLI.
- **Now driven (see next section):** the create Org → invite/accept → workspace CRUD → inspection → populate → submit → AQL → decide → report → verify loop runs green end-to-end.

## Full loop verified end-to-end — 2026-06-20 ✅
A committed, framework-free smoke driver — [`apps/api/scripts/smoke-loop.mjs`](../../../apps/api/scripts/smoke-loop.mjs) (run with `node apps/api/scripts/smoke-loop.mjs` against a booted API) — walked the **entire loop in 25 steps, all 2xx**, against the live Railway Postgres+Redis. Key results:
- **Two principals, as designed.** Org-scoped steps run as the invited **Org Owner**; the populate step runs as the cross-tenant **Platform Admin** (`orgId=null`). The riskiest never-run path — `PopulateService` deriving `orgId` from the *target inspection* rather than the caller — **works correctly** (presign + register photo + assign-to-loop + tag defect + measurement all succeed under the admin token).
- **Onboarding (phase-2 Task 7):** `POST /admin/orgs` → invitation token → `POST /invitations/accept` (sets scrypt password, activates `ORG_OWNER`) → owner `POST /auth/login`. Verified live.
- **Auth + guards (phase-2 Tasks 5–6):** login → JWT → `/auth/me` (`PLATFORM_ADMIN`, `orgId=null`); `JwtAuthGuard` + `RolesGuard` admit the admin-only and org-owner routes; tenant scoping holds.
- **Workspace CRUD + presets:** buyer/supplier/product/PO + a versioned loop preset (allowing a global MINOR defect) all persist.
- **AQL engine, live:** `lotSize=1000` → code letter **J** (n=80); 1 MINOR defect ⇒ `systemRecommendation=PASS` (minor found 1 < Re 8). Submit creates the `AqlResult` + `BillableEvent` and locks the inspection.
- **Tamper-proof report:** QA decision PASS → `APPROVED` → `POST /inspections/:id/report` produces an Ed25519-signed report; **public** `GET /reports/verify/:token` returns `valid=true, hashMatches=true, signatureValid=true`.
- **Guest portal backend:** buyer-guest magic-link issuance + `GET /guest/reports?token=…` returns the buyer-scoped report. Verified live.

**Boot note:** local Docker is still unavailable; the API was run via `pnpm --filter @inspect/api exec nest start` against the Railway managed services (`/health` → db+redis up). The smoke driver loads the bootstrap-admin creds from the repo-root `.env` (no secret is committed in the script).

**Still open for full INS-001 closure:** the containerized/CI integration test ([INS-009](../../future/BACKLOG.md)) and real photo **byte** upload to MinIO/S3 ([INS-023](../../future/BACKLOG.md)) — the populate API persists photo *metadata + content hash* without needing object storage, so the byte path is the only loop step not exercised here.

## Blockers / findings (the original INS-001 surprises)
1. **No database available on this machine.** `docker` is not installed/running (not on PATH, no Docker Desktop) and ports 5432/6379/9000 are free (no native Postgres/Redis/MinIO). The stack cannot be brought up here — a DB must be provided (start Docker Desktop, or point at a disposable managed Postgres + Redis).
2. **Prisma CLI env discovery.** The API reads the **repo-root** `.env` (`ConfigModule` → `../../.env`), but the Prisma CLI loads `.env` from its **cwd** (`apps/api`) or the schema dir. So `prisma migrate`/`db seed` won't see the root `.env` automatically. Fix: also drop a gitignored `apps/api/.env` containing `DATABASE_URL` (and `DIRECT_URL` if added), or export `DATABASE_URL` in the shell before running Prisma, or add a `prisma.config.ts`. (The root `.env` already has the value; the Prisma CLI just needs it on its own search path.)
3. **No first-Platform-Admin bootstrap (Task 0).** Creating an org is `@Roles('PLATFORM_ADMIN')` (`orgs.controller.ts:8`) and `users.service` *forbids* inviting/assigning `PLATFORM_ADMIN` (`users.service.ts:43,61`); `prisma/seed.ts` seeded only the 14 global defects. **There was no way to create the first Platform Admin in-app** — the loop can't start without one. **✅ RESOLVED 2026-06-20:** `prisma/seed.ts` now upserts a `PLATFORM_ADMIN` (`orgId=null`, `status=ACTIVE`) from `BOOTSTRAP_ADMIN_EMAIL`/`PASSWORD`/`NAME` (idempotent; reuses the tested scrypt `hashPassword`). The local `.env` already carries dev creds (`admin@inspect.local`). Runs as part of `prisma db seed` — no separate step.

## Runbook — complete this once a database is available
```
# 0. DB up (pick one):
docker compose -f docker-compose.dev.yml up -d            # local (needs Docker Desktop), OR
#   set DATABASE_URL/REDIS_URL in .env to a disposable managed Postgres+Redis

# 1. Make DATABASE_URL visible to the Prisma CLI (finding #2)
#    e.g. echo 'DATABASE_URL="postgresql://inspect:inspect@localhost:5432/inspect?schema=public"' > apps/api/.env

# 2. Migrate + seed (seed also bootstraps the Platform Admin — Task 0, finding #3 — when BOOTSTRAP_ADMIN_* is set)
pnpm --filter @inspect/api exec prisma migrate deploy
pnpm --filter @inspect/api exec prisma db seed             # 14 global defects + admin@inspect.local

# 3. Boot + smoke the loop (log in as the bootstrapped admin)
pnpm dev                                                   # API :3000, web :3001
#    login → create buyer/supplier/PO/product/preset → create inspection
#    → populate (presign upload to MinIO, drag-into-loop, tag defect, measure)
#    → submit (AQL evaluate → AqlResult + BillableEvent + lock) → QA decide
#    → generate report (Ed25519 sign) → GET /reports/verify/:token → guest portal

# 4. First integration smoke (INS-009 seed): login → guarded route 200/401/403 against a testcontainers Postgres
```

## Acceptance (INS-001)
- `prisma migrate status` shows the init migration applied; the API boots with no errors.
- A scripted `login → create → populate → submit → decision → report → verify` flow returns 2xx end-to-end against a real Postgres.
- ≥ 1 green integration test runs against a containerized Postgres.

## Still open (user-side, INS-002)
- **Rotate** the live Railway `POSTGRES_PASSWORD` / `REDIS_PASSWORD` that were previously committed (they remain in git **history**; the working tree is clean).
- Decide whether to **scrub git history** (destructive rewrite — your call) or accept the rotated-credential mitigation.
