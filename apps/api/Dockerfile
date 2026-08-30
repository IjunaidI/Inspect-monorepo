# apps/api — monorepo-aware image (INS-090).
#
# The four shared packages ship `main: dist/index.js` and `dist/` is gitignored, so in a
# clean build context they have never been built. `pnpm build:api` (root script,
# `pnpm --filter "@inspect/api..." build`) builds them in dependency order — NEVER a bare
# `pnpm --filter @inspect/api build`, which skips them and dies on
# `Cannot find module '@inspect/shared-types'`.
#
# Build from the REPO ROOT: `docker build -f apps/api/Dockerfile .`
# (On Railway: set the service's Dockerfile path to apps/api/Dockerfile, root directory `/`.)

FROM node:20-slim AS base
# Prisma engines on a slim image need openssl
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Workspace root manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# The shared packages and the API. packages/ MUST be in the context — apps/api depends on
# @inspect/shared-types and @inspect/domain via workspace:^.
COPY packages ./packages
COPY apps/api ./apps/api

# Full workspace install, not a filtered one: the shared packages build with bare `tsc`
# and resolve typescript from the ROOT devDependencies, which a filtered install omits.
# apps/api's postinstall runs `prisma generate` (schema copied above, openssl present).
RUN pnpm install --frozen-lockfile

# Shared packages first, then `nest build` -> apps/api/dist/main.js
RUN pnpm build:api

FROM node:20-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
ENV NODE_ENV=production
WORKDIR /app

# Copy the built workspace wholesale: the runtime resolves @inspect/* through workspace
# symlinks into packages/*/dist, and pruning risks breaking those links. This is a dev
# image; correctness beats size.
COPY --from=base /app ./

EXPOSE 3000
# Release step (run at deploy time, NOT at build — needs the live DATABASE_URL):
#   pnpm --filter @inspect/api exec prisma migrate deploy
#   pnpm --filter @inspect/api exec prisma db seed     (idempotent; global defect library)
# Required env or the app refuses to boot: DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET,
# JWT_REFRESH_SECRET, REPORT_SIGNING_PRIVATE_KEY_PEM (mint fresh per environment), S3_*.
# Health check: GET /health reports db + redis.
CMD ["node", "apps/api/dist/main.js"]
