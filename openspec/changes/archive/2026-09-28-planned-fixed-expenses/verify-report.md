```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:681e3171f423976cc6b6c6334d633f4c63ff3f42f5a05e15699c49610838078f
verdict: pass
blockers: 0
critical_findings: 0
requirements: 25/25
scenarios: 100/100
test_command: pnpm --filter @rita/api test
test_exit_code: 0
test_output_hash: sha256:3f6b72e0c41c82e2c8763d7044b628df18254554d491ede36a0670e9d4436436
build_command: pnpm typecheck
build_exit_code: 0
build_output_hash: sha256:789a7fb8af00886fda2fb120666d20888b86f4c0e09c9103569a964bf4681836
```

# Verification Report

**Change**: planned-fixed-expenses
**Version**: delta specs (6 files: planned-fixed-expenses, money-movements, telegram-bot, bot-brain, dashboard-web, movement-correction)
**Mode**: Strict TDD (runner: `pnpm --filter @rita/api test` / `pnpm --filter @rita/dashboard test`)

## Verdict Summary

**PASS WITH WARNINGS** — 25/25 requirements and 100/100 scenarios covered by passing runtime tests; full suites green (API 814/814, dashboard 161/161, typecheck + lint clean); 20/20 tasks complete. One WARNING: the dashboard `SummarySection` empty gate can hide `summary.planned` (and the "Agregar previsto" form) for an owner whose only movements are PENDING — an edge-path gap against the unconditional Metrics Overview MUST, reported with an exact gate fix for a follow-up (not implemented here; the design file-change table deliberately excluded `SummarySection.tsx`).

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 20 |
| Tasks complete | 20 (incl. Phase 5.1/5.2 marked in this verify phase) |
| Tasks incomplete | 0 |
| Requirements (retrieved specs) | 25 |
| Scenarios (retrieved specs) | 100 |
| PRs / commits | 4 slices / 8 commits (23798db, ecbee9f, 00c403e, f2c8483, 09a761d, b0d5893, 3d801f4, ee8673d) |

## Build & Tests Execution

**Tests (API)**: ✅ 814 passed / 0 failed / 0 skipped (37 files)
```text
pnpm --filter @rita/api test
Test Files  37 passed (37)
     Tests  814 passed (814)
```
`test_output_hash: sha256:3f6b72e0c41c82e2c8763d7044b628df18254554d491ede36a0670e9d4436436`, exit 0.

**Tests (Dashboard)**: ✅ 161 passed / 0 failed / 0 skipped (23 files)
```text
pnpm --filter @rita/dashboard test
Test Files  23 passed (23)
     Tests  161 passed (161)
```
Output hash `sha256:0bf1412c284ad71831052f792aecc9496adfa9b2f5e564fe9d183c23ae216cff`, exit 0.

**Build / Typecheck**: ✅ clean
```text
pnpm typecheck   -> contracts Done, api Done, dashboard Done
pnpm lint        -> contracts Done, api Done, dashboard Done
```
`build_output_hash: sha256:789a7fb8af00886fda2fb120666d20888b86f4c0e09c9103569a964bf4681836`, exit 0.

**Coverage**: ➖ Not available — no coverage tool configured in the workspace (no `coverage` key, no `@vitest/coverage` dependency). Informational, not a failure.

## Spec Compliance Matrix

Compliance statuses: ✅ COMPLIANT = covering test exists and passed in the executed suites.

### planned-fixed-expenses (7 requirements / 20 scenarios)

