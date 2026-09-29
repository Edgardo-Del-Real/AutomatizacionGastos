# Apply Progress: Automatic Savings Split on Income (savings-rule)

**Mode**: Strict TDD (RED → GREEN → REFACTOR per task)
**Store**: hybrid (OpenSpec file + Engram mirror `sdd/savings-rule/apply-progress`)
**Branch**: `feat/multi-user-phase-2-dashboard`
**Result**: success — all 20 tasks complete, 7 work-unit commits, full suite green.

## Summary

Implemented the complete savings-rule vertical slice: SAVINGS movement type + CategoryType + SavingsRule model (D11 migration), the savings slice (D4), D9 category guards, D1–D3 KPI exclusion, D5/D7 split registration, D6 overrides, D10 command + brain redirect, D12 savings query, dashboard "Ahorrado"/"Ahorro" surface, and prompt goldens regenerated in-cycle (D11/5.6).

- API tests: **732/732** passing (36 files); typecheck + lint clean.
- Dashboard tests: **140/140** passing (22 files); typecheck + lint clean.
- Contracts: build + lint clean.
- E2E (real DB): split registers INCOME 900 + SAVINGS 100; summary income 900 / balance 900 / kpis.savings 100; PATCH ahorro on EXPENSE/INCOME → 422.

## Tasks Completed (all 20)

