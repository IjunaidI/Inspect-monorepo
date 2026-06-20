# Monorepo Restructure — Implementation Summary

> **✅ Done — archived to `docs/done/plans/` 2026-06-20 (work landed 2026-05-17).** Correction: this predates the **TypeORM → Prisma** migration (commit `de6a2e0`); any TypeORM / Drizzle / Neon DB details below are **historical and superseded** — Prisma is the real stack. Current state: [STATUS.md](../../STATUS.md).
>
> Branch: `worktree-monorepo-restructure` · Commits: `01e4d4e`, `7e8dc57`
> Worktree path: `E:\Inspect-monorepo\.claude\worktrees\monorepo-restructure`

## What this change does

Converts the previously-Frankenstein repo (NestJS backend at root + Next.js frontend in a separately-cloned `frontend/` directory with its own nested `.git`, two different package managers) into a clean pnpm + Turborepo monorepo, and fixes the broken env-variable wiring in the backend.

## Decisions agreed up front

| Question | Answer |
|---|---|
| Monorepo tooling | **pnpm workspaces + Turborepo** |
| Layout | **`apps/api` + `apps/web` + `packages/*`** (packages/ intentionally empty for now) |
| Env strategy | **Single root `.env` shared by both apps** |
| DB integration | **Status quo** — frontend keeps Drizzle/Neon (`POSTGRES_URL`), backend keeps TypeORM with corrected env names |

## Final repo layout

```
Inspect-monorepo/
  .env.example          unified, with real Railway values populated
  .gitignore            unified
  .npmrc                pnpm settings (auto-install-peers)
  .prettierrc           unified
  .git
  package.json          workspace root, scripts delegate to turbo
  pnpm-workspace.yaml   apps/* + packages/*
  pnpm-lock.yaml        single workspace lockfile
  turbo.json            build/dev/lint/test/type-check/clean pipelines
  tsconfig.base.json    shared base, each app extends and overrides
  README.md
  apps/
    api/                @inspect/api — NestJS, port 3000 (env: API_PORT)
      .dockerignore
      .eslintrc.js
      Dockerfile        multi-stage pnpm build; build context = repo root
      nest-cli.json
      package.json
      tsconfig.json     extends ../../tsconfig.base.json
      tsconfig.build.json
      src/
        app.controller.ts
        app.controller.spec.ts
        app.module.ts   REWRITTEN — uses REDIS_URL + DATABASE_URL
        app.service.ts
        main.ts         port now from process.env.API_PORT
        health/
      test/
    web/                @inspect/web — Next.js, port 3001
      .eslintrc.json    root: true (so ESLint doesn't walk past workspace)
      .vscode/
      app/, components/, lib/, public/
      components.json
      Dockerfile        multi-stage pnpm build; standalone output
      middleware.ts
      next.config.ts    output: 'standalone' + outputFileTracingRoot + dotenv from root .env
      package.json
      postcss.config.js
      tailwind.config.ts
      tsconfig.json     extends ../../tsconfig.base.json
  docs/
    implementation/
      monorepo-restructure.md   (this file)
```

`packages/` was deliberately left uncreated. The two apps share no code today (different ORMs, no common types). Adding empty placeholders would be over-engineering — introduce a package the day a real cross-app dependency appears.

## The env-variable correctness fix

`.example.env` originally had **duplicated and conflicting** entries. The user clarified that the top blocks (lines 1–7 Redis, 9–20 Postgres) were authoritative and the bottom blocks (lines 22–31) were duplicates to discard. The backend code was reading the **wrong** (duplicate-block) names.

