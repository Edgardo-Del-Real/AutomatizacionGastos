# Apply Progress — Complete Dashboard with Income Tracking (F1–F4 Complete)

- Change: `2026-08-19-dashboard-complete`
- Batch: PR slice 3 — Phase 3 (F3) Webhook Income Classification (tasks 3.1, 3.2, 3.3)
- Artifact store: openspec (file-based)
- Mode: **Strict TDD** (RED → GREEN → REFACTOR)
- Delivery strategy: auto-chain, stacked-to-main (batch kept autonomous; no push / no PR — orchestrator handles delivery)

## Task Progress

Phase 1 (1.1–1.4): done (prior batch). Phase 2 (2.1–2.4): done (prior batch). Phase 3 (3.1–3.3): **done this batch**.

- [x] 3.1 (RED) — `webhook.parser.test.ts`: keyword, `+` prefix, default EXPENSE, conservative.
- [x] 3.2 (GREEN) — `classifyMovementType(body)` pure function in `webhook.parser.ts`.
- [x] 3.3 — `webhook.service.test.ts` type persisted + dedupe/signature intact; `type` wired into `createExpense` in `webhook.service.ts`.

Phase 4 (4.1–4.7): NOT in scope for this batch — left unchecked.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `apps/api/src/features/webhook/webhook.parser.test.ts` | Unit | ✅ 12/12 | ✅ Written → 6 failed (`classifyMovementType is not a function`) | ✅ Passed (18/18) | ✅ 6 cases | ➖ None needed (pure fn) |
| 3.2 | `apps/api/src/features/webhook/webhook.parser.ts` | Unit | N/A (same cycle as 3.1) | ✅ (import target existed from 3.1) | ✅ Passed (18/18) | ✅ 6 cases | ➖ None needed |
| 3.3 | `apps/api/src/features/webhook/webhook.service.test.ts` | Unit | ✅ 9/9 (pre-existing) | ✅ Written → 3 failed (`type` not passed) | ✅ Passed (12/12) | ✅ 3 cases (INCOME keyword, `+` prefix, EXPENSE default) | ✅ expenses.slice persisted type w/ `?? "EXPENSE"` default |

### Test Summary
- **Total tests written**: 9 (6 parser classification + 3 service type-persistence)
- **Total tests passing**: all F3 unit tests green — parser 18, service 12, expenses.service 16 (43 across the 3 focused files)
- **Layers used**: Unit (43). Integration/E2E unavailable this batch (DB down — see Work Unit Evidence).
- **Approval tests**: None needed (no behavior-refactor of existing logic; added additive behavior).
- **Pure functions created**: 1 (`classifyMovementType`).

## Work Unit Evidence

| Evidence | Required value | Result |
|---|---|---|
| Focused test command and exact result | Smallest command proving this unit | `pnpm exec vitest run src/features/webhook/webhook.parser.test.ts src/features/webhook/webhook.service.test.ts src/features/expenses/expenses.service.test.ts` → **3 files passed, 43 tests passed, 0 failed** |
| Runtime harness command/scenario and exact result | Real integration/runtime path | `pnpm --filter @rita/api test` (Fastify `app.inject` + `migrate deploy` on `automatizacionrita_test`) → **63 unit/integration tests passed, 35 skipped** — the 35 skipped are the 3 DB-backed route suites (movements/expenses/webhook) whose `beforeAll` `prisma migrate deploy` fails with `P1001: Can't reach database server at localhost:5433`. **Infrastructure block**: Docker engine daemon unreachable (`com.docker.service` stopped, cannot start without admin; Docker Desktop engine pipe missing) and native PostgreSQL 18 on :5432 rejects known credentials (`Authentication failed`). No runtime harness result obtainable this session; requires DB up. |
| Rollback boundary | Exact files/behavior reverted without unrelated work | Revert commits `d7231eb`, `0a2dff4`, `b866b1e`, `c9fdfb2` (`webhook.parser.ts`, `webhook.parser.test.ts`, `webhook.service.ts`, `webhook.service.test.ts`, `expenses.service.ts`, `expenses.repository.ts`, `expenses.types.ts`). No migration/schema change in F3; `/expenses*` response shape unchanged (mapper still omits `type`). |

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `apps/api/src/features/webhook/webhook.parser.test.ts` | Modified | Added `classifyMovementType` cases: keyword, case-insensitive keyword, `+` prefix, default EXPENSE, conservative x2. |
| `apps/api/src/features/webhook/webhook.parser.ts` | Modified | Added pure `classifyMovementType(body)` returning `INCOME`/`EXPENSE`; conservative word-boundary keyword regex (`ingreso\|cobro\|sueldo\|venta\|recibí\|depósito`) + `+\s*\d` prefix check; default EXPENSE. |
| `apps/api/src/features/webhook/webhook.service.test.ts` | Modified | Added type-persistence assertions (INCOME keyword, INCOME `+`-prefix, EXPENSE default); dedupe + signature tests intact. |
| `apps/api/src/features/webhook/webhook.service.ts` | Modified | Imported `classifyMovementType`; passes classified `type` into `createExpense`. |
| `apps/api/src/features/expenses/expenses.service.ts` | Modified | `createExpense` validates via `createMovementSchema` (createExpenseSchema + optional `type`) so `type` forwards. |
| `apps/api/src/features/expenses/expenses.repository.ts` | Modified | `create` persists `type: data.type ?? "EXPENSE"` (default preserved). |
| `apps/api/src/features/expenses/expenses.types.ts` | Modified | `NewExpense = CreateMovementInput & { ownerId }` (accepts optional `type`). |
| `openspec/changes/2026-08-19-dashboard-complete/tasks.md` | Modified | Marked 3.1, 3.2, 3.3 `[x]`. |

