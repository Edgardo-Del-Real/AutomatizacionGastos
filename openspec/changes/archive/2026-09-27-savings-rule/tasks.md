# Tasks: Automatic Savings Split on Income (savings-rule)

## Review Workload Forecast

Estimated changed lines: ~1,500–1,800 authored (goldens excluded)
Delivery strategy: auto-chain (session budget 5,000 lines)

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: feature-branch-chain
400-line budget risk: Low

### Work Units (single PR)

- Unit 1 — Contracts + migration. Test: api (pins). Harness: docker compose + createdb _test. Rollback: revert schema/migration.
- Unit 2 — Savings slice + category guards. Test: api (savings, categories). Harness: N/A, no boundary until unit 4. Rollback: revert savings + categories edits.
- Unit 3 — Movement exclusions + expenses split. Test: api (movements, expenses). Harness: app.inject _test (PATCH 422, split e2e). Rollback: revert repo/service edits.
- Unit 4 — Telegram flow + goldens. Test: api (telegram). Harness: brain-absent, GROQ_API_KEY unset. Rollback: revert telegram edits; goldens from git.
- Unit 5 — Wiring + dashboard. Test: dashboard. Harness: N/A, component tests only. Rollback: revert app.ts + dashboard edits.

## Phase 1: Contracts + Migration

- [x] 1.1 RED: contracts tests — SAVINGS in type/filter schemas; `savingsRuleSchema` rejects 0/101/neg; summary gains `kpis.savings` + `months[].savings`
- [x] 1.2 GREEN: edit `packages/contracts/src/index.ts` — SAVINGS enum, savings fields, savingsRuleSchema
- [x] 1.3 RED: migration-pin test — SavingsRule table, Category.type DEFAULT NORMAL, legacy ahorro → SAVINGS, movements untouched
- [x] 1.4 GREEN: edit `apps/api/prisma/schema.prisma` + D11 migration (ALTER TYPE ADD VALUE; CategoryType; SavingsRule DECIMAL(12,2) unique [ownerId, keyword])

## Phase 2: Savings Slice + Category Guards

- [x] 2.1 RED: savings tests — computeSplit 10@33% → 3.30/6.70 invariant; defineRule rejects 0/101/−1, upserts; matchNote via normalizeForMatch + boundaryRegex, oldest-wins
- [x] 2.2 GREEN: create `apps/api/src/features/savings/` — types, PrismaSavingsRuleRepository, SavingsRuleService
- [x] 2.3 RED: categories tests — "crear categoría ahorro" → SAVINGS never NORMAL; delete/rename reject SAVINGS; assertOwnerCategory rejects SAVINGS on EXPENSE/INCOME; ensureAhorro
- [x] 2.4 GREEN: edit `apps/api/src/features/categories/` — CategoryEntity.type, guards, ensureAhorro, savings_forbidden, export boundaryRegex

## Phase 3: Movements — KPI Exclusion

- [x] 3.1 RED: 5 integration tests (one per raw query) — SAVINGS excluded in summaryKpis (900/300/600), summaryMonths, summaryDaily, summaryCategories, topByType
- [x] 3.2 RED: integration tests — kpis.savings month-scoped (150 current, prior excluded), mom.months[].savings, GET /movements?type=SAVINGS
- [x] 3.3 GREEN: edit `apps/api/src/features/movements/movements.repository.ts` — D1 exclusion fragment, D2 third CASE, D3 summarySavings; service wires kpis.savings; balance = income − expenses

## Phase 4: PATCH Guard + Expenses Split

- [x] 4.1 RED: PATCH "ahorro" on EXPENSE/INCOME → 422; findById; createIncomeWithSavings `$transaction` atomicity (SAVINGS fails → neither persisted); pct=100 → only SAVINGS
- [x] 4.2 GREEN: PATCH guard via assertOwnerCategory(..., movementType); `apps/api/src/features/expenses/` — createIncomeWithSavings + `$transaction`, createMovement explicit type

## Phase 5: Telegram Flow

- [x] 5.1 RED: parser tests — parseSavingsOverride after parseSharedPrefix (sin ahorro → disabled; con 5% → percent; con 150% → error, no movement); stripped pre-parser/brain; persisted in payload
- [x] 5.2 RED: command tests — "registrar ahorro: <palabra> al <X>%" upserts + confirms; invalid % → rejected; unrecognized falls through
- [x] 5.3 RED: tail tests — INCOME + rule → net-INCOME + SAVINGS one transaction; reply facts gross/net/savings; SHARED inheritance; no-rule whole
- [x] 5.4 RED: brain tests — envelope decodes create_savings_rule + redirects; reply gains gross/net/savings facts; savings query answers 150 real data, failure → honest redirect
- [x] 5.5 GREEN: edit `apps/api/src/features/telegram/` — parser, commands, tails, bot-brain prompt/envelope, query executor/reply-text, ExecutionResult facts, RecentMovementResult SAVINGS "ahorro"
- [x] 5.6 Goldens: regenerate 8 pinned `__goldens__/` snapshots in the same commit as prompt edits — contracts build + vitest run -u

## Phase 6: Wiring + Dashboard

- [x] 6.1 GREEN: wire savingsService in `apps/api/src/app.ts`
- [x] 6.2 RED: dashboard tests — "Ahorrado" card $150/$0 es-AR; SAVINGS row "Ahorro" label + badge; filter option "Ahorro"
- [x] 6.3 GREEN: edit `apps/dashboard/src/features/movements/` — KpiCards "Ahorrado" only, MovementList label/badge, MovementFilters option; `infra/api.ts` if needed

## Phase 7: Verification

- [x] 7.1 Full suite — contracts build + api test + dashboard test + typecheck/lint; walk the 6 proposal success criteria