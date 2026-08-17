# AutomatizacionRita

Expense-tracking system. Backend: Fastify + TypeScript on PostgreSQL + Prisma. Shared DTOs and zod schemas live in `packages/contracts` and are consumed by the API (and a future Next.js dashboard).

## Prerequisites

- Node.js >= 20
- pnpm 10+
- Docker with Docker Compose

## Getting started

```bash
# 1. Start PostgreSQL (16) and wait until healthy
docker compose up -d --wait

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env

# 4. Create the database schema and generate the Prisma client
pnpm --filter @rita/api exec prisma migrate dev --name init

# 5. Create the test database (used by integration tests)
docker compose exec -T postgres createdb -U rita automatizacionrita_test

# 6. Run the API in watch mode
pnpm dev
```

The API listens on `http://localhost:3000` (configurable via `PORT`).

## Common commands

```bash
pnpm test        # unit + integration tests (vitest)
pnpm build       # compile all workspaces
pnpm lint        # eslint (flat config at repo root)
pnpm typecheck   # tsc --noEmit across workspaces
```

## API endpoints

| Method | Path            | Description                                          |
| ------ | --------------- | ---------------------------------------------------- |
| POST   | `/expenses`     | Create an expense (body validated by contracts zod schema) |
| GET    | `/expenses?ownerId=` | List expenses for an owner                        |

Until authentication exists, the tenant is carried by the `x-owner-id` header on POST and the `ownerId` query param on GET.

## Layout

```
apps/api/                Fastify backend, owns the database
  prisma/schema.prisma   Data model (Expense, ProcessedMessage)
  src/features/          Vertical slices (route + service + repo + tests together)
  src/infra/             Shared infrastructure (db, errors, env)
  src/app.ts             Composition root (manual DI)
packages/contracts/      Shared zod schemas and DTOs
```