## Deviations from Design

- **Supporting edit beyond the strict task file list**: design decision #6 and the File Changes table mandate `expenses/{service,repository}.ts` "create accepts optional `type`" and `ExpenseService.createExpense({…, type}) → Prisma → Expense(type)`. Task 3.3 only named `webhook.service.ts`, but persisting the classified `type` (an explicit 3.3 criterion) requires `ExpenseService`/repository to accept and forward it. Made the minimal 3 supporting edits (service → `createMovementSchema`, repository default `?? "EXPENSE"`, `NewExpense` type) so INCOME actually persists; all `expenses` unit/route-contract behavior preserved (mapper still omits `type`; `/expenses` POST without `type` defaults EXPENSE).
- No other deviations. Design otherwise followed.

## Issues Found

- **Infrastructure**: Docker engine unreachable (engine pipe missing; `com.docker.service` stopped and can't be started without admin elevation) and native Postgres 18 credentials unavailable. DB-backed route suites (movements/expenses/webhook) could not execute → `API test green` runtime verification deferred to a DB-available environment (sdd-verify). All F3 unit tests and typecheck are green; these are infra blocks, not test failures.

## Remaining Tasks (Phase 4 — next batch, NOT this batch)

- [ ] 4.1 `formatARS(n)` via `Intl.NumberFormat("es-AR", { style: "currency" })`
- [ ] 4.2 `fetchMovementSummary` + `fetchMovements` in `infra/api.ts`; drop `fetchExpenses`/`fetchSummary`
- [ ] 4.3 `momPercent`, `dailyAverage` in `features/movements/calculations.ts`
- [ ] 4.4 `useMovementSummary` / `useMovements` hooks
- [ ] 4.5 Movement components (DashboardOverview, KpiCards, MomChart, DailyChart, CategoryBreakdown, TopMovements, MovementList, MovementFilters)
- [ ] 4.6 Delete `features/{metrics,expenses}`; rewrite `App.tsx`
- [ ] 4.7 `App.test.tsx` full-section test

## Workload / PR Boundary

- Mode: chained PR slice 3 of 4 (F3 webhook), stacked-to-main, autonomous.
- Current work unit: F3 webhook income classification.
- Boundary: starts after F2 (`/movements` API) and ends with webhook classification + persistence; does not touch `apps/dashboard/`.
- Estimated review budget impact: ~90 authored changed lines (tests + code), well under the 400-line guard for this slice.
- Commits created (branch `feat/dashboard-complete-f1-model-contracts`, NOT pushed):
  - `d7231eb` test(api): add webhook movement classification cases
  - `0a2dff4` feat(api): classify webhook movement type
  - `b866b1e` test(api): assert webhook persists movement type
  - `c9fdfb2` feat(api): persist webhook movement type
  - `83a8738` docs(openspec): mark dashboard-complete phase 3 tasks complete

## Status

11/18 tasks complete (F1, F2, F3 done). Ready for apply of the next batch (F4 — dashboard) once orchestrator launches it; sdd-verify remains blocked until F4 completes and a DB-backed runtime is available.

---

# Phase 4 (F4) — Dashboard Rebuild (this batch, tasks 4.1–4.7)

## Task Progress (F4)

- [x] 4.1 — `formatARS(n)` in `infra/currency.ts` via `Intl.NumberFormat("es-AR", { style: "currency" })`.
- [x] 4.2 — `fetchMovementSummary` + `fetchMovements` (query params + contract validation) in `infra/api.ts`; dropped `fetchExpenses`/`fetchSummary`.
- [x] 4.3 — `momPercent`, `dailyAverage` in `features/movements/calculations.ts`.
- [x] 4.4 — `useMovementSummary` / `useMovements` hooks (refetch on filter change) + shared `AsyncState`.
- [x] 4.5 — `DashboardOverview`, `KpiCards`, `MomChart`, `DailyChart`, `CategoryBreakdown`, `TopMovements`, `MovementList`, `MovementFilters` (Spanish, es-AR, loading/error+retry/empty, combined filters + reset).
- [x] 4.6 — Deleted `features/{metrics,expenses}/`; rewrote `App.tsx` with Spanish header + section order.
- [x] 4.7 — `App.test.tsx`: all sections in order, Spanish, es-AR, empty/error+retry, malformed → error (no crash/partial).

## TDD Cycle Evidence (F4)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 | `infra/currency.test.ts` | Unit | N/A (new) | ✅ Written → module not found | ✅ Passed (5/5) | ✅ 5 cases | ➖ None needed |
| 4.2 | `infra/api.test.ts` | Unit | ✅ baseline (full suite 47) | ✅ Written → 9 failed (not a function) | ✅ Passed (9/9) | ✅ 9 cases | ✅ `request()` generalized to query params |
| 4.3 | `features/movements/calculations.test.ts` | Unit | N/A (new) | ✅ Written → module not found | ✅ Passed (8/8) | ✅ 8 cases | ➖ None needed (pure fns) |
| 4.4 | `useMovementSummary.test.tsx`, `useMovements.test.tsx` | Integration (renderHook) | N/A (new) | ✅ Written → module not found | ✅ Passed (7/7) | ✅ 7 cases | ✅ Fixed unstable filters dep (see Issues) |
| 4.5 | 8 component test files | Integration (RTL) | N/A (new) | ✅ Written → 8 files failed (import missing) | ✅ Passed (22/22) | ✅ 22 cases | ✅ Multiple (see Issues) |
| 4.6 | (refactor) | — | typecheck+lint baseline green | ➖ N/A (no new behavior test) | ✅ typecheck + lint green | ➖ | ✅ Deleted obsolete features + old App.test |
| 4.7 | `App.test.tsx` | Integration (RTL) | N/A (rewrite) | ✅ Written | ✅ Passed (4/4) | ✅ 4 scenarios | ➖ None needed |

### Test Summary (F4)
- **Total tests written this batch**: 55 (currency 5, api 9, calculations 8, hooks 7, components 22, App 4)
- **Full dashboard suite**: `pnpm --filter @rita/dashboard test` → **15 files, 57 tests, 0 failed**
- **Layers used**: Unit (22), Integration/RTL (35)
- **Approval tests**: old `App.test.tsx` (approval of metrics/expenses UI) replaced by movement-dashboard acceptance
- **Pure functions created**: 3 (`formatARS`, `momPercent`, `dailyAverage`)

## Work Unit Evidence (F4)

| Evidence | Required value | Result |
|---|---|---|
| Focused test command and exact result | Smallest command proving this unit | `pnpm --filter @rita/dashboard test` → **15 files passed, 57 tests passed, 0 failed** (full dashboard suite incl. contracts build prefix) |
| Runtime harness command/scenario and exact result | Real integration/runtime path | **N/A for this pure-frontend slice, with reason**: no backend/runtime boundary in this batch — every data flow is mocked via `vi.mock(".../infra/api")` and the runtime harness is RTL + jsdom rendering (per tasks.md work unit 4). Real `fetch` against `:3000` is intentionally not exercised; contract validation is proven by mocked fetch + zod in `infra/api.test.ts`. |
| Rollback boundary | Exact files/behavior reverted without unrelated work | Revert F4 commits (below) → restores `features/{metrics,expenses}/`, old `App.tsx`, old `App.test.tsx`, old `infra/{api,currency}.ts`. F4 touches only `apps/dashboard/`; no API/schema change in this slice. |

## Files Changed (F4)

| File | Action | What Was Done |
|------|--------|---------------|
| `apps/dashboard/src/infra/currency.ts` + `.test.ts` | Create | `formatARS(n)` es-AR currency formatter + tests. |
| `apps/dashboard/src/infra/api.ts` + `.test.ts` | Modify | `request()` query-param support; `fetchMovementSummary`, `fetchMovements`; dropped `fetchExpenses`/`fetchSummary`. |
| `apps/dashboard/src/features/movements/{calculations,asyncState,useMovementSummary,useMovements}.ts` + tests | Create | Pure calcs, shared AsyncState, data hooks (refetch on filter change). |
| `apps/dashboard/src/features/movements/{DashboardOverview,KpiCards,MomChart,DailyChart,CategoryBreakdown,TopMovements,MovementList,MovementFilters}.tsx` + tests | Create | Full Spanish/es-AR dashboard components with loading/error+retry/empty states and combined filters + reset. |
| `apps/dashboard/src/App.tsx` | Rewrite | Spanish header + section order (KPI → MoM → daily → categories → top → list). |
| `apps/dashboard/src/App.test.tsx` | Rewrite | Full-dashboard acceptance: order, Spanish, es-AR, empty/error+retry, malformed → error. |
| `apps/dashboard/src/features/{metrics,expenses}/` | Delete | Replaced by `features/movements/`. |
| `openspec/changes/2026-08-19-dashboard-complete/tasks.md` | Modify | Marked 4.1–4.7 `[x]` (all 18 tasks now complete). |

## Deviations from Design (F4)

- None material. Design decision #8 followed (es-AR formatter + pure front helpers + Spanish inline JSX).
- Supporting nuance (task 4.4 "refetch on filter change"): `useMovements` depends on a serialized `filtersKey` (`JSON.stringify(filters)`) rather than the raw `filters` object, to avoid an effect loop when a caller passes a freshly-allocated object each render. This preserves the required behavior while keeping the hook robust.
- `avgPerMovement` semantics flag (orchestrator note): the API computes `avgPerMovement` as `(income + expenses) / count` (average transaction size). The chosen KPI label "Promedio por movimiento" is accurate — no disambiguation change needed in `KpiCards`.

## Issues Found (F4)

- **Real bug caught by the RED test (4.4)**: `useMovements` initially listed the raw `filters` object in the `useEffect` deps; the default-param `filters = {}` allocates a new object each render → infinite effect loop → vitest worker heap OOM (4 GB). Fixed by depending on a serialized `filtersKey`. Genuine design flaw surfaced via TDD, not an infra-only issue.
- **jsdom date-input limitation**: `userEvent.type` cannot set `<input type="date">` in jsdom; used `fireEvent.change` with an explicit value string (documented in the test).
- **getByText NBSP**: es-AR `Intl` emits U+00A0 (non-breaking space); `getByText` normalizes DOM NBSP to a space but does not normalize the matcher string, so tests match with a regular space. Production output verified correct.
- **Duplicate text matches** in fixtures (e.g. Gastos == Balance amount, "Tipo" as both filter label and table column) → used `getAllByText` / `within(table)`.
- **Infra note**: intermittent vitest worker heap OOM under environment memory pressure when running many files together; resolved by the hooks dep fix and by running focused files (full suite still green 57/57).

## Remaining Tasks

- None — all 18 tasks (F1–F4) complete. Ready for `sdd-verify`.

## Workload / PR Boundary (F4)

- Mode: chained PR slice 4 of 4 (F4 dashboard), stacked-to-main, autonomous.
- Current work unit: F4 dashboard rebuild.
- Boundary: starts after F3 (webhook) and ends with the complete Spanish/es-AR dashboard; touches only `apps/dashboard/`.
- Estimated review budget impact: ~1,500 authored changed lines (tests + code + deletions), consistent with the F4 forecast in tasks.md.
- Commits created (branch `feat/dashboard-complete-f1-model-contracts`, NOT pushed):
  - `dcce4a3` test(dashboard): add formatARS cases
  - `5a90159` feat(dashboard): format ARS amounts
  - `8f9eb5c` test(dashboard): add movement api client tests
  - `c887021` feat(dashboard): add movement api client
  - `4d54b3c` feat(dashboard): add movement calculations and tests
  - `6eb4bea` test(dashboard): add movement data hooks tests
  - `d6fc179` feat(dashboard): add movement data hooks
  - `cc20f8e` feat(dashboard): add movement summary and filter components
  - `a67c31b` feat(dashboard): add dashboard overview and movement list components
  - `468d65f` refactor(dashboard): replace metrics/expenses with movements features
  - `b021155` test(dashboard): add full dashboard App integration tests

## Status (F4)

18/18 tasks complete (F1, F2, F3, F4 done). Full dashboard suite green (57 tests) + typecheck + lint clean. The dashboard slice has no DB dependency; `sdd-verify` can run its API regression with the DB if available (see F3 infra note for the DB infra caveat).
