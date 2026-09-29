```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:3c2c21e5f92fdcc3efc2587f770be2771d6c462e42094ce8ca97cb721ffdc1ad
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 25/25
scenarios: 90/90
test_command: pnpm --filter @rita/api test && pnpm --filter @rita/dashboard test
test_exit_code: 0
test_output_hash: sha256:decb868339fc00ca242c373c14185caaf43c5ffd1273fd23b9a0ab0bb7851bd0
build_command: pnpm --filter @rita/contracts build
build_exit_code: 0
build_output_hash: sha256:e06be89e9f814cc6f50623cff9519f13d3dce96cbb55892263013598af8fd967
```

## Verification Report

**Change**: savings-rule
**Version**: delta specs (6 capability files), revision per `openspec/changes/savings-rule/specs/**`
**Mode**: Strict TDD (active, authoritative per orchestrator)

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 20 |
| Tasks complete | 20 |
| Tasks incomplete | 0 |

All 20 tasks marked `[x]`; every test-bearing task's test file was located and executed (see TDD Compliance). No task marked done without evidence.

### Build & Tests Execution
**Build**: ✅ Passed (`pnpm --filter @rita/contracts build`, exit 0)
```text
> @rita/contracts@0.1.0 build
> tsc -p tsconfig.json
(no errors)
```

**Tests**: ✅ 872 passed (732 API + 140 dashboard) / ❌ 0 failed / ⚠️ 0 skipped
```text
API:      Test Files  36 passed (36) | Tests  732 passed (732)   [pnpm --filter @rita/api test]
Dashboard: Test Files  22 passed (22) | Tests  140 passed (140)   [pnpm --filter @rita/dashboard test]
```
Integration suites executed against the real test DB `automatizacionrita_test` on `rita-postgres` (localhost:5433, healthy) — `prisma migrate deploy` runs in each `beforeAll`, no skip gating exists in `vitest.config.ts` or the integration files.

**Typecheck**: ✅ API, dashboard, contracts all exit 0.
**Lint**: ✅ API, dashboard, contracts all exit 0.
**Coverage**: ➖ Not available — no coverage provider configured in `vitest.config.ts`; not a failure.

