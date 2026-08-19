# Apply Progress — Complete Dashboard with Income Tracking (F3 Webhook)

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
