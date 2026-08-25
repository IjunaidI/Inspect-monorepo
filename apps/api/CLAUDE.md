# apps/api — NestJS 11 + Prisma 6

The RBAC authority and the domain core. Port **3000** (`API_PORT`). The domain invariants in the repo-root
`CLAUDE.md` are binding here — this file covers stack convention only.

## Commands

- `pnpm api dev` — `nest start --watch`. **Requires `DATABASE_URL` + `REDIS_URL`** or it throws at boot.
- `pnpm api test` — Jest unit tests, no DB.
- `pnpm api test:integration` — DB-backed suite (`test/integration/`). Needs a migrated + seeded DB.
- `pnpm api prisma:migrate` · `prisma:generate` · `prisma:studio`
- `pnpm --filter @inspect/api exec prisma db seed` — global defect library (idempotent).

> **Windows:** `pnpm api test` exits 134 from a Jest parallel-worker teardown crash *after* every test
> reports green. `jest --runInBand` exits 0. Do not chase a phantom failure ([INS-085](../../docs/future/BACKLOG.md)).

## Layout

**Pure domain core** — plain TypeScript, no NestJS, no DB, fully unit-tested. Correctness-critical logic
lives here and DB-bound services consume it:

- `src/aql/` — ISO 2859-1 / Z1.4 engine. The Ac/Re grid is a **verified band**; cells outside it *throw*.
  Never guess a value — verify against ANSI/ASQ Z1.4 before extending.
- `src/tamper-proof/` — `canonicalize`, `contentHash`, Ed25519 sign/verify.
- `src/inspections/cycle-state.ts` — the single definition of "is that unit complete". Shared by the submit
  guard, the populate read and the report snapshot so they cannot drift.
- `src/audit/audit-chain.ts` — `entryHash` + `verifyChain`.
- `src/auth/{rbac,password,jwt}.ts` · `src/storage/sigv4.ts`

**NestJS wiring** — feature modules mirror the domain. `PrismaModule` is global; `CacheModule` is
Redis-backed.

## Guards are global

`JwtAuthGuard` then `RolesGuard` are registered as `APP_GUARD`, so **every route is protected by default**.
Opt out or scope with `@Public()`, `@Roles(min)`, `@CurrentUser()`.

`@Roles` is **additive and hierarchical**: `INSPECTOR ≤ QA_MANAGER ≤ ORG_OWNER ≤ PLATFORM_ADMIN`. A class-level
`@Roles` sets the floor for every route; a method-level one overrides it for that route.

## Finding a route's contract

Controller (path, method, role floor) → service (input type, business rules) → the Prisma model. Note that
service input types are currently declared locally and **redeclared again** in `apps/web/lib/api.ts` — that
duplication is [INS-008](../../docs/future/BACKLOG.md), and `@inspect/shared-types` is where it is being
resolved. Prefer the shared package for any new DTO.

## Schema

`prisma/schema.prisma` is the **single canonical schema** (25 models, `orgId`-scoped). There is no mirror;
do not create one.

## Testing convention

- Unit specs sit beside the code as `*.spec.ts`, `testEnvironment: node`, **no DB**.
- Integration specs live in `test/integration/` as `*.e2e-spec.ts` and run against real Postgres + Redis.
- New domain logic is TDD. A DB-bound change is not verified until the integration suite says so —
  "compiles" is not "works".