### Authoritative names (kept)
- **Redis**: `REDIS_URL`, `REDIS_PUBLIC_URL`, `REDIS_PASSWORD`
- **Postgres**: `DATABASE_URL`, `DATABASE_PUBLIC_URL`, `POSTGRES_URL`, `PGDATA`, `PGDATABASE`, `PGHOST`, `PGPASSWORD`, `PGPORT`, `PGUSER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `POSTGRES_USER`, `SSL_CERT_DAYS`

### Discarded duplicates (removed from `.env.example` and `turbo.json`)
- `POSTGRESDB`, `POSTGRESHOST`, `POSTGRESPASSWORD`, `POSTGRESPORT`, `POSTGRESUSER` (no-underscore variant)
- `REDISPASSWORD`, `REDISHOST`, `REDISPORT`, `REDISUSER` (individual component vars — code uses `REDIS_URL` directly)
- `REDISURL` (typo for `REDIS_URL`)

### Deleted legacy files
- `.example.env` — fully superseded by root `.env.example`
- `frontend/.env.example` — superseded by root `.env.example`
- `frontend/` directory — duplicate of `apps/web/`, had its own nested `.git`

### Code changes in `apps/api/src/app.module.ts`

Before (wrong):
```ts
new KeyvRedis(
  process.env.REDISURL ||
    `redis://:${process.env.REDISPASSWORD}@${process.env.REDISHOST}:${process.env.REDISPORT}`,
)
```
After (correct):
```ts
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL is required');
new KeyvRedis(redisUrl)
```

Before (wrong):
```ts
TypeOrmModule.forRootAsync({
  useFactory: () => ({
    type: 'postgres',
    host: process.env.POSTGRESHOST,
    port: +process.env.POSTGRESPORT,
    username: process.env.POSTGRESUSER,
    password: process.env.POSTGRESPASSWORD,
    database: process.env.POSTGRESDB,
    synchronize: true,
    entities: []
  })
})
```
After (correct):
```ts
TypeOrmModule.forRootAsync({
  useFactory: () => ({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    synchronize: false,
    autoLoadEntities: true,
    entities: [],
  }),
})
```

- Switched to TypeORM's `url:` connection string (TypeORM 0.3 parses host/port/user/pass/db from it).
- Flipped `synchronize: true → false`. Harmless today (empty entities) but **must stay off** once real entities arrive — use TypeORM migrations.

### Root `.env.example` (final, populated with real Railway values)

Vars preserved from the original `.example.env`:
- `POSTGRES_PASSWORD="<redacted 2026-06-20 — INS-002>"`  *(the real value was scrubbed from this doc; rotate the live Railway credential)*
- `REDIS_PASSWORD="<redacted 2026-06-20 — INS-002>"`  *(scrubbed; rotate)*
- `POSTGRES_USER="postgres"`, `POSTGRES_DB="railway"`, `PGPORT="5432"`, `REDISPORT="6379"`, `REDISUSER="default"`, `PGDATA="/var/lib/postgresql/data/pgdata"`, `SSL_CERT_DAYS="820"`

Vars added (frontend, not in original `.example.env`):
- `NEXTAUTH_URL="http://localhost:3001"` (must match web port)
- `AUTH_SECRET=`
- `AUTH_GITHUB_ID=`
- `AUTH_GITHUB_SECRET=`

Railway template references `${{VAR}}` are preserved so Railway resolves them at deploy.

## Migration steps actually executed

1. **Worktree** — `EnterWorktree` to isolate the work on branch `worktree-monorepo-restructure`.
2. **Pre-flight**: deleted the worktree's `package-lock.json`, copied `frontend/` from the main repo into the worktree (skipping its nested `.git`), copied `.example.env` for reference.
3. **Moved backend** → `apps/api/`: `src/`, `test/`, `package.json`, `tsconfig*.json`, `nest-cli.json`, `.eslintrc.js`, `Dockerfile`, `.dockerignore`. Deleted root `.prettierrc`, `.gitignore`, `.example.env` (replaced by unified versions).
4. **Moved frontend** → `apps/web/`. Deleted duplicates inside: `pnpm-lock.yaml`, `.env.example`, `.gitignore`, inline `prettier` block in `package.json`.
5. **Wrote new workspace root files**: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `tsconfig.base.json`, `.prettierrc`, `.gitignore`.
6. **Rewrote `apps/api/package.json`**: name `@inspect/api`, renamed `start:dev` → `dev`, dropped root-only `format` script, added `type-check` and `clean`, fixed `typescript: ^6.0.3 → ^5.7.2`, fixed `eslint: ^10.2.1 → ^9.18.0`, added `rimraf`.
7. **Rewrote `apps/api/tsconfig.json`** to extend `../../tsconfig.base.json` and override for NestJS (CommonJS + decorators).
8. **Rewrote `apps/api/src/app.module.ts`** with the env-var fixes above + `ConfigModule.forRoot({ envFilePath: [...] })` that walks up to repo root.
9. **Rewrote `apps/api/src/main.ts`** to read `API_PORT` from env (default 3000).
10. **Rewrote `apps/web/package.json`**: name `@inspect/web`, `dev`/`start` use `-p 3001`, added `type-check`/`clean`, added `dotenv` + `rimraf` + `eslint` + `eslint-config-next` to devDeps, moved several packages from `dependencies` → `devDependencies`.
11. **Rewrote `apps/web/tsconfig.json`** to extend the base, with `target: ES2017` + `moduleResolution: Bundler` (modernized from `target: es5` + `moduleResolution: node`).
12. **Rewrote `apps/web/next.config.ts`** to `loadEnv` from repo root and set `outputFileTracingRoot` (required for Next 15 in a workspace).
13. **Wrote unified `.env.example`** at root with real Railway values populated.
14. **Rewrote `apps/api/Dockerfile`** as a multi-stage pnpm + `turbo prune` build, build context = monorepo root.
15. **Updated `apps/api/.dockerignore`** to use `**/`-prefixed patterns.
16. **`pnpm install`** at root — 972 packages, 50s; generated single root `pnpm-lock.yaml`.

### Fixes discovered during verification
- `@types/cron` was an unused devDep that broke `tsc --noEmit` (TS2688). Removed it from `apps/api/package.json`.
- `tsc --noEmit` was matching `test/app.e2e-spec.ts` which is outside `rootDir: ./src`. Added `"include": ["src/**/*"]` to `apps/api/tsconfig.json`.
- `next build` ESLint walked 5 directories up to the **outer** repo's `.eslintrc.js` (because the worktree lives inside `Inspect-monorepo/.claude/worktrees/`). Added `apps/web/.eslintrc.json` with `root: true` + `extends: ["next/core-web-vitals"]`.

## Verification results

All run from the worktree root via `npx pnpm@9.12.0 ...` (pnpm wasn't on PATH; corepack was broken by a known Node 22 signature-key bug).

| Check | Result |
|---|---|
| `pnpm install` | ✓ 972 packages, 50s |
| `pnpm --filter @inspect/api type-check` | ✓ |
| `pnpm --filter @inspect/web type-check` | ✓ |
| `pnpm --filter @inspect/api build` | ✓ — `apps/api/dist/main.js` produced |
| `pnpm --filter @inspect/web build` (with `POSTGRES_URL` stubbed) | ✓ — 6 routes, `.next/` populated |
| `pnpm build` (turbo orchestrated, cold) | ✓ 2 tasks successful, 26.5s |
| `pnpm build` (turbo orchestrated, warm) | ✓ **FULL TURBO**, 120ms (cache hit) |

The web build needs `POSTGRES_URL` set at build time because `apps/web/lib/db.ts:17` does `neon(process.env.POSTGRES_URL!)` at module load. This is original-codebase behavior — not introduced by the restructure.

## Pitfalls to remember
1. **Port conflict** — api defaults to 3000, web reassigned to 3001 via `next dev -p 3001` / `next start -p 3001`. `NEXTAUTH_URL` must match the web port or OAuth callbacks fail.
2. **`outputFileTracingRoot`** — required in `next.config.ts` so `next build`'s file trace includes hoisted deps in the workspace root `node_modules`.
3. **TypeORM `synchronize: true → false`** — currently harmless (empty entities) but must stay false once real entities exist.
4. **`@types/cron` was deadweight** — removed; the only dep that needed it (`@nestjs/schedule`) ships its own types.
5. **ESLint `root: true`** — both `apps/api/.eslintrc.js` and `apps/web/.eslintrc.json` set this. Required because ESLint walks the parent directory tree by default.
6. **pnpm not on PATH locally** — install with `npm i -g pnpm@9.12.0` or use `npx pnpm@9.12.0 ...`. Corepack is broken on this Node 22 install due to an outdated signature key.
7. **TypeScript version typo** — the original root `package.json` declared `typescript: ^6.0.3` (which doesn't exist — TS 6 isn't released). Pinned the workspace to `^5.7.2`.
8. **Frontend's nested `.git/`** — was treated as a submodule by the outer repo and skipped on `git add`. Manually copied into the worktree without it. **After merge, delete `frontend/` from the outer repo's working tree.**
9. **Lockfile churn** — old `package-lock.json` (root) and `pnpm-lock.yaml` (frontend) both deleted; a fresh single root `pnpm-lock.yaml` replaces them. ~13.5k insertions / 10.4k deletions in the restructure commit — normal one-time diff.

## Files changed (summary)

72 files changed in commit `01e4d4e`, 1 file in commit `7e8dc57`.

**New root files**:
- `package.json` (workspace root), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `.npmrc`, `.gitignore`, `.prettierrc`, `.env.example`

**Moved into `apps/api/`**:
- `src/`, `test/`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.eslintrc.js`, `Dockerfile`, `.dockerignore`

