# Tasks: Complete Dashboard with Income Tracking

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~3,500–4,000 (F1 ~600, F2 ~1,100, F3 ~400, F4 ~1,500) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (F1) → PR 2 (F2) → PR 3 (F3) → PR 4 (F4), each merging to dev in order |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Model + contracts | PR 1 | `pnpm --filter @rita/api test` | `prisma migrate deploy` on `automatizacionrita_test` | Drop migration, revert schema/contracts |
| 2 | `/movements` API | PR 2 | `pnpm --filter @rita/api test` | Fastify `app.inject` + test DB | Revert slice + expenses edits |
| 3 | Webhook classification | PR 3 | `pnpm --filter @rita/api test` | Fastify `app.inject` + test DB | Revert parser/service edits |
| 4 | Dashboard | PR 4 | `pnpm --filter @rita/dashboard test` + typecheck + lint | RTL + jsdom | Revert dashboard, restore old features |

## Phase 1: Model + Contracts (F1)

- [x] 1.1 (RED) Add `packages/contracts/src/index.test.ts`: `movementSchema` accepts `type=INCOME`, rejects `SAVINGS`; expense schemas unchanged. Verify: API test red.
- [x] 1.2 (GREEN, dep 1.1) Add `movementTypeSchema`, `movementSchema`, `listMovementsSchema`, `movementFiltersSchema`, `movementSummarySchema`, `createMovementSchema` to `packages/contracts/src/index.ts`. Verify: `pnpm --filter @rita/contracts build` + typecheck + 1.1 green.
- [x] 1.3 (dep 1.2) Add `enum MovementType`, `type` field (default `EXPENSE`), `@@index([ownerId, occurredAt])` to `apps/api/prisma/schema.prisma`; run `prisma migrate dev --name add_movement_type`. Verify: `migrate deploy` on test DB, expense route tests green, existing rows preserved.
- [x] 1.4 (dep 1.3) Add INCOME rows to `apps/api/scripts/seed-demo.ts`. Verify: seed runs.

## Phase 2: API `/movements` (F2)

- [x] 2.1 (RED, dep 1.3) Write `apps/api/src/features/movements/movements.route.test.ts`: combined filters, no matches → 200 empty, summary ARS-only, BA bucketing (`2026-08-01T02:59Z` → July), no-data zeros, MoM months. Verify: API test red.
- [x] 2.2 (GREEN, dep 2.1) Create `apps/api/src/features/movements/{movements.types,movements.repository,movements.service,movements.route}.ts`: repository raw-SQL (listByOwner, summaryKpis/Months/Daily/Categories, topByType; ARS-only, BA tz); service composes windows/zero-fill/%/top(5); route parses via `movementFiltersSchema`, `ValidationFailedError` on bad query; register `movementsRoute` in `apps/api/src/app.ts`. Verify: 2.1 green + typecheck.
- [x] 2.3 (RED, dep 2.2) Extend `apps/api/src/features/expenses/expenses.route.test.ts`: `/expenses` excludes INCOME; `/expenses/summary` matches `expenseSummarySchema` unchanged. Verify: API test red.
- [x] 2.4 (GREEN, dep 2.3) Scope `/expenses*` to `EXPENSE` in `apps/api/src/features/expenses/{expenses.repository,expenses.service}.ts` (type filter; mapper omits `type`). Verify: 2.3 green + retrocompat tests green.

## Phase 3: Webhook (F3)

- [x] 3.1 (RED, dep 1.3) Extend `apps/api/src/features/webhook/webhook.parser.test.ts`: keyword, `+` prefix, default EXPENSE, conservative. Verify: API test red.
- [x] 3.2 (GREEN, dep 3.1) Add `classifyMovementType(body)` pure function to `apps/api/src/features/webhook/webhook.parser.ts`. Verify: 3.1 green.
- [x] 3.3 (dep 3.2) Extend `webhook.service.test.ts` (type persisted, dedupe + signature intact); wire `type` into `createExpense` in `apps/api/src/features/webhook/webhook.service.ts`. Verify: API test green.

## Phase 4: Dashboard (F4)

- [x] 4.1 (RED) `apps/dashboard/src/infra/currency.test.ts`; (GREEN) `formatARS(n)` via `Intl.NumberFormat("es-AR", { style: "currency" })` in `infra/currency.ts`. Verify: dashboard test green.
- [x] 4.2 (RED, dep 4.1) Update `infra/api.test.ts`; (GREEN) `fetchMovementSummary` + `fetchMovements` (query params, contract validation) in `infra/api.ts`; drop `fetchExpenses`/`fetchSummary`. Verify: dashboard test green.
- [x] 4.3 (RED) `features/movements/calculations.test.ts`; (GREEN) `momPercent`, `dailyAverage` in `features/movements/calculations.ts`. Verify: dashboard test green.
- [x] 4.4 (RED, dep 4.2) `useMovementSummary.test.tsx`, `useMovements.test.tsx`; (GREEN) hooks in `features/movements/` refetching on filter change. Verify: dashboard test green.
- [x] 4.5 (RED, dep 4.3/4.4) Component tests; (GREEN) `DashboardOverview`, `KpiCards`, `MomChart`, `DailyChart`, `CategoryBreakdown`, `TopMovements`, `MovementList`, `MovementFilters` in `features/movements/` (Spanish strings, es-AR amounts, loading/error+retry/empty states, combined filters + reset). Verify: dashboard test green.
- [x] 4.6 (dep 4.5) Delete `apps/dashboard/src/features/{metrics,expenses}/`; rewrite `apps/dashboard/src/App.tsx` with Spanish header + section order. Verify: typecheck + lint.
- [x] 4.7 (RED, dep 4.6) Update `App.test.tsx`: all sections in order, Spanish, es-AR, empty/error+retry, malformed → error (no crash/partial). Verify: dashboard test green.

## Key Learnings

1. The single-table `type` discriminator keeps migrations additive: `NOT NULL DEFAULT 'EXPENSE'` preserves rows with zero backfill.
2. Buenos-Aires bucketing needs a double cast (`AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires'`) because Prisma stores naive UTC wall-clock timestamps.
3. `/movements` list filters (`from`/`to`) are UTC-bounded while summary bucketing is AR-tz — two different time semantics on the same date columns.
4. Totals (`kpis`, `top`, `count`) are ARS-only, but `/movements` returns all currencies — the summary and list endpoints are not symmetric.
5. The 4-phase chain (model→API→webhook→dashboard) lands each PR independently with its own verification and rollback boundary.