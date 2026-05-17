# Inspect Monorepo

A pnpm + Turborepo monorepo containing the Inspect backend API and web dashboard.

## Stack

| App | Path | Framework | Port |
|---|---|---|---|
| `@inspect/api` | `apps/api` | NestJS 11 + Prisma + Postgres + Redis | `3000` |
| `@inspect/web` | `apps/web` | Next.js 15 (App Router) + Next-Auth | `3001` |

- **Package manager**: pnpm 9.12.0 (workspaces)
- **Task runner**: Turborepo
- **Node**: `>=20.0.0` (Node 22 works, see caveats)
- **Env strategy**: single root `.env` consumed by both apps

## Prerequisites

1. **Node.js 20+** — `node --version`
2. **pnpm 9.12.0** — `npm i -g pnpm@9.12.0` (see caveats if corepack fails)
3. **Postgres** — running and reachable (local Docker, Railway, Neon, etc.)
4. **Redis** — running and reachable (local Docker, Railway, Upstash, etc.)
5. **GitHub OAuth app** — for Next-Auth login on the web app. Create one at https://github.com/settings/developers with callback URL `http://localhost:3001/api/auth/callback/github`

> Don't have Postgres/Redis locally? The fastest path is to spin them up via Docker:
> ```bash
> docker run -d --name inspect-pg  -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
> docker run -d --name inspect-redis -p 6379:6379 redis:7
> ```

## Quick start

```bash
# 1. Clone and install
git clone <repo-url> Inspect-monorepo
cd Inspect-monorepo
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env — see "Environment variables" below for what to fill in

# 3. Generate Prisma client and apply migrations
pnpm --filter @inspect/api prisma:generate
pnpm --filter @inspect/api prisma:migrate

# 4. Start both apps in dev mode
pnpm dev
```

You should now have:
- API at http://localhost:3000
- Web at http://localhost:3001
- Health check at http://localhost:3000/health (returns `{ status: 'ok', info: { database: { status: 'up' }, redis: { status: 'up' } } }`)

## Environment variables

All env vars live in a **single root `.env`** file. Both apps load it:
- `apps/api/src/app.module.ts` walks up to `../../.env`
- `apps/web/next.config.ts` uses `dotenv` to load `../../.env`

Copy `.env.example` to `.env` and fill in:

| Var | Required by | Notes |
|---|---|---|
| `DATABASE_URL` | api | Postgres connection string. For local Docker: `postgresql://postgres:postgres@localhost:5432/postgres` |
| `REDIS_URL` | api | Redis connection string. For local Docker: `redis://localhost:6379` |
| `NEXTAUTH_URL` | web | Must match the web port. Local: `http://localhost:3001` |
| `AUTH_SECRET` | web | 32+ char secret. Generate at https://generate-secret.vercel.app/32 |
| `AUTH_GITHUB_ID` | web | GitHub OAuth app client ID |
| `AUTH_GITHUB_SECRET` | web | GitHub OAuth app client secret |
| `NODE_ENV` | both | `development` for local |
| `API_PORT` | api | Optional, defaults to `3000` |