Phase 1: 1.1–1.4 (contracts + migration) · Phase 2: 2.1–2.4 (savings slice + category guards) · Phase 3: 3.1–3.3 (KPI exclusion) · Phase 4: 4.1–4.2 (PATCH guard + split) · Phase 5: 5.1–5.6 (telegram flow + goldens) · Phase 6: 6.1–6.3 (wiring + dashboard) · Phase 7: 7.1 (full verification).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/contracts/src/index.test.ts` | Unit | 25/25 | ✅ 14 failing | ✅ 39/39 | ✅ 4 cases (0/101/−1/100) | ✅ Clean |
| 1.2 | (contracts implementation) | — | — | — | ✅ 39/39 | — | ✅ Clean |
| 1.3 | `apps/api/src/features/savings/savings.migration.integration.test.ts` | Integration | 593/593 (baseline) | ✅ 11 failing | ✅ 11/11 | ✅ static + DB pins | ✅ Clean |
| 1.4 | (schema.prisma + migration) | — | — | — | ✅ 11/11 | — | ✅ Clean |
| 2.1 | `savings.service.test.ts`, `savings.repository.integration.test.ts` | Unit + Integration | 650/650 | ✅ no-module RED | ✅ 23/23 | ✅ invariant/edge cases | ✅ Clean |
| 2.2 | (savings slice) | — | — | — | ✅ 23/23 | — | ✅ Clean |
| 2.3 | `categories.service.savings.integration.test.ts` | Integration | 650/650 | ✅ 10 failing | ✅ 12/12 | ✅ guards + legacy | ✅ Clean |
| 2.4 | (categories guards + savings_forbidden) | — | — | — | ✅ 65/65 (savings+cat) | — | ✅ Clean |
| 3.1 | `movements.savings.integration.test.ts` | Integration | 685/685 | ✅ 6 failing | ✅ 10/10 | ✅ one per raw query | ✅ Clean |
| 3.2 | (same file) | Integration | — | ✅ | ✅ 10/10 | ✅ month-scoped savings | ✅ Clean |
| 3.3 | (movements repo/service D1–D3) | — | — | — | ✅ 10/10 | — | ✅ Clean |
| 4.1 | `movements.patch-guard.integration.test.ts`, `expenses.split.test.ts`, `expenses.split.integration.test.ts` | Integration + Unit | 695/695 | ✅ 5 failing | ✅ 25/25 | ✅ edges (pct=100, round-0) | ✅ Clean |
| 4.2 | (findById guard + createIncomeWithSavings) | — | — | — | ✅ 25/25 | — | ✅ Clean |
| 5.1 | `telegram.parser.test.ts` | Unit | 708/708 | ✅ | ✅ 40/40 | ✅ 3 override cases | ✅ Clean |
| 5.2 | `telegram.commands.test.ts` | Unit | — | ✅ | ✅ | ✅ valid/invalid/fallthrough | ✅ Clean |
| 5.3 | `telegram.service.savings.test.ts` | Unit | — | ✅ | ✅ 9/9 | ✅ split/whole/shared/overrides | ✅ Clean |
| 5.4 | `bot-brain.test.ts`, `query-executor.test.ts` | Unit | — | ✅ | ✅ | ✅ decode + prompt contract | ✅ Clean |
| 5.5 | (telegram service/brain/executor) | — | — | — | ✅ 731/731 | — | ✅ Clean |
| 5.6 | goldens (`vitest run -u`) | Snapshot | — | — | ✅ 3 updated in same commit | — | — |
| 6.1 | (app.ts wiring) | — | — | — | ✅ typecheck clean | — | ✅ Clean |
| 6.2 | `KpiCards.test.tsx`, `MovementList.test.tsx`, `MovementFilters.test.tsx`, `api.test.ts` | Dashboard | 132/132 | ✅ 7 failing | ✅ 140/140 | ✅ $150/$0, badge, option | ✅ Clean |
| 6.3 | (dashboard components + api) | — | — | — | ✅ 140/140 | — | ✅ Clean |
| 7.1 | Full suite | All | — | — | ✅ 732 api + 140 dashboard | — | — |

**Test summary**: ~95 new tests authored (contracts +7, migration 11, savings 23, categories guards 12, movements savings 10, patch/split 10, telegram parser/commands/savings-tail 40, brain/query +8, dashboard +7, split e2e +1). All passing. Pure functions created: `parseSavingsOverride`, `parseCommand` savings branch, `computeSplit`, `matchNote`, `resolveSplit`, `summarySavings`, savings query executor.

## Work Unit Evidence

| Unit | Focused test command + result | Runtime harness + result | Rollback boundary |
|------|-------------------------------|--------------------------|-------------------|
| Unit 1 (contracts+migration) | `vitest run packages/contracts/src/index.test.ts` + migration pins → 39 + 11 pass | `prisma migrate deploy` on `automatizacionrita_test` (docker, healthy) → 11 DB pins pass | Revert `e4ae56b`; enum value stays (no DROP VALUE), schema/migration gone |
| Unit 2 (savings slice+guards) | `vitest run src/features/savings src/features/categories/categories.service.savings.integration.test.ts` → 65 pass | N/A — no runtime boundary until unit 4 (repository/service only) | Revert `34b5cd8`; savings + categories edits removable without touching movements |
| Unit 3 (exclusions+split) | `vitest run src/features/movements src/features/expenses/*split*` → 45 pass | `app.inject` against `_test`: PATCH ahorro→422, GET /movements?type=SAVINGS, summary balance=600, split e2e | Revert `0fceed8` + `d133014`; repo/service edits independent of contracts/migration |
| Unit 4 (telegram+goldens) | `vitest run src/features/telegram` → all pass (parser 5, commands 6, tails 9, brain 90+, service suite) | Brain-absent deterministic path (GROQ_API_KEY unset — harness brain defaults null) + DB split e2e in `telegram.service.integration.test.ts` | Revert `eab18ce`; goldens restored from git; telegram edits scoped to feature |
| Unit 5 (wiring+dashboard) | `vitest run` (dashboard) → 140 pass | N/A — component tests only (no runtime boundary for KPI/badge/filter rendering) | Revert `7fa01a5` + `92bea85`; app.ts + dashboard edits independent of API slice |

## Deviations from Design

- **`resolveSplit` return shape**: the design interface sketch showed `resolveSplit → {kind:"split"; percent; net; savings}`, but net/savings require the gross, which resolveSplit does not receive. Implemented `{kind:"whole"} | {kind:"split"; percent}`; the tail derives amounts from `createIncomeWithSavings`'s returned `{net, savings}` (Decimal arithmetic inside the transaction). Same observable behavior; simpler interface.
- **`boundaryRegex` export (task 2.4 item)**: exported in task 2.2 instead, because the savings slice imports it (dependency order). Task 2.4's export item is satisfied by that earlier export.
- **Task 6.1 (app.ts wiring)**: completed in the Unit 4 commit — the `TelegramServiceDeps` change made `app.ts` fail typecheck until `savingsService` was wired; kept with the telegram unit for a typecheck-clean tree.
- **Commit-order typecheck**: Unit 1 and Unit 2 commits do not individually typecheck because the additive summary contract (required `kpis.savings`/`months[].savings`) forces the movements producer change; the units were committed in dependency order (contracts → slice → movements) and the final tree is fully green. All 5 units land in a single PR, so intermediate commits are checkpoints, not merge points.
- **"Frozen `POST /expenses`"**: untouched, per contract. `createMovementSchema` now accepts SAVINGS explicitly (contract change), so the frozen route could persist a SAVINGS row if a client sends `type:"SAVINGS"` — accepted as the design open question allows.

## Issues Found

- **Pre-existing concurrency flake**: the full-suite run intermittently fails `telegram.service.integration.test.ts` with a 10s `beforeAll` hook timeout (`prisma migrate deploy` contending across parallel integration suites). Passes 34/34 when run solo; reproduced at baseline (before any change) and not caused by this work. Recommend a `hookTimeout` bump or serialized migrate in a follow-up.
- **`prisma generate` EPERM**: the query-engine DLL is locked by lingering node processes on Windows; killed stale processes to regenerate. Not code-related.

## Workload / PR Boundary

- Mode: single PR (delivery `auto-chain`, session budget 5,000 lines; forecast `Chained PRs recommended: No`).
- 7 commits on `feat/multi-user-phase-2-dashboard` (no push, no PR — delivery orchestrated separately):
  - `e4ae56b` feat(savings): contracts + migration + pins
  - `34b5cd8` feat(savings): savings slice + category guards
  - `0fceed8` feat(movements): D1–D3 exclusion + month savings
  - `d133014` feat(movements): PATCH guard + atomic split
  - `eab18ce` feat(telegram): overrides, tails, savings query + goldens (3 updated)
  - `7fa01a5` feat(dashboard): Ahorrado card, Ahorro badge/filter
  - `92bea85` test(telegram): split e2e
- Authored line estimate: ~2,200 changed lines across all units (forecast 1,500–1,800 was close; the extra is test breadth).

## Status

20/20 tasks complete. Ready for verify.