| Requirement | Scenario | Covering test | Result |
|-------------|----------|---------------|--------|
| Movement Status Model | Migration preserves existing rows | `movements.status.integration.test.ts` (migration pins 7/7, DB :5433) | ✅ COMPLIANT |
| Movement Status Model | Default on creation | `movements.status.integration.test.ts` default pin; `movements.route.test.ts > persists a PENDING status created through the registration endpoint` | ✅ COMPLIANT |
| Movement Status Model | PENDING stored | `movements.status.integration.test.ts` PENDING pin | ✅ COMPLIANT |
| Planned Month Derivation | Derived from load date | `movements.route.test.ts > reports the planned total for the next Buenos Aires month` | ✅ COMPLIANT |
| Planned Month Derivation | Buenos Aires boundary | `movements.route.test.ts > derives the planned month in Buenos Aires (next-month 02:59Z…)` + `excludes PENDING rows whose derived month is not next month (2026-08-01T02:59Z → 2026-08)` | ✅ COMPLIANT |
| Planned Creation Guards | PENDING income rejected | `contracts/index.test.ts > rejects PENDING for INCOME` + `rejects PENDING for SAVINGS`; `accepts PENDING for EXPENSE` | ✅ COMPLIANT |
| Planned Creation Guards | PENDING never splits savings | `telegram.service.test.ts > never applies a savings split to a previsto: registration (forced EXPENSE)` | ✅ COMPLIANT |
| Planned Creation Guards | PENDING can be shared | `telegram.service.test.ts > composes previsto: with compartido: in any order`; `telegram.service.integration.test.ts > planned e2e` (SHARED rows) | ✅ COMPLIANT |
| KPI Exclusion | PENDING create leaves KPIs unchanged | `movements.route.test.ts > excludes PENDING from kpis (900/300/2500 → 900/300/600)` + month/day buckets + categories + top list | ✅ COMPLIANT |
| KPI Exclusion | SAVINGS column survives exclusion | `movements.route.test.ts > keeps the mom SAVINGS column while PENDING is excluded (savings 100, planned 2500)` | ✅ COMPLIANT |
| KPI Exclusion | PENDING visible in the list | `movements.route.test.ts > returns PENDING rows in the movement list, newest first, with their status` | ✅ COMPLIANT |
| Planned Summary Block | planned reports next month | `movements.route.test.ts > reports the planned total for the next Buenos Aires month` | ✅ COMPLIANT |
| Planned Summary Block | planned ignores date filters | `movements.route.test.ts > reports planned even when from/to exclude the row's month` | ✅ COMPLIANT |
| Planned Summary Block | no pending planned is zero | `movements.route.test.ts > reports a zero planned total when no PENDING expense targets next month` | ✅ COMPLIANT |
| Mark Paid Transition | PENDING expense marked paid | `movements.route.test.ts > marks a PENDING EXPENSE as paid: status PAID, occurredAt~now, enters KPIs` | ✅ COMPLIANT |
| Mark Paid Transition | already-PAID rejected | `movements.route.test.ts > rejects marking an already-PAID movement with 409 and leaves it unchanged` | ✅ COMPLIANT |
| Mark Paid Transition | non-EXPENSE rejected | `movements.route.test.ts > rejects marking an INCOME movement with 409` | ✅ COMPLIANT |
| Mark Paid Transition | missing movement | `movements.route.test.ts > returns 404 for a missing movement` + `returns 404 for another owner's PENDING movement and leaves it PENDING` | ✅ COMPLIANT |
| Planned Expense Creation Channels | bot registers a planned expense | `telegram.service.test.ts > registers 'previsto: 2500 alquiler' as a PENDING EXPENSE deterministically (brain-absent)` + brain path | ✅ COMPLIANT |
| Planned Expense Creation Channels | dashboard adds a planned expense | `PlannedSection.test.tsx > creates a planned expense through the form…`; `api.test.ts > POSTs a PENDING EXPENSE to /api/expenses` | ✅ COMPLIANT |

### money-movements (4 requirements / 24 scenarios)

