# apps/web — monorepo-aware image (INS-090).
#
# `pnpm build:web` (root script, `pnpm --filter "@inspect/web..." build`) builds the four
# shared packages in dependency order first — NEVER a bare `pnpm --filter @inspect/web build`,
# which skips them and dies on `Cannot find module '@inspect/shared-types'`.
#
# Build from the REPO ROOT: `docker build -f apps/web/Dockerfile .`

FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Workspace root manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# The shared packages and the web app. packages/ MUST be in the context — apps/web depends
# on all four @inspect/* packages via workspace:^.
COPY packages ./packages
COPY apps/web ./apps/web

# Full workspace install: the shared packages build with bare `tsc` and resolve typescript
# from the ROOT devDependencies, which a filtered install omits.
RUN pnpm install --frozen-lockfile

RUN pnpm build:web

# Production (Next standalone output; outputFileTracingRoot is the repo root, so the
# standalone tree nests the app at apps/web/)
FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=base /app/apps/web/.next/standalone ./
COPY --from=base /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=base /app/apps/web/public ./apps/web/public

ENV PORT=3001
EXPOSE 3001
# Runtime env: INSPECT_API_URL (the API origin), AUTH_SECRET, NEXTAUTH_URL.
CMD ["node", "apps/web/server.js"]
