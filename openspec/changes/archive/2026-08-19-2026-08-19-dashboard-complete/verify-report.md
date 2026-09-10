```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:6a7a9d8363b6da8502ac393f9552013c98a3bfb1396856ab6ad15b611b5d1076
verdict: pass
blockers: 0
critical_findings: 0
requirements: 11/11
scenarios: 29/29
test_command: pnpm --filter @rita/api test
test_exit_code: 0
test_output_hash: sha256:0d869f5d62feb9fbac951ecf3ecd9266e962d453d5fc69bf1c4093eb59dcdef0
build_command: pnpm --filter @rita/api build
build_exit_code: 0
build_output_hash: sha256:39f890499029f7010f09b1717c60468d0bac4dd9b9926601a8944b34353500e6
```

# Verification Report — Complete Dashboard with Income Tracking

**Change**: `2026-08-19-dashboard-complete`
**Version**: N/A (delta specs, not versioned)
**Mode**: Strict TDD (per `openspec/config.yaml` `testing.strict_tdd: true`)
**Artifact store**: openspec (file-based)
**Scope**: Final verification of the whole change (F1 model+contracts, F2 `/movements` API, F3 webhook classification, F4 dashboard) against proposal, both delta specs, design, and task completion (18/18). Read-only — no production code modified.

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 18 |
| Tasks complete | 18 |
| Tasks incomplete | 0 |
| Requirements (from actual specs) | 11 |
| Scenarios (from actual specs) | 29 |

Requirements breakdown: `money-movements/spec.md` = 6 requirements / 16 scenarios; `dashboard-web/spec.md` = 5 MODIFIED requirements / 13 scenarios.

## Build & Tests Execution

**Test gate — API suite**: ✅ 98 passed / 0 failed / 0 skipped
```text
pnpm --filter @rita/api test  (prefix: pnpm --filter @rita/contracts build)
Test Files  8 passed (8)
Tests       98 passed (98)
Duration    28.25s
exit 0
```
DB-backed route suites (movements/expenses/webhook) ran against live Postgres `rita-postgres` on localhost:5433 with `migrate deploy` on `automatizacionrita_test` in `beforeAll`. No cold-run flakes observed.

**Test gate — Dashboard suite**: ✅ 57 passed / 0 failed / 0 skipped
```text
pnpm --filter @rita/dashboard test  (prefix: contracts build)
Test Files  15 passed (15)
Tests       57 passed (57)
Duration    62.71s
exit 0
```

**Typecheck gate**: ✅ clean
- `pnpm --filter @rita/api typecheck` → exit 0
- `pnpm --filter @rita/dashboard typecheck` → exit 0

**Lint gate**: ✅ clean
- `pnpm --filter @rita/dashboard lint` → exit 0
- `pnpm --filter @rita/api lint` → exit 0

**Build gate**: ✅ clean
- `pnpm --filter @rita/contracts build` → exit 0 (also runs as prefix of both test commands)

**Coverage**: ➖ Not available — no coverage provider installed (`coverage.available: false` in `openspec/config.yaml`). Not a failure.

## Spec Compliance Matrix