### Spec Compliance Matrix
| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| SavingsRule Model | Rule created | `savings.service.test.ts > defineRule` + `savings.repository.integration.test.ts` | ✅ COMPLIANT |
| SavingsRule Model | Invalid percent rejected | `savings.service.test.ts` (0/101/−1/NaN) + `contracts index.test.ts` | ✅ COMPLIANT |
| SavingsRule Model | Redefinition upserts | `savings.service.test.ts > upserts` | ✅ COMPLIANT |
| SavingsRule Definition Channel | Conversational intent redirects | `telegram.service.savings.test.ts > redirects create_savings_rule` | ✅ COMPLIANT |
| SavingsRule Definition Channel | Command defines a rule | `telegram.commands.test.ts` + `telegram.service.ts` defineRule path | ✅ COMPLIANT |
| SavingsRule Definition Channel | Malformed definition | `telegram.commands.test.ts` (0%/150%/−3% → invalid) | ✅ COMPLIANT |
| Income Split and Rounding | Split registers net and savings | `expenses.split.test.ts` + `telegram.service.integration.test.ts` e2e (900/100) | ✅ COMPLIANT |
| Income Split and Rounding | Rounding keeps the invariant | `savings.service.test.ts > computeSplit` (3.3/6.7, 10.01@33%) | ✅ COMPLIANT |
| Income Split and Rounding | Two-movement atomicity | `expenses.split.test.ts > rolls back everything` | ✅ COMPLIANT |
| Income Split and Rounding | No rule registers whole | `telegram.service.savings.test.ts > whole INCOME` | ✅ COMPLIANT |
| SHARED Inheritance | Shared income shares savings | `telegram.service.savings.test.ts > SHARED visibility` | ✅ COMPLIANT |
| Deterministic Overrides | sin ahorro registers whole | `telegram.parser.test.ts` + `telegram.service.savings.test.ts` | ✅ COMPLIANT |
| Deterministic Overrides | con X% overrides the percent | `telegram.parser.test.ts` + `telegram.service.savings.test.ts` | ✅ COMPLIANT |
| Deterministic Overrides | Brain-absent path | `telegram.service.integration.test.ts` (GROQ_API_KEY unset, split e2e) | ✅ COMPLIANT |
| KPI-Exclusion Invariants | Savings never pollute KPIs | `movements.savings.integration.test.ts` (900/300/600) | ✅ COMPLIANT |
| Month Savings Query | Month with savings | `query-executor.test.ts` (150) + `movements.savings.integration.test.ts` | ✅ COMPLIANT |
| Month Savings Query | Empty month | `movements.savings.integration.test.ts` (kpis.savings 0) | ✅ COMPLIANT |
| Movement Type Model | Migration preserves existing rows | `savings.migration.integration.test.ts > preserves existing movements as EXPENSE` | ✅ COMPLIANT |
| Movement Type Model | Default on creation | migration DB pin + `expenses.repository.ts` `type ?? "EXPENSE"` | ✅ COMPLIANT |
| Movement Type Model | SAVINGS type stored | migration DB pin + split e2e | ✅ COMPLIANT |
| Movement Contracts | Update schema optional fields | `contracts index.test.ts` | ✅ COMPLIANT |
| Movement Contracts | Null clears category | `contracts index.test.ts` | ✅ COMPLIANT |
| Movement Contracts | Invalid category rejected | `contracts index.test.ts` + PATCH 422 integration | ✅ COMPLIANT |
| Movement Contracts | Non-positive amount rejected | `contracts index.test.ts` | ✅ COMPLIANT |
| Movement Contracts | Empty patch rejected | `contracts index.test.ts` (refine at-least-one) | ✅ COMPLIANT |
| Movement Contracts | Expense contracts unchanged | `expenseSchema` family unchanged (git diff) + contracts tests | ✅ COMPLIANT |
| Movement Contracts | SAVINGS accepted by the list filter | `contracts index.test.ts > SAVINGS in type filter` | ✅ COMPLIANT |
| Movement List Endpoint | Combined filters | `movements.route.test.ts > combined filters` | ✅ COMPLIANT |
| Movement List Endpoint | No matches | `movements.route.test.ts > empty array 200` | ✅ COMPLIANT |
| Movement List Endpoint | SAVINGS filter | `movements.savings.integration.test.ts > GET /movements?type=SAVINGS` | ✅ COMPLIANT |
| Movement Summary Endpoint | ARS-only totals | `movements.route.test.ts > totals only ARS` | ✅ COMPLIANT |
| Movement Summary Endpoint | Buenos Aires bucketing | `movements.route.test.ts > buckets to BA month` | ✅ COMPLIANT |
| Movement Summary Endpoint | No data | `movements.route.test.ts > zero-filled` | ✅ COMPLIANT |
| Movement Summary Endpoint | Month comparison | `movements.route.test.ts > month-over-month` | ✅ COMPLIANT |
| Movement Summary Endpoint | Savings excluded from sums | `movements.savings.integration.test.ts > summary balance 600` | ✅ COMPLIANT |
| Movement Summary Endpoint | Savings reported month-scoped | `movements.savings.integration.test.ts > 150 current, prior excluded` | ✅ COMPLIANT |
| Movement Update Endpoint | Update note only | `movements.route.test.ts` PATCH suite | ✅ COMPLIANT |
| Movement Update Endpoint | Clear category | `movements.route.test.ts` PATCH suite | ✅ COMPLIANT |
| Movement Update Endpoint | Set valid category | `movements.route.test.ts` PATCH suite | ✅ COMPLIANT |
| Movement Update Endpoint | Invalid category | `movements.route.test.ts > 422` | ✅ COMPLIANT |
| Movement Update Endpoint | Update income movement | `movements.route.test.ts` PATCH suite | ✅ COMPLIANT |
| Movement Update Endpoint | Missing movement | `movements.route.test.ts > 404` | ✅ COMPLIANT |
| Movement Update Endpoint | Another owner's movement | `movements.route.test.ts > 404` | ✅ COMPLIANT |
| Movement Update Endpoint | SAVINGS category rejected on income/expense | `movements.patch-guard.integration.test.ts > 422` | ✅ COMPLIANT |
| Category Type | ahorro is always SAVINGS | `categories.service.savings.integration.test.ts` | ✅ COMPLIANT |
| Category Type | Normal categories stay NORMAL | `categories.service.savings.integration.test.ts` | ✅ COMPLIANT |
| Category Type | Legacy ahorro converts, movements untouched | `savings.migration.integration.test.ts` (static + DB pins) | ✅ COMPLIANT |
| Category Type | Delete and rename guards | `categories.service.savings.integration.test.ts` | ✅ COMPLIANT |
| SAVINGS Category Assignment Guard | Assignment rejected | `categories.service.savings.integration.test.ts` + PATCH guard 422 | ✅ COMPLIANT |
| SAVINGS Category Assignment Guard | SAVINGS movement allowed | `categories.service.savings.integration.test.ts` | ✅ COMPLIANT |
| Interpret Envelope Contract | Envelope decodes strict JSON | `bot-brain.test.ts` | ✅ COMPLIANT |
| Interpret Envelope Contract | Mixed-intent envelope decodes | `bot-brain.test.ts` (then_reassign) | ✅ COMPLIANT |
| Interpret Envelope Contract | Unknown intent degrades | `bot-brain.test.ts` (null) | ✅ COMPLIANT |
| Interpret Envelope Contract | Savings-rule intent decodes | `bot-brain.test.ts > create_savings_rule` | ✅ COMPLIANT |
| Reply-After-Action Contract | Reply reflects only executed facts | `bot-brain.test.ts` | ✅ COMPLIANT |
| Reply-After-Action Contract | Redirected result never invents amounts | `bot-brain.test.ts` | ✅ COMPLIANT |
| Reply-After-Action Contract | Split result confirms gross/net/savings | `bot-brain.test.ts > posts savings facts` | ✅ COMPLIANT |
| Intent Taxonomy | Off-topic redirects, never chats | `bot-brain.test.ts` (pre-existing, still green) | ✅ COMPLIANT |
| Intent Taxonomy | Expense-signal bias in the prompt | `bot-brain.test.ts` prompt tests | ✅ COMPLIANT |
| Intent Taxonomy | Query intent executes real data | `query-executor.test.ts` | ✅ COMPLIANT |
| Intent Taxonomy | Correct-category activates correction flow | `bot-brain.test.ts` (pre-existing, still green) | ✅ COMPLIANT |
| Intent Taxonomy | Savings-rule intent redirects to command | `telegram.service.savings.test.ts` + `bot-brain.test.ts` | ✅ COMPLIANT |
| Prompt Contract | Prompt drift fails CI | `bot-brain.test.ts` goldens (8 `toMatchFileSnapshot`) | ✅ COMPLIANT |
| Prompt Contract | Dialog prompt variant pinned | `bot-brain.test.ts` dialog goldens | ✅ COMPLIANT |
| Prompt Contract | Savings prompt changes regenerate goldens in-cycle | 3 goldens changed in commit `eab18ce` alongside prompt edits; suite green | ✅ COMPLIANT |
| Savings Rule Command | Define a savings rule | `telegram.commands.test.ts` + service savings test | ✅ COMPLIANT |
| Savings Rule Command | Invalid percent rejected | `telegram.commands.test.ts` (0%/150%/−3%) | ✅ COMPLIANT |
| Savings Rule Command | Unrecognized command falls through | `telegram.commands.test.ts` | ✅ COMPLIANT |
| Savings Split on Income Registration | Split applied on registration | `telegram.service.savings.test.ts` + integration e2e | ✅ COMPLIANT |
| Savings Split on Income Registration | Shared income shares the savings | `telegram.service.savings.test.ts` | ✅ COMPLIANT |
| Savings Split on Income Registration | No rule registers whole | `telegram.service.savings.test.ts` | ✅ COMPLIANT |
| Registration Overrides | sin ahorro disables the split | `telegram.parser.test.ts` + service test | ✅ COMPLIANT |
| Registration Overrides | con X% overrides the rule percent | `telegram.parser.test.ts` + service test | ✅ COMPLIANT |
| Registration Overrides | Override works without the brain | `telegram.service.integration.test.ts` (GROQ unset) | ✅ COMPLIANT |
| Registration Overrides | Invalid override percent rejected | `telegram.parser.test.ts` (150%) + service test | ✅ COMPLIANT |
| Savings Query Routing | Savings query answers real data | `query-executor.test.ts` + service test (150) | ✅ COMPLIANT |
| Savings Query Routing | Savings query failure redirects | `telegram.service.savings.test.ts > No pude consultar` | ✅ COMPLIANT |
| Metrics Overview | Full dashboard | `App.test.tsx` (sections/order) | ✅ COMPLIANT |
| Metrics Overview | Month-over-month delta | `SummarySection.test.tsx` | ✅ COMPLIANT |
| Metrics Overview | Empty summary | `App.test.tsx` (Spanish empty state) | ✅ COMPLIANT |
| Metrics Overview | Ahorrado card shows current-month savings | `KpiCards.test.tsx` ($150,00) | ✅ COMPLIANT |
| Metrics Overview | Ahorrado card with no savings | `KpiCards.test.tsx` ($0,00) | ✅ COMPLIANT |
| Movement List | Render movements | `MovementList.test.tsx` | ✅ COMPLIANT |
| Movement List | Empty or unknown owner | `MovementList.test.tsx` | ✅ COMPLIANT |
| Movement List | Row actions present | `MovementList.test.tsx` | ✅ COMPLIANT |
| Movement List | SAVINGS row renders with the Ahorro badge | `MovementList.test.tsx > SAVINGS row` | ✅ COMPLIANT |
| Movement Filters | Combined filter | `MovementFilters.test.tsx` | ✅ COMPLIANT |
| Movement Filters | No matches | `MovementFilters.test.tsx` | ✅ COMPLIANT |
| Movement Filters | Reset | `MovementFilters.test.tsx` | ✅ COMPLIANT |
| Movement Filters | Filter by Ahorro | `MovementFilters.test.tsx > Ahorro option` | ✅ COMPLIANT |

