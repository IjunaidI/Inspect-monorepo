# Deploying to Railway (remote dev environment)

> Verified 2026-09-02 ([INS-090](../future/BACKLOG.md)). This is a **dev** environment — see the
> temporary licence block in the root `CLAUDE.md`. There is still no production deployment.

## Layout — Railway project `QCLink`

Project id `fd16ba94-e32d-4f71-afb6-a8d7fc5fcdbd`, one environment (`production` — the name is
Railway's default; it is a dev environment), region `asia-southeast1`. Every app service deploys
from GitHub `IjunaidI/Inspect-monorepo` @ `main` on push, **root directory `/`**.

| Service | What | Source / config | Public URL |
|---|---|---|---|
| `Main Application` | the NestJS API | `apps/api/Dockerfile`; config file **`apps/api/railway.json`** | `https://main-application-production-6fa4.up.railway.app` |
| `serene-vision` | the Next.js console | `apps/web/Dockerfile` (via `RAILWAY_DOCKERFILE_PATH`) | `https://serene-vision-production-8387.up.railway.app` |
| `Postgres-k9HN` | Postgres 16 | Railway plugin | private + a public TCP proxy (the root `.env` uses the proxy) |
| `Redis` | Redis 8 | Railway plugin | private + a public TCP proxy |
| bucket `assembled-basket` | S3-compatible object storage | Railway bucket | `S3_*` on the API service |

The **local `.env` and the deployed API share the same Postgres** (the local URL is the public proxy of
`Postgres-k9HN`). So a `prisma migrate reset` locally resets the deployed database too — check which
`DATABASE_URL` is loaded before anything destructive.

## The API service contract (what `apps/api/railway.json` sets)

- **Build:** `DOCKERFILE` at `apps/api/Dockerfile`, root context — the image runs `pnpm install
  --frozen-lockfile` + `pnpm build:api` (never a bare `--filter` build; see the Dockerfile header).
- **Pre-deploy** (every deployment, before the new container takes traffic): ONE command,
  `sh -c "pnpm --filter @inspect/api exec prisma migrate deploy && pnpm --filter @inspect/api exec prisma db seed"`.
  **The `sh -c` is load-bearing.** Railway does not run the pre-deploy string through a shell: with a bare
  `a && b` the step exited 0 but only `migrate deploy` ran (the `&&` and everything after it were handed to
  Prisma as ignored positionals) — the seed never executed. Proven 2026-09-02 by setting a NEW
  `BOOTSTRAP_ADMIN_PASSWORD`: login with it was 401 until the `sh -c` form deployed (`4efbcfe4`), whose
  log shows "Seed complete … 14 already present" + "Bootstrap Platform Admin ready" and login 201.
  The API also refuses a two-entry `preDeployCommand` array ("Invalid input"). `BOOTSTRAP_ADMIN_*` IS
  set on the service, so every deploy converges the platform admin's password to the Railway value —
  the root `.env` carries the same value (synced 2026-09-02) so a local seed does not flip it back.
- **Start:** `node apps/api/dist/main.js`. **Healthcheck:** `GET /health` (Terminus: db + redis).
- **Where the settings live:** the service *settings* (healthcheck, pre-deploy, start command) are the
  authority today, set via `serviceInstanceUpdate` on 2026-09-02; `apps/api/railway.json` mirrors them.
  To make the file the authority, set the service's *config file path* to `apps/api/railway.json` —
  but ONLY once that file is on GitHub `main`: Railway snapshots the repo and fails the deployment at
  `SNAPSHOT_CODE` with `service config at 'apps/api/railway.json' not found` otherwise (two failed
  deploys on 2026-09-02 while the commit was still local). A root-level `railway.json` would also
  govern the web service, so keep it under `apps/api/`. Note the GraphQL `Builder` enum has no
  `DOCKERFILE`; the Dockerfile build comes from the `RAILWAY_DOCKERFILE_PATH` service variable.
- ⚠️ Railway has deprecated `railway.json` in favour of `.railway/railway.ts`; existing files keep
  working until **2026-12-01**. Migrate with `railway config migrate` before then.

### The port gotcha (this was the 502)

Railway injects a random `PORT` and, with no target port on the domain, routes to it. The API reads
**`API_PORT`** (default 3000) and ignores `PORT`, so the proxy aimed at a port nothing listened on and
every request answered `502 Application failed to respond` while the logs said "Nest application
successfully started". Fixed by setting the domain's target port to 3000 (`railway domain update
<domain> --port 3000`) and `API_PORT=3000` explicitly. If the domain is ever recreated, set the port again.
**Railway's own health check has the same blind spot:** it probes the port in `PORT`, so with the
`/health` check enabled the deploy sat in DEPLOYING for the full 300 s timeout and FAILED
(`HEALTHCHECK: Healthcheck failure`) while the app was up. Pinning the service variable **`PORT=3000`**
fixed it — keep `PORT`, `API_PORT` and the domain target port equal.

### Variables on `Main Application`

Required to boot: `DATABASE_URL`, `REDIS_URL` (both `${{...}}` references to the plugins),
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `REPORT_SIGNING_PRIVATE_KEY_PEM`, `S3_*`.
Set 2026-09-02: a **fresh** Ed25519 `REPORT_SIGNING_PRIVATE_KEY_PEM` (minted for this environment,
never on disk in the repo), `API_PORT=3000` + `PORT=3000` (see the port gotcha), `ALLOWED_ORIGINS` (console origin + `http://localhost:3001`),
`WEB_BASE_URL` (console origin — invite/portal links), `RATE_LIMIT_TRUSTED_PROXIES=1` (Railway's edge).
`NODE_ENV=production` comes from the Dockerfile, so `/docs` is off — read the committed `openapi.json`.

### Variables on `serene-vision`

`INSPECT_API_URL` (the API's public https origin — the console fetches server-side),
`AUTH_SECRET`, `NEXTAUTH_URL`, `WEB_BASE_URL`, and **`AUTH_TRUST_HOST=true`** — NextAuth v5 sits behind
Railway's proxy and answers `UntrustedHost` 500s on every `/api/auth/*` route without it. Before 2026-09-02 the service carried an `API_URL`
the console never reads, so it silently ran on demo data. Note `NODE_ENV=development` is still set as a
service variable there (overrides the Dockerfile's `production`); harmless for dev, tidy when convenient.

## Day-to-day commands (Railway CLI, logged in as the project owner)

```
railway link -p fd16ba94-e32d-4f71-afb6-a8d7fc5fcdbd -e production -s "Main Application"
railway status --json                      # what is linked
railway deployment list -s "Main Application" --json
railway logs -s "Main Application" -d -n 200          # deploy logs (add -b for build logs)
railway variable list -s "Main Application" --json    # prints raw values — keep out of transcripts
railway variable set KEY=value -s "Main Application" --skip-deploys
railway redeploy -s "Main Application" --yes          # same image AND same settings manifest — re-runs pre-deploy but does NOT pick up changed service settings
railway redeploy -s "Main Application" --yes --from-source   # rebuild from the latest main; the ONLY way a settings change (healthcheck, pre-deploy, start) reaches a deployment
railway api 'query { deploymentEvents(id: "<deployment-id>") { edges { node { step payload { error } } } } }'  # why a deploy FAILED
curl https://main-application-production-6fa4.up.railway.app/health
```

Pushing to `main` deploys both app services automatically; the ~15 commits of 2026-09-01 each produced
a build. If a push must not deploy, use a branch.

## Mobile

`apps/mobile/eas.json` `preview` and `production` profiles carry the two origins above as
`EXPO_PUBLIC_INSPECT_API_URL` / `EXPO_PUBLIC_INSPECT_WEB_URL`. The device build is
`eas build --profile preview --platform android`.
