# Design: Complete Dashboard with Income Tracking

## Technical Approach

Add `MovementType` enum and `type` column (default `EXPENSE`) to the single `Expense` table. `@rita/contracts` gains `movementSchema` (superset of `expenseSchema`, untouched), `movementSummarySchema`, `listMovementsSchema`, `movementFiltersSchema`, `createMovementSchema`. New slice `features/movements/` exposes `GET /movements` (server-side filters) and `GET /movements/summary` (ARS-only, Buenos-Aires bucketing); `/expenses*` keeps shape, scoped to `EXPENSE`. Webhook classification is a pure function in `webhook.parser.ts`. Dashboard swaps `features/{metrics,expenses}` for `features/movements/`, rendering summary sections in order with es-AR currency and Spanish strings.

## Architecture Decisions

| # | Choice | Rationale |
|---|--------|-----------|
| 1 | One-table model: enum + `type` default `EXPENSE` | Same lifecycle; `NOT NULL DEFAULT` preserves rows, zero backfill. Proposal-locked. |
| 2 | `prisma migrate dev` then commit SQL; test/CI via `migrate deploy` | Route tests already run `migrate deploy` on `automatizacionrita_test` in `beforeAll`. |
| 3 | `movementSchema = expenseSchema.extend({ type })`; expense family unchanged | Additive — every `/expenses*` consumer keeps its contract; spec requires it unchanged. |
| 4 | New `features/movements/` slice reusing `prisma.expense`; `/expenses*` adds `where: { type: "EXPENSE" }`, mapper drops `type` | Vertical-slice convention; minimal `/expenses` diff, provable retrocompat. |
| 5 | AR bucketing in raw SQL: `date_trunc('month', "occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires')`; windows via `now() AT TIME ZONE '…'` | Prisma maps `DateTime` to `timestamp(3)` without tz (UTC wall-clock) — naive single `AT TIME ZONE` misbuckets; double cast required; windows stay BA-local. |
| 6 | Pure `classifyMovementType(body)` in `webhook.parser.ts`; service passes `type` to `createExpense` | Parser owns text analysis; service keeps dedupe/orchestration; unit-testable. |
| 7 | One repository method per facet (kpis/months/daily/categories/top), all `currency='ARS'`; service composes, zero-fills, computes %/windows | Composable + testable; front only renders. `top` limited to 5/type; `avgPerMonth` = balance / months-with-data; `count` = ARS movements; `maxAmount` = largest ARS movement. |
| 8 | Dashboard slice `features/movements/` + `infra/currency.ts` es-AR formatter; MoM % and daily average are pure front helpers | Mirrors existing hook/component pattern; one shared `Intl.NumberFormat('es-AR',{style:'currency'})`; Spanish texts inline JSX (current convention). |

## Data Flow

```
WhatsApp → WebhookService → parser.parseAmountAndNote + classifyMovementType
            → ExpenseService.createExpense({…, type}) → Prisma → Expense(type)
Dashboard → api.fetchMovementSummary → GET /api/movements/summary?ownerId&from&to
            → MovementService → MovementRepository (raw SQL, ARS-only, BA tz) → summary shape
Dashboard → api.fetchMovements(ownerId, filters) → GET /api/movements?type&from&to&category&q
            → MovementService → MovementRepository.findMany → list, occurredAt DESC
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/prisma/schema.prisma` + `migrations/*_add_movement_type/` | Modify/Create | `enum MovementType` + `type` default `EXPENSE` + `@@index([ownerId, occurredAt])`; generated `CREATE TYPE` + `ALTER TABLE ADD COLUMN`. |
| `packages/contracts/src/index.ts` | Modify | New movement schemas/types (see Interfaces); `createMovementSchema` = `createExpenseSchema` + optional `type`. |
| `apps/api/src/features/movements/{types,repository,service,route}.ts` + `*.test.ts` | Create | Repository: `listByOwner(ownerId, filters)`, `summaryKpis`, `summaryMonths`, `summaryDaily`, `summaryCategories`, `topByType`; service: windows/zero-fill/%/composition; route: query via `movementFiltersSchema`, `ValidationFailedError` on bad query. |
| `apps/api/src/features/expenses/{repository,service}.ts` | Modify | list/summarize accept `type`; `create` accepts optional `type`; mapper omits `type`. |
| `apps/api/src/features/webhook/{parser,service}.ts` + `app.ts` | Modify | `classifyMovementType(body)`; service passes `type`; register `movementsRoute`. |
| `apps/api/scripts/seed-demo.ts` | Modify | Add a few INCOME rows. |
| `apps/dashboard/src/infra/{api,currency}.ts` | Modify/Create | `fetchMovementSummary` + `fetchMovements` (extend `request()` with query params); drop `fetchExpenses`/`fetchSummary`; `formatARS(n)`. |
| `apps/dashboard/src/features/movements/` + `App.tsx` | Create/Modify | `useMovementSummary`, `useMovements(ownerId, filters)`, `calculations.ts` (`momPercent`, `dailyAverage`), `DashboardOverview`, `KpiCards`, `MomChart`, `DailyChart`, `CategoryBreakdown`, `TopMovements`, `MovementList`, `MovementFilters` + tests; Spanish header composition. |
| `apps/dashboard/src/features/{metrics,expenses}/` | Delete | Replaced; filters now server-side. |