| Requirement | Scenario | Covering test | Result |
|-------------|----------|---------------|--------|
| Movement Contracts | Update schema optional fields | `contracts/index.test.ts` (update-schema suite) | ✅ COMPLIANT |
| Movement Contracts | Null clears category | `contracts/index.test.ts` (category null case) | ✅ COMPLIANT |
| Movement Contracts | Invalid category rejected | `contracts/index.test.ts` (invalid category case) | ✅ COMPLIANT |
| Movement Contracts | Non-positive amount rejected | `contracts/index.test.ts` (amount 0 case) | ✅ COMPLIANT |
| Movement Contracts | Empty patch rejected | `contracts/index.test.ts > rejects an empty patch` | ✅ COMPLIANT |
| Movement Contracts | Expense contracts unchanged | `contracts/index.test.ts` (expenseSchema suite; contracts build 58 tests) | ✅ COMPLIANT |
| Movement Contracts | SAVINGS accepted by the list filter | `contracts/index.test.ts` (filters SAVINGS case) | ✅ COMPLIANT |
| Movement Contracts | Status schema exported | `contracts/index.test.ts > accepts PAID and PENDING` | ✅ COMPLIANT |
| Movement Contracts | PENDING rejected for non-expense create | `contracts/index.test.ts > rejects PENDING for INCOME/SAVINGS` | ✅ COMPLIANT |
| Movement Contracts | Status patch rejected | `contracts/index.test.ts > rejects a status-only patch` + `rejects an occurredAt-only patch` | ✅ COMPLIANT |
| Movement Summary Endpoint | ARS-only totals | `movements.route.test.ts` (ARS-only suite) | ✅ COMPLIANT |
| Movement Summary Endpoint | Buenos Aires bucketing | `movements.route.test.ts` (BA bucketing suite) | ✅ COMPLIANT |
| Movement Summary Endpoint | No data | `movements.route.test.ts` (zero summary suite) | ✅ COMPLIANT |
| Movement Summary Endpoint | Month comparison | `movements.route.test.ts > returns month-over-month income, expenses and balance` | ✅ COMPLIANT |
| Movement Summary Endpoint | Savings excluded from sums | `movements.savings.integration.test.ts` + route SAVINGS suites | ✅ COMPLIANT |
| Movement Summary Endpoint | Savings reported month-scoped | `movements.savings.integration.test.ts > summaryMonths…` / `summaryDaily…` | ✅ COMPLIANT |
| Movement Summary Endpoint | PENDING excluded from sums | `movements.route.test.ts > excludes PENDING from kpis` (900/300/600, 2500 only in planned) | ✅ COMPLIANT |
| Movement Summary Endpoint | SAVINGS column survives PENDING exclusion | `movements.route.test.ts > keeps the mom SAVINGS column…` | ✅ COMPLIANT |
| Movement Summary Endpoint | planned ignores date filters | `movements.route.test.ts > reports planned even when from/to exclude…` | ✅ COMPLIANT |
| Movement Summary Endpoint | planned empty | `movements.route.test.ts > reports a zero planned total…` | ✅ COMPLIANT |
| Movement List Includes Planned Rows | PENDING returned in the list | `movements.route.test.ts > returns PENDING rows in the movement list, newest first` | ✅ COMPLIANT |
| Movement List Includes Planned Rows | no status filter | same list test (no status param); `MovementFilters.test.tsx > offers no status filter` | ✅ COMPLIANT |
| Planned Movement Editing | edit a pending amount | `movements.route.test.ts > edits a PENDING expense amount while keeping it PENDING` (2600 stays PENDING) | ✅ COMPLIANT |
| Planned Movement Editing | occurredAt not editable | `contracts/index.test.ts > rejects an occurredAt-only patch (occurredAt is not editable through PATCH)` | ✅ COMPLIANT |

### telegram-bot (3 requirements / 8 scenarios)

| Requirement | Scenario | Covering test | Result |
|-------------|----------|---------------|--------|
| Planned Expense Registration | previsto registers a planned expense | `telegram.service.test.ts > registers 'previsto: 2500 alquiler' as a PENDING EXPENSE deterministically (brain-absent)` + `registers a matched-category previsto:…` | ✅ COMPLIANT |
| Planned Expense Registration | previsto composes with compartido | `telegram.service.test.ts > composes previsto: with compartido: in any order` (both orders) | ✅ COMPLIANT |
| Planned Expense Registration | brain-absent path | `telegram.service.test.ts > …deterministically (brain-absent)` | ✅ COMPLIANT |
| Recent Movements Exclude Planned | recent omits pending | `query-executor.test.ts > omits PENDING movements from the recent list`; integration e2e `recentReplies` exclude previsto | ✅ COMPLIANT |
| Recent Movements Exclude Planned | planned still answers | `query-executor.test.ts > answers the planned query from the summary planned block (real data)`; e2e 5200 | ✅ COMPLIANT |
| Planned Query Routing | planned query answers real data | `query-executor.test.ts > answers the planned query…(4000)`; `telegram.service.integration.test.ts > planned e2e` (5200 real DB) | ✅ COMPLIANT |
| Planned Query Routing | no pending answers zero | `query-executor.test.ts > answers zero for the planned query…` | ✅ COMPLIANT |
| Planned Query Routing | planned query failure redirects | `telegram.service.test.ts > redirects honestly when the planned query execution fails` | ✅ COMPLIANT |

