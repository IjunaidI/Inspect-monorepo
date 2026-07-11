# Inspect Phase 2 — Auth & Tenancy — Implementation Plan

> **🟢 Tasks 1–6 verified live; Task 7 (onboarding) happy-path verified (2026-06-20).** Tasks 1–4 (DB-free primitives: `rbac`/`password`/`jwt` + `docker-compose.dev.yml`) are shipped and unit-tested. Tasks 5–7 (AuthModule login, guards, invite-only onboarding) — previously coded-but-unrun — are now **driven end-to-end against the live Railway DB** by the INS-001 smoke loop (`apps/api/scripts/smoke-loop.mjs`): login → JWT → `/auth/me`, `JwtAuthGuard`+`RolesGuard` across `PLATFORM_ADMIN`/`ORG_OWNER`, tenant scoping, and create-org → invite → accept → login. **Still pending:** token **refresh**, the **negative** RBAC matrix (401/403/cross-org) — [INS-009](../../future/BACKLOG.md) — and invite/magic-link **email** delivery — [INS-004](../../future/BACKLOG.md). **Security-hardened 2026-07-11:** cross-tenant invite-accept takeover closed ([INS-035](../../future/BACKLOG.md)), JWT dev-secret fallback removed / fail-closed at boot ([INS-036](../../future/BACKLOG.md)), invitation tokens now CSPRNG ([INS-037](../../future/BACKLOG.md)), login timing equalized ([INS-042](../../future/BACKLOG.md)); rate limiting is [INS-047](../../future/BACKLOG.md). Current state: [STATUS.md](../../STATUS.md).
>
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. TDD throughout. Checkbox steps.

**Goal:** Authentication (JWT), multi-tenant RBAC enforcement, and invite-only onboarding (Platform → Org → users/guests), on top of the Phase 1 schema.

**Architecture:** API is the RBAC authority (spec §13). Auth **primitives** are dependency-free (`node:crypto`): scrypt password hashing, HS256 JWT, additive role hierarchy — all unit-testable with **no DB and no new packages**. The **NestJS wiring** (AuthModule, guards, controllers, Prisma-backed user/org/invite services) is DB-bound and needs Postgres + Redis.

**Tech Stack:** NestJS 11, Prisma 6, `node:crypto` (scrypt + HMAC), jest.

**DB availability:** Tasks 1–4 below are DB-free and built now. Tasks 5+ require a running Postgres + Redis (`docker-compose.dev.yml` from Task 4) and `prisma migrate dev` + `db seed`.

---

## File structure

- `apps/api/src/auth/rbac.ts` — additive role hierarchy (`roleRank`, `hasAtLeast`, `isPlatformAdmin`). **(DB-free)**
- `apps/api/src/auth/password.ts` — scrypt `hashPassword`/`verifyPassword` (timing-safe). **(DB-free)**
- `apps/api/src/auth/jwt.ts` — HS256 `signJwt`/`verifyJwt` (exp enforced). **(DB-free)**
- `apps/api/src/auth/*.spec.ts` — tests. **(DB-free)**
- `docker-compose.dev.yml` + `.env.example` — local Postgres + Redis + MinIO. **(config)**
- `apps/api/src/auth/auth.service.ts`, `auth.controller.ts`, `auth.module.ts`, `jwt-auth.guard.ts`, `roles.guard.ts`, `roles.decorator.ts`, `current-user.decorator.ts` — **(DB-bound)**
- `apps/api/src/org/{org.service,org.controller,org.module}.ts`, `apps/api/src/invitations/*` — **(DB-bound)**

---

## Task 1: Additive RBAC hierarchy (DB-free, TDD)

`hasAtLeast(userRole, requiredRole)` per the additive hierarchy INSPECTOR < QA_MANAGER < ORG_OWNER < PLATFORM_ADMIN (spec §4).

- [ ] Failing test (`rbac.spec.ts`): `hasAtLeast('QA_MANAGER','INSPECTOR')===true`; `hasAtLeast('INSPECTOR','QA_MANAGER')===false`; `hasAtLeast('PLATFORM_ADMIN','ORG_OWNER')===true`; equal roles true; `isPlatformAdmin('PLATFORM_ADMIN')===true`.
- [ ] Run → fail. Implement `roleRank` map + `hasAtLeast` + `isPlatformAdmin`. Run → pass. Commit.

## Task 2: Password hashing via scrypt (DB-free, TDD)

- [ ] Failing test (`password.spec.ts`): `verifyPassword(p, await hashPassword(p))===true`; wrong password → false; two hashes of same password differ (random salt); malformed stored string → false.
- [ ] Run → fail. Implement scrypt hash/verify with random 16-byte salt, encoded `scrypt$N$r$p$salt$hash`, timing-safe compare. Run → pass. Commit.

## Task 3: HS256 JWT (DB-free, TDD)

- [ ] Failing test (`jwt.spec.ts`): round-trip returns payload claims; tampered token → throws; wrong secret → throws; expired (`exp` past) → throws; valid window passes. (`now` is an injectable param for determinism.)
- [ ] Run → fail. Implement `signJwt(payload, secret, expiresInSec, now?)` and `verifyJwt(token, secret, now?)` (base64url, HMAC-SHA256, exp check, timing-safe sig compare). Run → pass. Commit.

## Task 4: Local dev stack (config)

- [ ] Create `docker-compose.dev.yml` (Postgres 16, Redis 7, MinIO) and `.env.example` with `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, S3/MinIO vars, `API_PORT`, `WEB_PORT`. Commit.

---

## DB-bound tasks (require Postgres + Redis; built when a DB is available)

## Task 5: AuthModule + login/refresh (TDD with a test database)

- AuthService: `validateUser(email, password)` (Prisma lookup + `verifyPassword`), `issueTokens(user)` (access + refresh JWT carrying `sub`, `orgId`, `role`), `refresh(token)`.
- AuthController: `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`.
- Integration tests against a test Postgres (seed a user, log in, hit a guarded route).

## Task 6: Guards & decorators

- `JwtAuthGuard` (verifies access token → attaches principal), `@CurrentUser()`, `@Roles(min)` + `RolesGuard` (uses `hasAtLeast`), tenant-scope guard ensuring `orgId` match (Platform Admin bypasses). Tests: 401 no token, 403 under-privileged, 200 sufficient, cross-org 404/403.

## Task 7: Invite-only onboarding

- Platform Admin creates Org + first Org Owner invite; Org Owner invites users (role-bounded); accept-invite sets password + activates `User`. Buyer-guest magic-link issuance/consumption. All writes audited (hash-chain) and tenant-scoped.

---

## Self-review
- Spec coverage: §3 (invite-only onboarding — Task 7), §4 (additive roles — Tasks 1,6), §13 (server-side RBAC keyed off orgId — Task 6). Tasks 1–4 are DB-free and verifiable now; 5–7 need a database.
- Role type is defined locally in `rbac.ts` for now (the `@inspect/shared-types` package isn't yet linked via `pnpm install`); align it to shared-types/Prisma `UserRole` during Task 5.
