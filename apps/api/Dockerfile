# syntax=docker/dockerfile:1

# Deploy image for the API + Telegram bot. Built from the repo root so the
# pnpm workspace and the contracts package are available.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

# Manifests first: the dependency layer is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

# Sources, then the generated Prisma client and the contracts build.
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @rita/contracts build \
  && pnpm --filter @rita/api exec prisma generate

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./

EXPOSE 3000

# Migrations run through DIRECT_URL (Supabase direct connection): the pooled
# URL cannot hold the session a migration needs.
CMD ["sh", "-c", "pnpm --filter @rita/api exec prisma migrate deploy && pnpm --filter @rita/api start"]