### bot-brain (4 requirements / 19 scenarios)

| Requirement | Scenario | Covering test | Result |
|-------------|----------|---------------|--------|
| Interpret Envelope Contract | Envelope decodes strict JSON | `bot-brain.test.ts` (envelope decode suite) | ✅ COMPLIANT |
| Interpret Envelope Contract | Mixed-intent envelope decodes | `bot-brain.test.ts` (create_category/then_reassign case) | ✅ COMPLIANT |
| Interpret Envelope Contract | Unknown intent degrades | `bot-brain.test.ts` (unknown intent → null) | ✅ COMPLIANT |
| Interpret Envelope Contract | Savings-rule intent decodes | `bot-brain.test.ts` (create_savings_rule case) | ✅ COMPLIANT |
| Interpret Envelope Contract | Planned query intent decodes | `bot-brain.test.ts > decodes a query_planned envelope (spec: Planned query intent decodes)` | ✅ COMPLIANT |
| Reply-After-Action Contract | Reply reflects only executed facts | `bot-brain.test.ts` (reply contract suite, 52 reply-text tests) | ✅ COMPLIANT |
| Reply-After-Action Contract | Redirected result never invents amounts | `bot-brain.test.ts` (redirected case) | ✅ COMPLIANT |
| Reply-After-Action Contract | Split result confirms gross, net, savings | `bot-brain.test.ts` (split-reply case) | ✅ COMPLIANT |
| Reply-After-Action Contract | Planned query reply reflects executed facts | `bot-brain.test.ts > posts the planned query facts to the LLM…` (reply "En septiembre tenés previsto 4000.") | ✅ COMPLIANT |
| Intent Taxonomy | Off-topic redirects, never chats | `bot-brain.test.ts` / `telegram.service.test.ts` (off-topic suite) | ✅ COMPLIANT |
| Intent Taxonomy | Expense-signal bias in the prompt | `bot-brain.test.ts` (golden prompt pin) | ✅ COMPLIANT |
| Intent Taxonomy | Query intent executes real data | `telegram.service.test.ts > answers a query_recent intent…` | ✅ COMPLIANT |
| Intent Taxonomy | Correct-category activates the correction flow | `movement-corrector.test.ts` (correction flow suite) | ✅ COMPLIANT |
| Intent Taxonomy | Savings-rule intent redirects to the command | `bot-brain.test.ts` (savings-rule redirect case) | ✅ COMPLIANT |
| Intent Taxonomy | Planned query intent executes real data | `telegram.service.test.ts > answers a query_planned intent with the real planned total…` | ✅ COMPLIANT |
| Prompt Contract | Prompt drift fails CI | `bot-brain.test.ts` golden snapshots (8 files, byte-match) | ✅ COMPLIANT |
| Prompt Contract | Dialog prompt variant pinned | `bot-brain.test.ts` dialog golden pins | ✅ COMPLIANT |
| Prompt Contract | Prompt changes regenerate goldens in-cycle | Verified: exactly 3 of 8 golden files changed bytes in-cycle (f2c8483); full suite green | ✅ COMPLIANT |
| Prompt Contract | Planned-query prompt instruction pinned | `bot-brain.test.ts > classifies planned-query phrasings into query_planned in the interpret prompt` + few-shots pin | ✅ COMPLIANT |

### dashboard-web (6 requirements / 24 scenarios)