## Interfaces / Contracts

```ts
export const movementTypeSchema = z.enum(["EXPENSE", "INCOME"]);
export const movementSchema = expenseSchema.extend({ type: movementTypeSchema });
export const listMovementsSchema = z.array(movementSchema);
export const movementFiltersSchema = z.object({
  ownerId: z.string().min(1),
  type: movementTypeSchema.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category: z.string().min(1).optional(),  // exact match
  q: z.string().min(1).optional(),         // case-insensitive note substring
});
export const movementSummarySchema = z.object({
  kpis: z.object({ income, expenses, balance, avgPerMonth, avgPerMovement, maxAmount, count }),
  mom: z.object({ months: z.array(z.object({ month, income, expenses, balance })) }),
  daily: z.array(z.object({ day, income, expenses, balance })),
  categories: z.array(z.object({ name, expenseAmount, incomeAmount, expensePercent, incomePercent })),
  top: z.object({ expenses: z.array(movementSchema), income: z.array(movementSchema) }),
});
```

`from` → `gte ${from}T00:00:00.000Z`; `to` → `lte ${to}T23:59:59.999Z` (list has no AR-tz rule). Key SQL (months; days same pattern):

```sql
to_char(date_trunc('month',
  "occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'YYYY-MM')
WHERE "ownerId" = ${ownerId} AND "currency" = 'ARS'
  AND "occurredAt" >= (date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') - interval '5 months')
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (API) | `classifyMovementType` keywords, `+` prefix, default, conservative; service zero-fills/%/kpis/top; schema `INCOME` passes / `SAVINGS` fails | Spec scenarios verbatim; mocked repository; fake timers. |
| Integration (API) | `/movements` combined filters + empty (200); `/movements/summary` ARS-only, BA bucketing (`2026-08-01T02:59Z` → July), no-data zeros, MoM; `/expenses*` exclude INCOME; webhook classifies + dedupes | Fastify `app.inject` + `migrate deploy` on `automatizacionrita_test` (existing pattern). |
| Unit (Dashboard) | `calculations`, `formatARS`, `useMovements` refetch on change, component states | RTL + jsdom; mocked `infra/api`. |
| Integration (Dashboard) | `App` renders all sections in order, Spanish + es-AR, empty/error+retry, malformed → error | RTL; movement contracts used by mocked client. |
| E2E | — | Unavailable. |

## Threat Matrix

All rows N/A — no git/shell/subprocess/executable-doc/PR boundary added. New API routing is data-path only; raw SQL is fully parameterized (`$queryRaw` bound params), no string-built SQL.

## Migration / Rollout

Feature-branch chain, base `dev`, ~900–1100 lines/PR (total ≈ 3500–4000, within budget):

| Phase | Scope | Verification | Rollback |
|-------|-------|--------------|----------|
| **F1 — Model + contracts** | Schema enum/type/index + migration + contracts + seed | `pnpm --filter @rita/api test` (migrate deploy on test DB, expense tests green) + typecheck + contracts build | Drop migration, revert schema/contracts |
| **F2 — API** | `features/movements/` slice + `/expenses*` EXPENSE scoping | movements tests + expense retrocompat tests | Revert slice + expenses edits |
| **F3 — Webhook** | `classifyMovementType` + service wiring | parser/service/route tests (dedupe, signature, type persisted) | Revert parser/service edits |
| **F4 — Dashboard** | `infra/currency.ts` + `features/movements/` + delete old features + `App.tsx` | `pnpm --filter @rita/dashboard test` + typecheck + lint + build | Revert dashboard, restore old features |

Build-first: every API/dashboard test script prefixes `pnpm --filter @rita/contracts build`.

## Open Questions

- None blocking. Noted: `category` is exact-match; `top`/kpis/count are ARS-only; list `from`/`to` bounds are UTC (summary bucketing is AR-tz).