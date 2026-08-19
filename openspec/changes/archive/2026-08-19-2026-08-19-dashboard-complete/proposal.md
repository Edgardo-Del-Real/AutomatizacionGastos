# Proposal: Complete Dashboard with Income Tracking

## Intent

AutomatizacionRita tracks only expenses; owners cannot see balance, income, MoM trends, daily activity, or category mix, and amounts render raw in English. This adds full money-movement tracking (income + expense) and a complete single-scroll Spanish dashboard with es-AR currency formatting.

## Scope

### In Scope
- Data model: `type MovementType` enum (EXPENSE | INCOME) on `Expense`, default EXPENSE; Prisma migration preserves existing rows.
- Webhook: detect income vs expense from message text (keyword + `+`-prefix rule, default EXPENSE); create movement with `type`.
- API: `GET /movements/summary?ownerId=&from=&to=` (KPIs, MoM delta %, category breakdown, top movements, daily 30d series) and `GET /movements?ownerId=&from=&to=&type=&category=&q=` (server-side filtered list). `/expenses*` keeps current behavior as EXPENSE-filtered retrocompat.
- Contracts: `movementSchema`, `movementSummarySchema`, `listMovementsSchema`; keep `expenseSchema` family.
- Dashboard: single-scroll Spanish UI, `Intl.NumberFormat('es-AR',{style:'currency'})`, KPI cards (ingresos, gastos, balance, promedio mes, promedio movimiento, máximo, cantidad), MoM %, daily 30d + promedio diario, category % breakdown, top gastos, top ingresos, filtered list (date range, text, category, month, type, reset), loading/error/empty states.

### Out of Scope
- Category inference in webhook. Auth/owners. Server-side pagination (endpoint allows future `limit`/`offset`). CSV export (deferred).

## Capabilities

> Contract with sdd-spec. Existing: `openspec/specs/dashboard-web/spec.md`.

### New Capabilities
- `money-movements`: full-stack movement tracking — `type` enum on Expense, webhook income detection, `/movements` API (summary + filtered list), movement contracts.

### Modified Capabilities
- `dashboard-web`: complete single-scroll Spanish UI consuming `/movements` — KPIs, MoM, daily series, category breakdown, top lists, extended filters, es-AR currency.

## Approach

`type` enum on `Expense` (one-table) rather than a separate `Income` table — same lifecycle fields, single aggregation, migration default preserves rows as EXPENSE. Keep `Expense`/`expenses`; expose `/movements` as canonical API, keep `/expenses*` as EXPENSE-filtered aliases. Webhook: INCOME if note matches `ingreso|cobro|sueldo|venta|recibí|depósito` OR amount prefixed `+`; else EXPENSE. Dashboard replaces metrics/expenses features with movement features; keeps `VITE_OWNER_ID`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/prisma/schema.prisma` | Modified | `MovementType` enum + `type` field (default EXPENSE) |
| `apps/api/src/features/movements/**` | New | Routes + service + repository + tests for `/movements` |
| `apps/api/src/features/expenses/**` | Modified | Implicit `type=EXPENSE` filter for retrocompat |
| `apps/api/src/features/webhook/**` | Modified | Income-detection rule, movement `type` |
| `packages/contracts/src/index.ts` | Modified | Movement schemas; keep expense schemas |
| `apps/dashboard/src/**` | Modified | Spanish UI, es-AR currency, movement features, KPIs, filters |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SUM mixes currencies | Medium | Filter by `currency` (default ARS); per-currency deferred |
| Month bucketing UTC vs AR tz | Medium | `date_trunc(... AT TIME ZONE 'America/Argentina/Buenos_Aires')` |
| Free-text categories dirty | Medium | Normalize case/trim in aggregation; cleanup deferred |
| Webhook misclassification | Medium | Default EXPENSE; tunable keywords; log low-confidence |
| Exceeds 4000-line budget | High | Chain PRs by phase (model -> API -> webhook -> dashboard) |

## Rollback Plan

Revert migration (`prisma migrate resolve --rolled-back`, drop `type` column). Revert `movements/` + webhook; `/expenses*` unchanged. Revert contracts, rebuild. Revert dashboard. No data loss — `type` is additive.

## Dependencies

`@rita/contracts` (build-first), `@rita/api` on `:3000`, Postgres 16, Prisma 6, recharts, vitest 4, `Intl.NumberFormat` es-AR.

## Success Criteria

- [ ] Migration applies; existing expenses remain EXPENSE; `/expenses*` responses unchanged.
- [ ] Webhook classifies per rule; dedupe + signature intact.
- [ ] `/movements/summary` + `/movements` return contracted shapes.
- [ ] Dashboard renders single-scroll Spanish UI, es-AR currency, all KPIs + charts + filters + states.
- [ ] vitest green (api + dashboard); typecheck + lint clean; zod validation on every response.

## Open Decisions (confirm in spec round)

1. Webhook rule: confirm keyword list, `+`-prefix, conflict behavior, case, default EXPENSE.
2. Data model: keep `Expense`/`expenses` (recommended) vs rename `Movement`/`movements` via `@@map`.
3. Multi-currency: filter by `currency` default ARS (recommended) vs normalize vs per-currency.
4. Timezone bucketing: America/Argentina/Buenos_Aires (recommended) vs UTC vs per-owner.
5. API shape: split summary + list (recommended) vs single `/movements/dashboard` blob.
6. CSV export: include or defer.

## Recommended Phases (if scope too large)

1. Data model + migration + contracts. 2. API `/movements`. 3. Webhook detection. 4. Dashboard complete. 5. (optional) CSV export.