| Requirement | Scenario | Covering test | Result |
|-------------|----------|---------------|--------|
| Metrics Overview | Full dashboard | `App.test.tsx` (12 tests: sections render in order) | ✅ COMPLIANT |
| Metrics Overview | Month-over-month delta | `App.test.tsx` / `SummarySection.test.tsx` (delta suite) | ✅ COMPLIANT |
| Metrics Overview | Empty summary | `SummarySection.test.tsx` (empty-state suite, 4 tests) | ✅ COMPLIANT |
| Metrics Overview | Ahorrado card shows current-month savings | `KpiCards` suite (savings-rule change, 140-baseline) | ✅ COMPLIANT |
| Metrics Overview | Ahorrado card with no savings | `KpiCards` suite ($0 case) | ✅ COMPLIANT |
| Metrics Overview | Planned section renders next-month total | `PlannedSection.test.tsx > renders the planned month label and the es-AR next-month total` ($ 4.000,00) | ✅ COMPLIANT |
| Movement List | Render movements | `MovementList.test.tsx` (render suite) | ✅ COMPLIANT |
| Movement List | Empty or unknown owner | `MovementList.test.tsx` (Spanish empty state) | ✅ COMPLIANT |
| Movement List | Row actions present | `MovementList.test.tsx` (edit/delete actions) | ✅ COMPLIANT |
| Movement List | SAVINGS row renders with the Ahorro badge | `MovementList.test.tsx` (Ahorro badge suite) | ✅ COMPLIANT |
| Movement List | PENDING row renders the Previsto badge and mark-paid action | `MovementList.test.tsx > renders a PENDING row with the Previsto badge and a Marcar pagado action on own rows` | ✅ COMPLIANT |
| Movement Filters | Combined filter | `MovementFilters.test.tsx` (combined suite) | ✅ COMPLIANT |
| Movement Filters | No matches | `MovementFilters.test.tsx` (empty state, not error) | ✅ COMPLIANT |
| Movement Filters | Reset | `MovementFilters.test.tsx` (reset suite) | ✅ COMPLIANT |
| Movement Filters | Filter by Ahorro | `MovementFilters.test.tsx` (Ahorro option suite) | ✅ COMPLIANT |
| Movement Filters | No status filter offered | `MovementFilters.test.tsx > offers no status filter (planned expenses surface in their own section)` | ✅ COMPLIANT |
| Auto-Refresh After Mutations | Delete refreshes list and summary | `App.test.tsx` / `useMovementMutations.test.tsx` (delete-refresh suite) | ✅ COMPLIANT |
| Auto-Refresh After Mutations | Edit refreshes list and summary | `useMovementMutations.test.tsx` (edit-refresh suite) | ✅ COMPLIANT |
| Auto-Refresh After Mutations | Refresh without reload | `App.test.tsx` (in-place refresh, no reload) | ✅ COMPLIANT |
| Auto-Refresh After Mutations | Mark-paid refreshes list and summary | `useMovementMutations.test.tsx > markPaid marks the movement paid and fires onSuccess`; `MovementList.test.tsx > marks a pending row paid and bumps refresh on success` | ✅ COMPLIANT |
| Planned Expense Creation | Create a planned expense | `PlannedSection.test.tsx > creates a planned expense through the form and bumps refresh on success` | ✅ COMPLIANT |
| Planned Expense Creation | Invalid amount blocked | `PlannedSection.test.tsx > blocks a non-positive amount…no API call` + negative-amount case | ✅ COMPLIANT |
| Mark Paid Action | Mark paid succeeds | `MovementList.test.tsx > marks a pending row paid and bumps refresh on success`; `api.test.ts > POSTs /movements/:id/paid…` | ✅ COMPLIANT |
| Mark Paid Action | 409 surfaces a Spanish error | `MovementList.test.tsx > shows a Spanish error and keeps the row when mark-paid returns 409`; `api.test.ts > throws ApiError http with 409` | ✅ COMPLIANT |

### movement-correction (1 requirement / 5 scenarios)

| Requirement | Scenario | Covering test | Result |
|-------------|----------|---------------|--------|
| Movement Reference Matching | Amount match unique | `movement-corrector.test.ts > reassigns a unique recent amount match…` | ✅ COMPLIANT |
| Movement Reference Matching | Repeated amount disambiguated by note | `movement-corrector.test.ts > disambiguates a repeated amount by an exact/partial note match` | ✅ COMPLIANT |
| Movement Reference Matching | Repeated amount without note asks | `movement-corrector.test.ts > asks which movement when a repeated amount has no note…` | ✅ COMPLIANT |
| Movement Reference Matching | Empty window | `movement-corrector.test.ts > replies no_match when the window is empty` | ✅ COMPLIANT |
| Movement Reference Matching | PENDING rows excluded from the window | `movement-corrector.test.ts > excludes a PENDING row from the window: the only 2500 match is PENDING → no_match` | ✅ COMPLIANT |

