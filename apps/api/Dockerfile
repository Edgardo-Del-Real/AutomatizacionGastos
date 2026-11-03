# syntax=docker/dockerfile:1

# Deploy image for the API + Telegram bot (Render).
#
# The whole workspace is copied on purpose: pnpm resolves the install graph
# from every workspace manifest, so a partial copy makes `tsc`/`prisma`
# unavailable inside the image. `.dockerignore` keeps node_modules, dist, .git
# and the local .env out.
FROM node:22-alpine

RUN corepack enable
WORKDIR /app

ENV CI=true

COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm --filter @rita/contracts build \
  && pnpm --filter @rita/api exec prisma generate

ENV NODE_ENV=production
EXPOSE 3000

# Migrations go through DIRECT_URL (Supabase direct connection): the pooler
# cannot hold the session a migration needs.
CMD ["sh", "-c", "pnpm --filter @rita/api exec prisma migrate deploy && pnpm --filter @rita/api start"]