**Moved into `apps/web/`** (from `frontend/`):
- `app/`, `components/`, `lib/`, `public/`, `.vscode/`, `next.config.ts`, `package.json`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.js`, `components.json`, `middleware.ts`, `LICENSE.md`, `README.md`

**Deleted from root**:
- `package-lock.json`, `.example.env`, original `.gitignore` / `.prettierrc` (replaced by unified root versions)

**Materially rewritten** (not just moved):
- `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/Dockerfile`, `apps/api/.dockerignore`
- `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/.eslintrc.json` (new)
- `.env.example` (final populated version in commit `7e8dc57`)

## Railway Deployment

Both services deploy from the same repo using per-service Dockerfiles.

### Configuration per service

| Setting | API Service | Web Service |
|---|---|---|
| Root Directory | `/` (monorepo root) | `/` (monorepo root) |
| `RAILWAY_DOCKERFILE_PATH` | `apps/api/Dockerfile` | `apps/web/Dockerfile` |

### Required env vars (Railway dashboard)

| Var | API | Web | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | Private network Postgres URL |
| `REDIS_URL` | ✅ | — | Private network Redis URL |
| `POSTGRES_URL` | — | ✅ | Same as `DATABASE_URL` (or public URL) |
| `NEXTAUTH_URL` | — | ✅ | Must match actual public domain (not localhost) |
| `AUTH_SECRET` | — | ✅ | 32+ char secret |
| `HOSTNAME` | — | ✅ | Set to `0.0.0.0` (required for Next.js standalone to accept connections) |

### Known runtime issues (current state)

1. **Auth `UntrustedHost`** — `NEXTAUTH_URL` must be set to the actual Railway public domain, not `http://localhost:3001`.
2. **Neon DB `ENOTFOUND api.railway.internal`** — The web service connects directly to Postgres via Neon. If using Railway's private domain, private networking must be enabled on the web service. Alternatively, use `DATABASE_PUBLIC_URL` for `POSTGRES_URL`. This issue goes away once the frontend is migrated to use the backend API instead of direct DB access.