### money-movements (6 requirements / 16 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Movement Type Model | Migration preserves existing rows | `apps/api/prisma/migrations/20260819162408_add_movement_type/migration.sql` (`type` `NOT NULL DEFAULT 'EXPENSE'`) + `migrate deploy` in `beforeAll` | ✅ COMPLIANT |
| Movement Type Model | Default on creation | `packages/contracts/src/index.test.ts` > createMovementSchema "accepts a payload without an explicit type"; `expenses.route.test.ts` POST default | ✅ COMPLIANT |
| Movement Contracts | Type validation | `packages/contracts/src/index.test.ts` > "parses a payload with type INCOME" / "rejects an unknown movement type" (SAVINGS) | ✅ COMPLIANT |
| Movement Contracts | Expense contracts unchanged | `packages/contracts/src/index.test.ts` > "expenseSchema family (unchanged)"; `expenses.route.test.ts` `expenseSummarySchema` | ✅ COMPLIANT |
| Webhook Income Detection | Keyword match | `webhook.parser.test.ts` "classifies a message with an income keyword as INCOME"; `webhook.service.test.ts` persists INCOME | ✅ COMPLIANT |
| Webhook Income Detection | Plus-prefixed amount | `webhook.parser.test.ts` "classifies a plus-prefixed amount as INCOME"; `webhook.service.test.ts` | ✅ COMPLIANT |
| Webhook Income Detection | No signal defaults to expense | `webhook.parser.test.ts` "defaults a plain expense message to EXPENSE"; `webhook.service.test.ts` | ✅ COMPLIANT |
| Webhook Income Detection | Ambiguous message is conservative | `webhook.parser.test.ts` "is conservative and defaults a message with money but no income signal to EXPENSE" | ✅ COMPLIANT |
| Movement List Endpoint | Combined filters | `movements.route.test.ts` "returns matching movements for combined filters, newest first" | ✅ COMPLIANT |
| Movement List Endpoint | No matches | `movements.route.test.ts` "returns an empty array when filters match nothing" (200) | ✅ COMPLIANT |
| Movement Summary Endpoint | ARS-only totals | `movements.route.test.ts` "totals only ARS movements" (USD excluded) | ✅ COMPLIANT |
| Movement Summary Endpoint | Buenos Aires bucketing | `movements.route.test.ts` "buckets movements to the Buenos Aires month" (`2026-08-01T02:59Z` → July) | ✅ COMPLIANT |
| Movement Summary Endpoint | No data | `movements.route.test.ts` "returns zero-filled kpis/daily and empty categories for no data" | ✅ COMPLIANT |
| Movement Summary Endpoint | Month comparison | `movements.route.test.ts` "returns month-over-month income, expenses and balance" | ✅ COMPLIANT |
| Expense Retrocompatibility | Income excluded from expenses | `expenses.route.test.ts` "excludes INCOME movements from the expense list" | ✅ COMPLIANT |
| Expense Retrocompatibility | Expense summary unchanged | `expenses.route.test.ts` "summary response matches expenseSummarySchema and excludes INCOME" | ✅ COMPLIANT |

### dashboard-web (5 MODIFIED requirements / 13 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Metrics Overview | Full dashboard | `App.test.tsx` "renders every section in order with Spanish labels and es-AR amounts"; `DashboardOverview.test.tsx` | ✅ COMPLIANT |
| Metrics Overview | Month-over-month delta | `MomChart.test.tsx` "shows the percentage change between consecutive months" | ✅ COMPLIANT |
| Metrics Overview | Empty summary | `App.test.tsx` "shows a Spanish empty state"; `DashboardOverview.test.tsx` | ✅ COMPLIANT |
| Movement List | Render movements | `MovementList.test.tsx` "renders the table with Spanish headers, type column, and es-AR amounts" | ✅ COMPLIANT |
| Movement List | Empty or unknown owner | `MovementList.test.tsx` "shows a Spanish empty state when there are no movements" | ✅ COMPLIANT |
| Movement Filters | Combined filter | `MovementFilters.test.tsx` "combines type, date range, category, and note text"; `MovementList.test.tsx` re-query | ✅ COMPLIANT |
| Movement Filters | No matches | `MovementList.test.tsx` empty state (not an error) | ✅ COMPLIANT |
| Movement Filters | Reset | `MovementFilters.test.tsx` "reset clears all active filters"; `MovementList.test.tsx` reset | ✅ COMPLIANT |
| Loading, Error and Empty States | Loading | `MovementList.test.tsx` / `DashboardOverview.test.tsx` "shows a Spanish loading state" | ✅ COMPLIANT |
| Loading, Error and Empty States | Failure and retry | `MovementList` / `DashboardOverview` / `App.test.tsx` error+retry+recover | ✅ COMPLIANT |
| Loading, Error and Empty States | Empty section | `MovementList` / `DashboardOverview` / `TopMovements` / `CategoryBreakdown` empty-state tests | ✅ COMPLIANT |
| Response Validation | Valid responses | `api.test.ts` "resolves validated summary data"; `App.test.tsx` | ✅ COMPLIANT |
| Response Validation | Malformed response | `api.test.ts` validation ApiError; `App.test.tsx` "surfaces an error state for a malformed summary" | ✅ COMPLIANT |