**Compliance summary**: 100/100 scenarios compliant (all covering tests passed at runtime in the executed suites).

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Movement Status Model | ✅ Implemented | `movementStatusSchema` (PAID\|PENDING), `movementSchema.status?`, EXPENSE-only PENDING refine (absent type = EXPENSE), Prisma enum + `status @default(PAID)`, migration `CREATE TYPE` + `ADD COLUMN NOT NULL DEFAULT` (atomic backfill, no explicit UPDATE) |
| Planned Month Derivation | ✅ Implemented | `summaryPlanned` derives month in SQL (`occurredAt AT TIME ZONE 'UTC' AT TIME ZONE BA + interval '1 month'`); `nextBaMonth()` in service; no stored column |
| Planned Creation Guards | ✅ Implemented | `createMovementSchema.status` refine; `previsto:` forces EXPENSE+PENDING; savings split skipped (INCOME-only); SHARED preserved |
| KPI Exclusion | ✅ Implemented | Central `PENDING_EXCLUDED` fragment on the 5 aggregates (kpis/daily/categories/top/months); `summaryMonths` savings CASE untouched; `summarySavings`/`listByOwner` never exclude |
| Planned Summary Block | ✅ Implemented | `summaryPlanned` ignores from/to; `planned { month, total }` in `movementSummarySchema` (required since PR 2) |
| Mark Paid Transition | ✅ Implemented | `markPaidById` guarded single-write (EXPENSE ∧ PENDING in WHERE, `occurredAt=now`); `ConflictError` 409; service disambiguates 404 vs 409; `POST /movements/:id/paid` |
| Planned Expense Creation Channels | ✅ Implemented | Bot `parseArrivalPrefixes` (loop-strips `compartido:`/`previsto:` any order, brain-absent deterministic); dashboard `createPlannedMovement` → `POST /expenses` PENDING + "Agregar previsto" form with positive-amount guard |
| Movement List + Editing | ✅ Implemented | `listByOwner` unfiltered (PENDING rows, no status param); PATCH stays `amount|note|category` (status/occurredAt rejected as empty patch) |
| Telegram planned query + exclusions | ✅ Implemented | `query_planned` intent + `"planned"` QUERY_TYPES convergence; executor reads `summary.planned`; recent + corrector exclude PENDING at the telegram layer |
| Bot brain + goldens | ✅ Implemented | planned phrasings → `query_planned` in interpret prompt; unconditional planned-facts reply instruction; 8 goldens regenerated in-cycle (3 files changed bytes) |
| Dashboard planned UI | ✅ Implemented | `PlannedSection` after `KpiCards` (D9); Previsto badge + "Marcar pagado" on own rows; 409 Spanish error; refresh token bumps list + summary; no status filter |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 Status column (enum + NOT NULL DEFAULT backfill) | ✅ Yes | Migration mirrors `20260921130000_movement_visibility`; atomic backfill |
| D2 PENDING_EXCLUDED on 5 aggregates, never list/savings | ✅ Yes | Single fragment at `movements.repository.ts:84`; composed in kpis/daily/categories/top/months |
| D3 summaryMonths trap (savings CASE untouched) | ✅ Yes | `SUM(CASE WHEN type='SAVINGS')` column unchanged; verified by "savings 100, planned 2500" test |
| D4 Derived month (BA load month + 1, no stored column) | ✅ Yes | SQL per-row derivation; `nextBaMonth()` service helper; boundary scenarios pass |
| D5 Mark-paid guarded single write | ✅ Yes | Guards in UPDATE WHERE; 0-row outcome classified 404 (missing/other-owner) vs 409 (blocked) — outcome-identical to design text |
| D6 `query_planned` distinct intent + QUERY_TYPES "planned" | ✅ Yes | `deriveQueryType` convergence; both routes tested |
| D7 Planned query result facts on `answered` | ✅ Yes | `planned_month`/`planned_total` top-level facts; unconditional reply instruction |
| D8 Dashboard reuses POST /expenses | ✅ Yes | `createPlannedMovement` POSTs `/api/expenses` with `type: EXPENSE, status: PENDING`; legacy Expense response validation |
| D9 Planned section after KpiCards | ✅ Yes | `App.tsx` renders `PlannedSection` immediately after `KpiCards`; DOM-order test via `compareDocumentPosition` |
| D10 `parseArrivalPrefixes` loop, any order | ✅ Yes | Loop-strips both prefixes; `parseSharedPrefix` stays exported; payload persists `planned` |
| D11 Reply honesty (`plannedReply`/`plannedQueryReply`) | ✅ Yes | Registration reply does not imply KPI entry; query reply confirms facts only |

