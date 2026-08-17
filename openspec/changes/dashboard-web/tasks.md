# Tasks: Dashboard Web — Read-Only Metrics + Expense List

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1500–2500 (25 new + 2 modified files) |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Scaffold + contracts schemas + infra client | PR 1 | `pnpm --filter @rita/dashboard test` (api.test.ts) | `pnpm --filter @rita/dashboard dev` with API on :3000, page loads both sections empty/error | Revert `packages/contracts/src/index.ts`, delete `apps/dashboard/`, `pnpm install` prunes lockfile |
| 2 | Metrics slice (cards + recharts chart) | PR 2 | `pnpm --filter @rita/dashboard test` (features/metrics) | `dev` with seeded API → cards + monthly bar chart render | Delete `src/features/metrics/` only |
| 3 | Expenses slice + filters + App integration | PR 3 | `pnpm --filter @rita/dashboard test` (features/expenses + App) | `dev` → table renders, month/category filters refine rows | Delete `src/features/expenses/`, revert `src/App.tsx` |

## Phase 1: Foundation (contracts + scaffold + infra)

- [x] 1.1 RED: `src/infra/api.test.ts` — `fetchSummary`/`fetchExpenses` validate via `expenseSummarySchema`/`listExpensesSchema`; malformed payloads (missing/wrong-typed `occurredAt`, `months`) throw `ApiError{kind:"validation"}`; fails on missing export
- [x] 1.2 GREEN: `packages/contracts/src/index.ts` — extract/export `expenseMonthSchema` (refactor `expenseSummarySchema` to reuse), add `listExpensesSchema = z.array(expenseSchema)` + types `ExpenseMonth`/`ListExpenses`; run `pnpm --filter @rita/contracts build`
- [x] 1.3 Create `apps/dashboard/package.json` — `@rita/dashboard`, scripts prefix `pnpm --filter @rita/contracts build`; react@19/react-dom@19/recharts/@rita/contracts@workspace:*; vite/@vitejs/plugin-react/vitest@4/@testing-library/jsdom
- [x] 1.4 Create `apps/dashboard/vite.config.ts` (plugin-react, proxy `/api`→`http://localhost:3000`) and `vitest.config.ts` (jsdom, `include:["src/**/*.test.{ts,tsx}"]`, setupFiles `./src/test/setup.ts`, fileParallelism:false)
- [x] 1.5 Create `apps/dashboard/tsconfig.json` (extends `../../tsconfig.base.json` + `lib:["ES2022","DOM","DOM.Iterable"]` + `jsx:"react-jsx"`), `src/vite-env.d.ts` (`vite/client` + `ImportMetaEnv.VITE_OWNER_ID?:string`), `index.html`, `src/main.tsx`, `src/test/setup.ts` (`@testing-library/jest-dom/vitest`)
- [x] 1.6 GREEN: `src/infra/env.ts` (`OWNER_ID = import.meta.env.VITE_OWNER_ID ?? "default"`) + `src/infra/api.ts` (fetch, ownerId query param, safeParse, ApiError network/http/validation)
- [x] 1.7 Append `VITE_OWNER_ID=default` to `.env.example`

## Phase 2: Metrics slice

- [x] 2.1 RED: `features/metrics/useMetrics.test.tsx` — idle→loading→success, error, `retry()` refetches (renderHook + mocked api)
- [x] 2.2 GREEN: `features/metrics/useMetrics.ts` (AsyncState machine + retry)
- [x] 2.3 RED: `MetricsCards`/`MetricsChart` tests — 6-month cards + recharts BarChart (count/totalAmount, month-ordered), empty state, error+retry
- [x] 2.4 GREEN: `MetricsCards.tsx`, `MetricsChart.tsx`, `MetricsOverview.tsx` (hooks + section states)

## Phase 3: Expenses slice

- [ ] 3.1 RED: `features/expenses/expenseFilters.test.ts` — AND of month (`YYYY-MM` from occurredAt) + category, no-match→[], reset `{}`
- [ ] 3.2 GREEN: `features/expenses/expenseFilters.ts` (pure `filterExpenses`)
- [ ] 3.3 RED: `features/expenses/useExpenses.test.tsx` — states + retry
- [ ] 3.4 RED: `ExpenseList`/`ExpenseFilters` tests — table cols date/amount/currency/category/note, occurredAt desc, filters render, empty/error states
- [ ] 3.5 GREEN: `useExpenses.ts`, `ExpenseFilters.tsx`, `ExpenseList.tsx`

## Phase 4: Integration + verification

- [ ] 4.1 RED: `App.test.tsx` — both sections render from mocked api; filter selection updates rows
- [ ] 4.2 GREEN: `src/App.tsx` composition (MetricsOverview + ExpenseList)
- [ ] 4.3 Run `pnpm --filter @rita/dashboard test` + `typecheck` + `lint`; verify `pnpm --filter @rita/dashboard build`
