# syntax=docker/dockerfile:1
# Build context MUST be the monorepo root:
#   docker build -f apps/api/Dockerfile -t inspect-api .

# ---- base ----
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---- pruner: produce a minimal subtree containing only what @inspect/api needs ----
FROM base AS pruner
RUN npm i -g turbo@2.3.0
COPY . .
RUN turbo prune @inspect/api --docker

# ---- installer/builder ----
FROM base AS installer
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ ./
RUN pnpm --filter @inspect/api build

# ---- production runtime ----
FROM base AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --prod

COPY --from=installer /app/apps/api/dist ./apps/api/dist

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

CMD ["node", "apps/api/dist/main"]