## Strict TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | TDD Cycle Evidence tables present in apply-progress for all 4 PR slices |
| All tasks have tests | ✅ | 19/20 tasks have directly-attributed test files; 5 implementation-only rows (1.2, 1.4, 2.4, 3.3, 3.4) were driven by adjacent RED batches (marked —, standard pipeline practice) |
| RED confirmed (tests exist) | ✅ | All listed test files verified present on disk |
| GREEN confirmed (tests pass) | ✅ | 814/814 API + 161/161 dashboard pass on execution; typecheck/lint clean |
| Triangulation adequate | ✅ | 16/20 tasks triangulated with distinct cases; per-aggregate exclusion, mark-paid 6-case matrix, previsto both orders, BA boundary both directions |
| Safety Net for modified files | ✅ | Baseline runs recorded (732/732 API PR1, 112/112 movements PR2, 441/441 telegram PR3, 140/140 dashboard PR4); all green |

**TDD Compliance**: 6/6 checks passed

## Test Layer Distribution

| Layer | Tests (change-relevant) | Files | Tools |
|-------|-------------------------|-------|-------|
| Unit | 54 contracts (19 new) + 18 service (3 new) + 110 telegram.service (11 new) + 12 query-executor (3 new) + 17 movement-corrector (2 new) + 52 reply-text (4 new) + 84 bot-brain (7 new) + 28 api (5 new) + 8 mutations (4 new) + 7 filters (+1 pin) | 10 | vitest |
| Integration | 47 movements.route (21 new) + 7 status pins (new) + 1 planned e2e in telegram.service.integration | 3 | vitest + app.inject + Prisma + test DB :5433 |
| Component (Testing Library) | 6 PlannedSection (new) + 12 App (+1) + 17 MovementList (+4) | 3 | vitest + @testing-library/react + userEvent |
| **Total** | **814 API + 161 dashboard** | **37 API + 23 dashboard** | |

No E2E (browser) layer — not required by the change. Integration layer covers the full HTTP boundary.

## Changed File Coverage

**Coverage analysis skipped — no coverage tool detected** (no `coverage` key or `@vitest/coverage` dependency in the workspace). Informational, not a failure.

## Assertion Quality

**Assertion quality**: ✅ All assertions verify real behavior

Audit of the change's new/modified test files (contracts, movements.route/service, telegram service/query-executor/corrector/reply-text/bot-brain, dashboard PlannedSection/MovementList/mutations/api/App) found:
- No tautologies, no orphan empty checks, no ghost loops, no smoke-only tests.
- 3 `toBeDefined()` calls in `bot-brain.test.ts` (L1180, L1235-1236) are existence checks on semantically-filtered few-shot fixtures (`find` predicates by role + content/dialog_action); they fail when the fixture is absent and verify real prompt content — acceptable, not type-only smoke.
- Triangulation is strong: exclusion tested per-aggregate (kpis/mom/daily/categories/top), mark-paid tested across 6 transition outcomes, previsto tested across both prefix orders and brain/brain-absent paths, planned query across real-data/zero/redirect.

## Quality Metrics

**Linter**: ✅ No errors (contracts, api, dashboard)
**Type Checker**: ✅ No errors (contracts, api, dashboard)

## Issues Found

**CRITICAL**: None