## Frontend → API Migration (completed)

The frontend no longer queries Postgres directly. All data fetching goes through the NestJS API.

### What changed

**New backend files (`apps/api/src/products/`):**
- `product.entity.ts` — TypeORM entity mapping to existing `products` table (no migration needed)
- `products.service.ts` — replicates the exact query logic from the old `db.ts` (search, pagination, delete, seed)
- `products.controller.ts` — `GET /products?search=&offset=`, `DELETE /products/:id`, `POST /products/seed`
- `products.module.ts` — feature module registered in `AppModule`

**New frontend file:**
- `apps/web/lib/api.ts` — server-only fetch client calling the NestJS API

**Modified frontend files:**
- `app/(dashboard)/page.tsx` — imports `getProducts` from `@/lib/api`
- `app/(dashboard)/product.tsx` — uses `Product` type from `@/lib/api`, wraps `availableAt` in `new Date()` (JSON returns ISO string)
- `app/(dashboard)/products-table.tsx` — uses `Product` type from `@/lib/api`
- `app/(dashboard)/actions.ts` — delete action uncommented and rewired to API
- `app/api/seed/route.ts` — proxies to `POST ${API_URL}/products/seed`

**Deleted:**
- `apps/web/lib/db.ts` (Drizzle/Neon direct DB client)

**Removed dependencies from `apps/web/package.json`:**
- `@neondatabase/serverless`, `drizzle-orm`, `drizzle-zod`, `zod`, `drizzle-kit`

**New env var:**
- `API_URL` — added to `.env.example` and `turbo.json`. Set to `http://localhost:3000` for local dev; on Railway set to the API service's internal/public URL.

**Other:**
- `app.enableCors()` added in `apps/api/src/main.ts`
- `.env.example` comment updated (frontend no longer reads `POSTGRES_URL`)

### Railway deployment update

| Var | API | Web | Notes |
|---|---|---|---|
| `API_URL` | — | ✅ | Internal URL of the API service (e.g. `http://api.railway.internal:3000`) |
| `POSTGRES_URL` | — | — | **No longer needed by web** |

The `ENOTFOUND api.railway.internal` issue documented earlier is now resolved — the frontend no longer connects to Postgres at all.

## What you need to do next

1. **Set up `.env`**: `cp .env.example .env` and verify the populated values still match your Railway dashboard. Generate `AUTH_SECRET` (32+ chars) and fill in `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`. Add `API_URL=http://localhost:3000`.
2. **Run locally**: `pnpm install` → `pnpm dev` (api on `:3000`, web on `:3001`).
3. **Verify health**: `curl http://localhost:3000/health` should return `{"status":"ok","info":{"database":{"status":"up"},"redis":{"status":"up"}}}` once `.env` is populated.
4. **Verify products**: `curl http://localhost:3000/products` should return product data from the DB.
5. **Seed data** (if empty): `curl http://localhost:3001/api/seed` to populate 10 sample products via the API.
6. **Rotate the passwords** in Railway (and update the new `.env`) at your convenience.

## Out of scope (deferred)
- Adding `packages/shared-types`, `packages/eslint-config`, `packages/tsconfig`.
- Migrating root ESLint from legacy `.eslintrc.js` to flat config.
- CI workflow (GitHub Actions / Railway deploy pipeline).
- Splitting `apps/web` runtime vs dev dependencies more granularly.
- Adopting TypeORM migrations (required before `synchronize: false` is safe with real entities).