**Compliance summary**: 90/90 scenarios compliant (each with a passing covering test at runtime).

### Proposal Success Criteria (walk of all 6)
| Criterion | Evidence | Result |
|-----------|----------|--------|
| Rule 10% + "cobro sueldo de entrenuts 1000" → INCOME 900 + SAVINGS 100 (SHARED if "compartido:") | `telegram.service.integration.test.ts` e2e (900/100, category ahorro, reply 900,00) + `telegram.service.savings.test.ts` SHARED inheritance | ✅ PASS |
| "sin ahorro" / "con 5%" overrides work brain-absent | `telegram.parser.test.ts` parseSavingsOverride + `telegram.service.savings.test.ts` (disabled/percent) + integration e2e with GROQ_API_KEY unset | ✅ PASS |
| Summary endpoints exclude SAVINGS from income/expense/balance | `movements.savings.integration.test.ts` (income 900, expenses 300, balance 600; no ahorro row; top lists clean) | ✅ PASS |
| "cuánto ahorré este mes" answers from real data | `query-executor.test.ts` (savings 150 from kpis.savings) + service test reply contains 150; failure → honest redirect | ✅ PASS |
| "crear categoría ahorro" never creates a normal category | `categories.service.savings.integration.test.ts` (SAVINGS upsert, never NORMAL, no duplicate) | ✅ PASS |
| Dashboard badge/filter/KPI card render; API + dashboard tests green | `KpiCards.test.tsx` ($150/$0), `MovementList.test.tsx` (Ahorro badge), `MovementFilters.test.tsx` (Ahorro option); 732 API + 140 dashboard green | ✅ PASS |

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| SavingsRule Model + unique [ownerId, keyword] | ✅ Implemented | schema `SavingsRule_ownerId_keyword_key`; `upsert` in `savings.repository.ts`; Decimal(12,2) |
| Percent validation 0 < pct ≤ 100 | ✅ Implemented | `savingsRuleSchema` gt(0).lte(100); `defineRule` double-checks |
| Income split + rounding invariant | ✅ Implemented | `computeSplit`/`createIncomeWithSavings` Decimal arithmetic; `net + savings === gross` |
| SHARED inheritance | ✅ Implemented | `visibility` passed through to both creates in `$transaction` |
| Deterministic overrides | ✅ Implemented | `parseSavingsOverride` after `parseSharedPrefix`, stripped pre-parser/brain; persisted in payload |
| KPI exclusion (D1–D3) | ✅ Implemented | single `SAVINGS_EXCLUDED` fragment in kpis/daily/categories; months third CASE; `summarySavings` month-scoped |
| Balance = net income − expenses | ✅ Implemented | `balance = kpis.income - kpis.expenses` in `movements.service.ts` |
| Month savings query (D12) | ✅ Implemented | query executor `savings()` reads `kpis.savings` + `mom.months.at(-1).month` |
| Category type + ahorro guards (D9) | ✅ Implemented | `ensureAhorro` upsert; rename/delete rejected; `assertOwnerCategory` rejects SAVINGS on EXPENSE/INCOME |
| PATCH 422 guard | ✅ Implemented | `updateMovement` → `assertOwnerCategory(ownerId, category, movement.type)` |
| create_savings_rule intent redirect (D10) | ✅ Implemented | `case "create_savings_rule"` → `sendRedirect` to `registrar ahorro: <palabra> al <X>%` |
| Goldens regenerated in-cycle | ✅ Implemented | 3 goldens changed in `eab18ce` with the prompt edits; 8 pins pass |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 exclusion fragment | ✅ Yes | `SAVINGS_EXCLUDED` composed into summaryKpis/summaryDaily/summaryCategories |
| D2 summaryMonths third CASE | ✅ Yes | `mom.months[].savings` from the same query |
| D3 summarySavings month-scoped | ✅ Yes | `kpis.savings` = current BA month, ARS, viewer predicate |
| D4 savings slice | ✅ Yes | `features/savings/` with service + repository; oldest-wins via createdAt ASC |
| D5 split in both registration tails | ✅ Yes | both tails classify once and call `resolveSplit` |
| D6 overrides parsed once at arrival | ✅ Yes | after `parseSharedPrefix`, stripped, persisted in payload |
| D7 one `$transaction` | ✅ Yes | `createIncomeWithSavings`; edges pct=100 → only SAVINGS, round-0 → whole |
| D8 con X% only replaces a matching rule's percent; no rule → whole | ⚠️ No | `resolveSplit` applies a percent override even with NO matching rule (rule-free split; test asserts it). See WARNING 1 |
| D9 category guards | ✅ Yes | create/rename/delete guards + assertOwnerCategory with movementType |
| D10 command redirect | ✅ Yes | `registrar ahorro` command + invalid % rejected, nothing stored |
| D11 one hand-written migration | ✅ Yes | ALTER TYPE ADD VALUE, CategoryType, ahorro UPDATE, SavingsRule; no Expense writes; pins pass |
| D12 savings query via summary | ✅ Yes | `kpis.savings` + `mom.months.at(-1)` |
| Open Q: net 0 edge (pct=100) | ✅ Confirmed | only SAVINGS movement created, tested |
| Open Q: frozen POST /expenses | ⚠️ Accepted | untouched; `createMovementSchema` accepts SAVINGS; documented in apply-progress | 
| Open Q: KpiCards card set | ⚠️ Pre-existing | renders 5 cards (added Ahorrado); spec enumerates 8; baseline rendered 4 of the enumerated 7 — pre-existing divergence, not introduced here |

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | TDD Cycle Evidence table present in `apply-progress.md` |
| All tasks have tests | ✅ | 16 test-bearing tasks; every listed test file exists on disk |
| RED confirmed (tests exist) | ✅ | 16/16 test files located and read (unit/integration/dashboard/goldens) |
| GREEN confirmed (tests pass) | ✅ | 732/732 API + 140/140 dashboard pass on this run (was: 732 + 140 claimed) |
| Triangulation adequate | ✅ | multi-case: split 4 edges, override 4 cases, guard 4 cases, KPI 4 values, migration 11 pins |
| Safety Net for modified files | ✅ | reported per task (25/25 → 708/708 baselines); no contradiction found |
| Goldens regenerated in-cycle | ✅ | 3 goldens changed in the same commit as prompt edits (`eab18ce`) |

