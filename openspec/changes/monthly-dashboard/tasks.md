# Tasks: Monthly Dashboard

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines (authored, tests included) | PR1 ~620 · PR2 ~330 · total ~950 |
| 400-line budget risk | High as one PR; each slice fits |
| Chained PRs recommended | Yes — 2 stacked slices on `dev` |
| Delivery | `feat/monthly-dashboard-pr1` → `feat/monthly-dashboard-pr2` |

Decision needed before apply: No — product decisions closed with the owner on 2026-11-01.

## Phase 1 — Contracts (PR1)

- [x] 1.1 RED: contract tests for the new summary shape (`planned` = `{ total }`, no `mom`, no `kpis.countThisMonth`) and for `movementFiltersSchema` accepting `month` and rejecting `from`/`to`/`status`.
- [x] 1.2 GREEN: `movementSummarySchema` — drop `mom`, drop `kpis.countThisMonth`, `planned: { total }`.
- [x] 1.3 GREEN: `movementFiltersSchema` — add `month` (`^\d{4}-(0[1-9]|1[0-2])$`), remove `from`, `to`, `status`.
- [x] 1.4 Build contracts (`pnpm --filter @rita/contracts build`) before touching the API.

## Phase 2 — Month helpers (PR1)

- [x] 2.1 RED: `ba-month.test.ts` — `currentBaMonth` uses the Buenos Aires wall clock; `monthToPeriod("2026-02")` → `{ from: "2026-02-01", to: "2026-02-28" }`; leap February; 30- and 31-day months; `isMonthKey` rejects `2026-13`, `2026-1`, `""`.
- [x] 2.2 GREEN: `apps/api/src/features/movements/ba-month.ts` with `BA_OFFSET_MS`, `currentBaMonth`, `monthToPeriod`, `isMonthKey`.

## Phase 3 — Repository (PR1)

- [x] 3.1 RED: integration tests — `summarySavings(period)` sums only the requested month; `summaryDaily(period)` returns one zero-filled row per day of the month; `summaryPlanned()` returns the outstanding total without a month key; `listByOwner` honours `status`.
- [x] 3.2 GREEN: `summarySavings`/`summaryManualSavings` take the period; `summaryDaily` takes the period; `summaryPlanned` loses its `month` parameter and returns `{ total }`; delete `summaryMonths` and `MonthBucket`.

## Phase 4 — Service (PR1)

- [x] 4.1 RED: `movements.service.test.ts` — `getSummary(scope, "2026-10")` scopes kpis/savings/daily/categories; `getSummary(scope)` returns lifetime totals with an empty `daily`; `planned` is month-independent; a single `summaryKpis` call replaces the old `thisMonthKpis` pair.
- [x] 4.2 GREEN: `getSummary(scope, month?)` — derive the period with `monthToPeriod`, drop `currentMonthPeriod`, `nextBaMonth`, `lastMonths`, `thisMonthKpis`.

## Phase 5 — Route (PR1)

- [x] 5.1 RED: route tests — `month=2026-10` accepted and forwarded; no `month` → lifetime; `month=2026-13` → `422`; list with `month` returns only that month and never PENDING rows.
- [x] 5.2 GREEN: both route schemas take `month`; the list route composes `{ status: "PAID" }` so previstos stay out of the monthly table.

## Phase 6 — Bot plumbing (PR1)

- [x] 6.1 RED: `query-executor` tests — `balance` uses the lifetime scope; `month` and `savings` pass the current Buenos Aires month and read `kpis.count` / the period key.
- [x] 6.2 GREEN: explicit `currentBaMonth()` at the two call sites; drop `mom.at(-1)`; `planned` reads only `total`.

## Phase 7 — Dashboard adaptation (PR1)

Required to keep the tree compiling and green after the contract cut; the month UX lands in PR2.

- [x] 7.1 `apps/dashboard/src/infra/month.ts`: `currentBaMonth()` via `Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })`.
- [x] 7.2 `infra/api.ts`: summary and list take `month`; drop `from`/`to`/`status` from `MovementListFilters`.
- [x] 7.3 `useMovementSummary` / `App`: request the current Buenos Aires month.
- [x] 7.4 `SummarySection`: empty predicate without `mom` (`kpis.count === 0 && planned.total === 0`).
- [x] 7.5 `KpiCards`: `countThisMonth` → `count`.
- [x] 7.6 `MovementList` / `MovementFilters`: drop the synthetic "Previstos" option and the free date range.
- [x] 7.7 Update every dashboard fixture that still builds `mom`, `countThisMonth` or `planned.month`.

## Phase 8 — Verify and deliver (PR1)

- [x] 8.1 `pnpm --filter @rita/api test` — green except the known pre-existing `telegram.service.test.ts:746` failure.
- [x] 8.2 `pnpm --filter @rita/dashboard test`, root `pnpm typecheck`, root `pnpm lint`.
- [x] 8.3 Commit as work units (contract, API, bot, dashboard adaptation stay separable).

## Phase 9 — Month UX (PR2)

- [ ] 9.1 RED: `MonthSelector` tests — default month, previous/next, direct input, URL sync, malformed fallback, accessible label.
- [ ] 9.2 GREEN: `MonthSelector` + `useSelectedMonth` (URL `?mes=`, `pushState`, `popstate`).
- [ ] 9.3 App wiring: one selected month for `Resumen`, `Análisis`, `Movimientos`; the list stops owning its own period.
- [ ] 9.4 `PlannedSection` renders `planned.movements` with the "Marcar pagado" action (the row action left the monthly table), keeping the existing `refreshToken` wiring.
- [ ] 9.5 Empty states name the selected month (`No hay movimientos en octubre`).
- [ ] 9.6 RED/GREEN: `App.test.tsx` — switching month re-queries KPIs and list together; reload keeps the month.
- [ ] 9.7 Verify (API + dashboard + typecheck + lint) and commit.