The `${{...}}` placeholders in `.env.example` are Railway template references — replace them with real values for local dev (or pull from Railway's "Networking → Public Network" panel using `DATABASE_PUBLIC_URL` / `REDIS_PUBLIC_URL`).

## Common scripts

Run from the **repo root**:

```bash
pnpm dev              # start both api + web in watch mode (turbo)
pnpm build            # build both apps
pnpm lint             # lint both apps
pnpm type-check       # tsc --noEmit across the workspace
pnpm test             # run all tests
pnpm format           # prettier --write across the repo
pnpm clean            # remove dist/, .next/, .turbo/
```

Target a single app:

```bash
pnpm api dev          # alias for: pnpm --filter @inspect/api dev
pnpm web dev          # alias for: pnpm --filter @inspect/web dev
pnpm --filter @inspect/api <script>
pnpm --filter @inspect/web <script>
```

### API-specific (Prisma)

```bash
pnpm --filter @inspect/api prisma:generate    # regenerate Prisma client
pnpm --filter @inspect/api prisma:migrate     # create + apply dev migration
pnpm --filter @inspect/api prisma:studio      # open Prisma Studio GUI
```

`prisma generate` also runs automatically via `postinstall`.

## Project layout

```
Inspect-monorepo/
├── apps/
│   ├── api/                    @inspect/api — NestJS
│   │   ├── prisma/schema.prisma
│   │   ├── src/
│   │   │   ├── main.ts         reads API_PORT (default 3000), enables CORS
│   │   │   ├── app.module.ts   loads root .env, registers Prisma + Redis cache + health
│   │   │   ├── prisma/         PrismaService + module
│   │   │   └── health/         GET /health (db + redis checks)
│   │   └── Dockerfile          multi-stage pnpm build, context = repo root
│   └── web/                    @inspect/web — Next.js 15
│       ├── app/                App Router pages
│       ├── lib/auth.ts         Next-Auth (GitHub OAuth)
│       ├── middleware.ts       auth middleware
│       ├── next.config.ts      standalone output, loads root .env
│       └── Dockerfile          multi-stage pnpm build, context = repo root
├── docs/implementation/        historical implementation notes
├── .env.example                template — copy to .env
├── package.json                workspace root, scripts delegate to turbo
├── pnpm-workspace.yaml         apps/* + packages/*
├── turbo.json                  pipeline config
└── tsconfig.base.json          shared TS base (each app extends it)
```

`packages/` is reserved for future shared code (types, eslint-config, tsconfig). It's intentionally empty today.

## Caveats / gotchas

These have bitten people before — read before you start:

1. **Single root `.env`** — do not create per-app `.env` files. Both apps load the root one. If you add a new env var, also add it to `turbo.json` under `globalEnv` so Turbo's cache key includes it.

2. **Port conflict** — API is `3000`, web is `3001`. `NEXTAUTH_URL` must match the web port exactly or OAuth callbacks fail with `UntrustedHost`.

3. **GitHub OAuth callback URL** — must be `http://localhost:3001/api/auth/callback/github` on the GitHub OAuth app settings page. Mismatched callback URLs fail silently with `Configuration` error.

4. **pnpm not on PATH** — if `pnpm` isn't recognized:
   - Preferred: `npm i -g pnpm@9.12.0`
   - Fallback: `npx pnpm@9.12.0 <command>`
   - Corepack (`corepack enable pnpm`) is broken on some Node 22 installs due to an outdated signature key — known issue, just install pnpm globally instead.

5. **Prisma client must be generated** — `pnpm install` runs `prisma generate` automatically via the api's `postinstall` hook. If you ever see "Cannot find module '@prisma/client'" or similar, run `pnpm --filter @inspect/api prisma:generate`.

6. **Database must be migrated** — Prisma schema lives at `apps/api/prisma/schema.prisma`. On a fresh database, run `pnpm --filter @inspect/api prisma:migrate` before starting the API. The current schema has no models defined yet, so this is a no-op today but will matter as models are added.

7. **Health check is the canonical "is everything wired?" test** — after `pnpm dev`, `curl http://localhost:3000/health` tells you whether the API can reach both Postgres and Redis. If either reports `down`, your `.env` is wrong.

8. **`next build` needs env vars at build time** — `apps/web/next.config.ts` loads the root `.env` via `dotenv`. CI / Docker builds need the relevant env vars present at build time, not just runtime.

9. **`outputFileTracingRoot`** — set in `next.config.ts` so Next's standalone build traces files up to the workspace root `node_modules`. Don't remove it.

10. **ESLint `root: true`** — set in both apps so ESLint doesn't walk past the workspace boundary. Don't remove.

11. **Web app dev uses Turbopack** — `next dev --turbopack`. If you hit a Turbopack-specific bug, remove the `--turbopack` flag from `apps/web/package.json` to fall back to Webpack.

## Adding a new shared package

When two apps actually share code (not before):

1. Create `packages/<name>/` with its own `package.json` (name it `@inspect/<name>`).
2. It's automatically picked up by `pnpm-workspace.yaml` (`packages/*`).
3. Reference it from an app as `"@inspect/<name>": "workspace:*"` in dependencies.
4. Run `pnpm install` at root.

## Docker / Railway deploys

Each app has its own `Dockerfile` using a multi-stage pnpm build, with **build context = repo root**. Railway is configured per-service:

| Setting | API | Web |
|---|---|---|
| Root Directory | `/` | `/` |
| `RAILWAY_DOCKERFILE_PATH` | `apps/api/Dockerfile` | `apps/web/Dockerfile` |

For Railway-specific env var requirements and the `HOSTNAME=0.0.0.0` requirement for Next.js standalone, see `docs/implementation/monorepo-restructure.md` (sections "Railway Deployment" onwards).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| API starts but `/health` shows database `down` | `DATABASE_URL` wrong, Postgres not running, or migrations not applied |
| API starts but `/health` shows redis `down` | `REDIS_URL` wrong or Redis not running |
| API throws `REDIS_URL is required` at boot | `.env` not loaded — check it's at the repo root, not in `apps/api/` |
| Web login fails with `UntrustedHost` | `NEXTAUTH_URL` doesn't match the actual web URL (port mismatch most common) |
| Web login fails with `Configuration` | GitHub OAuth app callback URL doesn't match `NEXTAUTH_URL`/api/auth/callback/github |
| `Cannot find module '@prisma/client'` | Run `pnpm --filter @inspect/api prisma:generate` |
| `pnpm: command not found` | `npm i -g pnpm@9.12.0` (corepack is unreliable on Node 22) |
| `next build` fails with missing env var | Add it to root `.env` and to `turbo.json`'s `globalEnv` |
| Turbo cache miss every run | New env var not declared in `turbo.json` `globalEnv` |

## Further reading

- `docs/implementation/monorepo-restructure.md` — full history of how this monorepo was assembled, what was changed and why, Railway deploy details, and known historical pitfalls.
