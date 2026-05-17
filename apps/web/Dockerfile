FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy the web package
COPY apps/web ./apps/web

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @inspect/web...

# Build (needs POSTGRES_URL at build time for Neon)
ARG POSTGRES_URL
ENV POSTGRES_URL=$POSTGRES_URL
RUN pnpm --filter @inspect/web build

# Production (standalone output)
FROM node:20-slim AS runner
WORKDIR /app

COPY --from=base /app/apps/web/.next/standalone ./
COPY --from=base /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=base /app/apps/web/public ./apps/web/public

ENV PORT=3001
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