**TDD Compliance**: 7/7 checks passed

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | ~90+ (contracts +7, savings 23, split 4, parser 8, commands 6, tails 9, brain/query 8+) | 9 | vitest |
| Integration | ~60+ (migration 11, repository, categories 12, movements 10, patch-guard 4, split e2e, telegram e2e) | 8 | vitest + real Postgres (`_test` DB) |
| Dashboard (component) | 140 total across 22 files (+7 savings) | 22 | vitest + Testing Library |
| E2E | 1 (split e2e through real service + DB) | 1 | app.inject + real DB |
| **Total** | **872** | **58 files across 3 packages** | |

### Changed File Coverage
Coverage analysis skipped — no coverage tool detected (no coverage provider configured in either `vitest.config.ts`). Informational, not a failure.

### Assertion Quality
**Assertion quality**: ✅ All assertions verify real behavior — value assertions (900/100, 3.30/6.70, $150,00, 422 status, savings 150), no tautologies (`expect(true).toBe(true)`), no ghost loops, no smoke-only tests. Mock-heavy tail tests still assert call payloads (`objectContaining({gross: 1000, percent: 10, visibility: "SHARED"})`) and reply content.

### Quality Metrics
**Linter**: ✅ No errors (API, dashboard, contracts — all exit 0)
**Type Checker**: ✅ No errors (API, dashboard, contracts — all exit 0)

