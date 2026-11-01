# Design: Monthly Dashboard

## Technical Approach

A single period concept — `month=YYYY-MM` — replaces the optional `from`/`to` pair. The API owns all
calendar arithmetic in Buenos Aires; the dashboard owns only the selected key. The summary payload
shrinks to what is actually rendered plus the bot's needs.

## Architecture Decisions

### Decision: `month` is the wire concept, not `from`/`to`

**Choice**: `GET /movements/summary` and `GET /movements` accept `month=YYYY-MM`; `from`/`to` are
removed from both.

**Rationale**: Optional dates are what produced the bug — an omitted period silently meant "all
time", so the dashboard showed lifetime totals and nobody noticed. A month key is unambiguous and is
exactly the product unit ("mes a mes"). It also removes duplicated calendar math from the frontend
(days per month, Buenos Aires offsets) and keeps the one implementation that is already correct and
tested.

**Alternative rejected**: keep `from`/`to` and add a month selector that computes the range in the
dashboard. It duplicates month-length logic in the client and preserves the footgun.

### Decision: absent `month` means lifetime, and only the bot uses it

**Choice**: `month` is optional server-side. The summary without `month` returns lifetime totals.

**Rationale**: "cuánto tengo" is a lifetime question by definition, so the bot's `balance` query
passes no month. Making the parameter required would force the bot to lie.

**Consequence**: every other caller must be explicit. The dashboard hook takes the month as a
required argument, so forgetting it is a type error, not a silent behaviour change.

### Decision: `Disponible` = net of the period

**Choice**: `balance = income − expenses − manualSavings` computed over the selected month.

**Rationale**: Product decision (owner, 2026-11-01). The formula does not change; only its scope
does, which is why the same code serves the bot's lifetime balance and the dashboard's monthly
number.

### Decision: delete `mom` instead of anchoring it

**Choice**: `mom`, `summaryMonths`, `lastMonths` and the `MonthBucket` aggregation are removed.

**Rationale**: nothing renders the 6-month series — its only reader is the empty-state predicate.
Anchoring a series nobody draws is work in exchange for a maintenance burden. The owner declined the
6-month chart, so the honest move is deletion. `top`, `avgPerMonth`, `avgPerMovement` and
`maxAmount` are equally unrendered but are left for a follow-up to keep this change reviewable.

### Decision: previstos leave the monthly list, so the planned block carries their rows

**Choice**: `PENDING` rows are no longer reachable through `GET /movements` with a month; the summary's
`planned` block carries `{ total, movements }` instead.

**Rationale**: a previsto has no date (it gets one when paid), so it cannot belong to a month. But the
dashboard's only mark-paid surface today is the list row, so simply hiding the rows would remove the
ability to pay them from the dashboard. The block that owns previstos must carry them. Computing
`total` as the ARS sum of those same rows also deletes the dedicated `summaryPlanned` aggregate.

**Alternative rejected**: a separate `GET /movements/pending` endpoint — a second request for data
the summary already has to read in order to compute the total.

## Data Flow

```
MonthSelector (?mes=2026-11)
        │
        ├─ GET /movements/summary?ownerId&visibility&month=2026-11
        │        └─ monthToPeriod("2026-11") → { from: "2026-11-01", to: "2026-11-30" }
        │            ├─ summaryKpis(period)      → income, expenses, count, ...
        │            ├─ summarySavings(period)   → kpis.savings
        │            ├─ summaryManualSavings(period) → deducted from balance
        │            ├─ summaryDaily(period)     → one point per day of the month
        │            ├─ summaryCategories(period)
        │            └─ listByOwner(PENDING)     → { total, movements } (no date, ignores month)
        │
        └─ GET /movements?ownerId&visibility&month=2026-11
                 └─ monthToPeriod → listByOwner({ from, to }) + PENDING excluded
```

Bot wiring (unchanged behaviour, explicit scope):

```
query-executor.balance  → getSummary(scope)                  → lifetime totals
query-executor.month    → getSummary(scope, currentBaMonth()) → kpis.count + period month key
query-executor.savings  → getSummary(scope, currentBaMonth()) → kpis.savings
query-executor.planned  → getSummary(scope).planned.total     → no month key
```

## Contracts

```ts
// movementSummarySchema
kpis:      { income, expenses, balance, savings, manualSavings, avgPerMonth, avgPerMovement, maxAmount, count }
daily:     [{ day, income, expenses, balance }]        // one entry per day of the requested month; [] without month
categories:[{ name, expenseAmount, incomeAmount, expensePercent, incomePercent }]
top:       { expenses: [movement], income: [movement] }
planned:   { total, movements }                        // - month, - mom, - countThisMonth
```

Wire parameters: `month` matches `^\d{4}-(0[1-9]|1[0-2])$`; anything else is `422` with the standard
`ValidationFailedError` envelope.

## New Module

`apps/api/src/features/movements/ba-month.ts`

- `BA_OFFSET_MS`, `currentBaMonth(now = new Date())` → `"YYYY-MM"`.
- `monthToPeriod(month)` → `{ from: "YYYY-MM-01", to: "YYYY-MM-<lastDay>" }` via UTC arithmetic.
- `isMonthKey(value)` → boolean guard for the route schemas.

The repository keeps using `baDayStart`/`baDayEnd` for the SQL bounds, so the Buenos Aires semantics
stay in one place.

## File Changes

| File | Action |
|---|---|
| `packages/contracts/src/index.ts` | Modify: `planned` loses `month`; drop `mom`, `countThisMonth` |
| `apps/api/src/features/movements/ba-month.ts` | Create: month key ↔ period helpers |
| `apps/api/src/features/movements/movements.service.ts` | Modify: period-driven summary; delete `thisMonthKpis`/`currentMonthPeriod`/`nextBaMonth`/`lastMonths` |
| `apps/api/src/features/movements/movements.repository.ts` | Modify: `summaryDaily`/`summarySavings` take the period; `summaryPlanned` loses `month`; delete `summaryMonths` |
| `apps/api/src/features/movements/movements.route.ts` | Modify: `month` replaces `from`/`to` on both endpoints |
| `apps/api/src/features/movements/movements.types.ts` | Modify: `MovementListFilters` carries `month` |
| `apps/api/src/features/telegram/query-executor.ts` | Modify: explicit current month; `kpis.count`; period month key |
| `apps/dashboard/src/features/movements/SummarySection.tsx` | Modify: empty predicate without `mom` |
| `apps/dashboard/src/features/movements/KpiCards.tsx` | Modify: `countThisMonth` → `count` |
| `apps/dashboard/src/infra/api.ts` | Modify: summary/list take a month |

## Testing Strategy

Strict TDD (repo config). Layers:

- **Unit** (`movements.service.test.ts`): period propagation, `daily` zero-filled for every day of
  the month, no-period lifetime path, `planned` independent of the month.
- **Integration** (`movements.route.test.ts`, `*.integration.test.ts`): `month` accepted, lifetime
  when absent, `422` on a malformed key, PENDING rows excluded from a month-scoped list, savings
  scoped to the requested month (including a past one).
- **Contracts** (`packages/contracts`): the schema rejects `planned.month`-shaped payloads and
  accepts the new shape.
- **Bot** (`query-executor.test.ts`): each query passes the scope it claims (lifetime vs current
  month).

## Migration / Rollback

No database migration. `occurredAt` keeps meaning "the date the movement belongs to" and
`markPaidById` keeps rewriting it to the payment date. Rollback is `git revert` of the slice.