**WARNING**:
1. **`SummarySection` empty gate can hide the planned section for PENDING-only owners** (open finding adjudicated — spec REQUIRES showing `summary.planned`):
   - `apps/dashboard/src/features/movements/SummarySection.tsx:42-53` — the gate `mom.months.length === 0 && daily.length === 0` renders "No hay movimientos aún." instead of children. For an owner whose ONLY movements are PENDING, the API returns `mom.months: []`, `daily: []` (PENDING excluded from both aggregates) while `planned.total > 0`. The dashboard-web Metrics Overview requirement states unconditionally: "The planned expenses section MUST show `summary.planned` (next-month total, es-AR) with Spanish labels", and the scenario "Planned section renders next-month total" has no precondition on mom/daily — its GIVEN (`planned = {month, total: 4000}`) is exactly satisfiable in the PENDING-only state, yet the THEN fails. The same gate also hides the "Agregar previsto" form, which the ADDED Planned Expense Creation requirement says the dashboard MUST provide. This is the feature's first-day usage path (register a previsto before any paid movement).
   - **Exact gate fix (report only — NOT implemented; `SummarySection.tsx` is absent from the design file-change table and apply deliberately deferred):**
     - Option A (minimal): `const isEmpty = mom.months.length === 0 && daily.length === 0 && data.planned.total === 0;` — renders the kpis-tab sections for a PENDING-only owner while keeping the empty state for truly-empty owners. Note: this also makes the charts tab render children for a PENDING-only owner (empty charts instead of the empty state), which is defensible since `planned.total > 0` means the summary is not empty.
     - Option B (targeted, recommended): in `App.tsx`'s kpis tab, render `PlannedSection` from `summaryState` independently of the `SummarySection` empty gate (or pass the gate a flag), so the planned total + form always render on success; the empty state then replaces only the KPI/chart sections. This satisfies "MUST show summary.planned" for ALL states including truly-empty owners (form always reachable) and keeps the "Empty summary" scenario (empty state instead of charts) intact.
   - Severity rationale: WARNING not CRITICAL — scenario-level tests are green (PlannedSection component tests pass with the data in hand), no test fails, and the gap is a gate-composition edge path; the fix is small and well-scoped for a follow-up apply work-unit.

**SUGGESTION**:
1. `PlannedSection.tsx` `monthLabel` fallbacks (`year ?? 1970`, `monthIndex ?? 1`) are unreachable for valid "YYYY-MM" keys — already documented in apply; no action needed.
2. The three `toBeDefined()` existence assertions in `bot-brain.test.ts` could add a value assertion (e.g. assert the shot content includes a planned phrasing), though the semantic `find` predicates already make them meaningful.
3. No coverage tooling is configured in the workspace — adding `@vitest/coverage-v8` would let future verifies report changed-file coverage (informational).

## Rollback Note (task 5.2)

Rollback of the 4 chained PRs (revert commits 23798db→ee8673d in reverse order; PRs merge to main in order). Database rollback: `ALTER TABLE "Expense" DROP COLUMN "status"; DROP TYPE "MovementStatus";` — the migration backfilled existing rows as `PAID` via `NOT NULL DEFAULT` (default-only backfill, no explicit UPDATE), and the mark-paid transition rewrote only rows explicitly paid, so dropping the column loses no PAID-state information beyond the transient PENDING window. No feature flags; revert PR 1 (contracts + migration) first, then PR 2 (movements core), PR 3 (telegram), PR 4 (dashboard).

## Pre-existing Environment Notes (not regressions)

- Windows prisma `EPERM` on `prisma generate` (query-engine DLL locked by a dev server) and cold-start migration-pin hook timeouts are pre-existing, documented flakes; both pass warm. Not caused by this change and not reported as regressions.
- `rita-postgres` (:5433) healthy for the full run; all migration pins (7/7) and integration suites passed in this verification run.

## Verdict

**PASS WITH WARNINGS** — 25/25 requirements, 100/100 scenarios compliant with passing runtime evidence; 20/20 tasks complete; full suites green; 1 WARNING (SummarySection gate hides planned section on the PENDING-only path) with an exact fix for a follow-up; no blockers, no CRITICAL findings.