### Issues Found
**CRITICAL**: None

**WARNING**:
1. **D8 not honored: rule-free "con X%" override splits instead of registering whole.** `SavingsRuleService.resolveSplit` returns `{kind:"split", percent: override.percent}` even when NO rule matches the note; design D8 settled "con X% only replaces a matching rule's percent; no rule → whole". The behavior is spec-compatible (no spec scenario covers "con X%" with no rule) but deviates from the settled design decision and is NOT listed in apply-progress "Deviations from Design". Recommendation: either honor D8 (matchNote before applying the override) or document the deviation in apply-progress/design.
2. **Frozen `POST /expenses` can still attach "ahorro" to EXPENSE/INCOME rows** (design open question, accepted in apply-progress). `createMovementSchema` now admits `type: "SAVINGS"` and the route never calls `assertOwnerCategory`, so a direct API call bypasses the guard that PATCH and telegram paths enforce. Accepted and documented; consider a follow-up guard or deprecating the route.

**SUGGESTION**:
1. **KpiCards card set divergence from dashboard spec enumeration** (pre-existing): the dashboard-web spec enumerates 8 KPI cards; the implementation renders 5 (baseline already rendered 4 of the enumerated 7 before this change). The delta (Ahorrado) is implemented and tested; the remaining cards (Promedio mes, Promedio por movimiento, Máximo, Cantidad) were already absent at baseline. Consider aligning the spec text or the component in a future slice.
2. Pre-existing concurrency flake in `telegram.service.integration.test.ts` (10s `beforeAll` hookTimeout when parallel suites contend on `prisma migrate deploy`) — reproduced at baseline per apply-progress; this run passed clean (43s, no flake). A `hookTimeout` bump or serialized migrate is a good follow-up.
3. `resolveSplit` return shape differs from the design interface sketch (documented in apply-progress): returns `{kind:"split"; percent}` and lets the tail derive amounts — behaviorally equivalent.

### Verdict
PASS WITH WARNINGS
90/90 scenarios compliant, 25/25 requirements, 20/20 tasks with evidence, 872/872 tests green, typecheck/lint clean, real-DB integration suites passing. Two WARNING-level design-coherence gaps (D8 rule-free override, frozen POST /expenses) and pre-existing dashboard card enumeration divergence — none break a spec scenario; archive is recommended with the noted follow-ups.