**Compliance summary**: 29/29 scenarios compliant (16 money-movements + 13 dashboard-web).

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Movement Type Model | ✅ Implemented | `MovementType` enum + `type` field default EXPENSE in `schema.prisma`; migration `20260819162408_add_movement_type`; table/model not renamed |
| Movement Contracts | ✅ Implemented | `movementTypeSchema`, `movementSchema`, `listMovementsSchema`, `movementFiltersSchema`, `movementSummarySchema`, `createMovementSchema` exported; expense family unchanged |
| Webhook Income Detection | ✅ Implemented | `classifyMovementType(body)` pure fn in `webhook.parser.ts`; wired into `webhook.service.ts`; type persists |
| Movement List Endpoint | ✅ Implemented | `GET /movements` in `features/movements/`; filters type/from/to/category/q; ordered occurredAt DESC |
| Movement Summary Endpoint | ✅ Implemented | `GET /movements/summary`; ARS-only totals; BA-tz bucketing; kpis/mom/daily/categories/top |
| Expense Retrocompatibility | ✅ Implemented | `/expenses*` scoped to `type=EXPENSE`; mapper omits `type`; `expenseSummarySchema` unchanged |
| Dashboard (es-AR Spanish UI) | ✅ Implemented | `formatARS`, movement hooks/components, single-scroll section order, Spanish strings, loading/error/empty states, server-side filters + reset |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| One-table model (enum + default EXPENSE) | ✅ Yes | `NOT NULL DEFAULT 'EXPENSE'`, no backfill |
| Contracts additive (movementSchema = expenseSchema.extend) | ✅ Yes | Expense family untouched |
| New `features/movements/` slice; `/expenses*` scoped to EXPENSE | ✅ Yes | Verified by retrocompat route tests |
| AR bucketing via double `AT TIME ZONE` cast | ✅ Yes | Verified by BA-bucketing route test (`2026-08-01T02:59Z` → July) |
| Pure `classifyMovementType` in parser | ✅ Yes | Unit-testable, 6 cases |
| Repository per facet, service composes; ARS-only; top limited to 5 | ✅ Yes | kpis/months/daily/categories/top |
| Dashboard slice + es-AR formatter + pure front helpers | ✅ Yes | `formatARS`, `momPercent`, `dailyAverage`; `useMovements` filter-refetch via serialized key |

## Strict TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | TDD Cycle Evidence table present in `apply-progress.md` (F1–F4) |
| All tasks have tests | ✅ | 18/18 tasks reference test files; all files exist |
| RED confirmed (tests exist) | ✅ | All referenced test files verified present in the repo |
| GREEN confirmed (tests pass) | ✅ | 98 API + 57 dashboard tests pass on execution |
| Triangulation adequate | ✅ | parser 6 cases, service 3 type-persistence, contracts multiple, components 22, calculations 8 |
| Safety Net for modified files | ✅ | New files marked `N/A (new)` correct; modified files (api.test, webhook tests, expenses.route.test, contracts test) ran baseline |

**TDD Compliance**: 6/6 checks passed.

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | API (parser/service/contracts/calcs/currency) + Dashboard pure fns | 9 | vitest (node env) |
| Integration | API route tests (DB) + Dashboard RTL (hooks/components/App) | 14 | Fastify `app.inject` + Prisma / RTL + jsdom |
| E2E | — | — | Unavailable (per capabilities) |
| **Total** | **155** | **23** | |

Counts: API 98 (8 files) + Dashboard 57 (15 files).

## Changed File Coverage

**Coverage analysis skipped — no coverage tool detected** (per `openspec/config.yaml` `coverage.available: false`). Not a failure.

## Assertion Quality

**Assertion quality**: ✅ All assertions verify real behavior.
- No tautologies, ghost loops, smoke-only tests, or type-only assertions found across all reviewed test files.
- `if (state.status === "success"|"error")` narrowing in hook tests is always paired with a concrete value assertion (`data.kpis.balance`, `data.toHaveLength(2)`, `error.kind`).
- es-AR NBSP (U+00A0) handled explicitly in `currency.test.ts` and DOM-normalization notes in apply-progress.

## Issues Found

**CRITICAL**: None.

**WARNING**: None.

**SUGGESTION**:
1. Changed-line budget: actual diff totals 4,057 insertions + 1,206 deletions (≈5,263 total changed lines) versus the ~3,500–4,000 forecast in `tasks.md`. Delivered via the designed 4-phase auto-chain (stacked-to-main), so per-PR review budget was respected by slicing, but the aggregate exceeds the top of the forecast. Informational for future planning; not a spec defect.
2. Scenario "Migration preserves existing rows" has no dedicated runtime test; it is enforced by the migration's `NOT NULL DEFAULT 'EXPENSE'` and verified by the successful `migrate deploy` in every DB route suite's `beforeAll`. Semantic guarantee is sound; a dedicated regression test (pre-existing row retains EXPENSE) would harden it. Informational.

## Verdict

**PASS**

All 7 verification gates green (API 98, Dashboard 57, typechecks, lints, contracts build); all 11 requirements and all 29 scenarios compliant with a passing covering test (or, for the migration-preserves-rows case, enforced by migration semantics + green `migrate deploy`); design followed; 18/18 tasks complete. No CRITICAL or WARNING findings. SUGGESTION-level notes only.


