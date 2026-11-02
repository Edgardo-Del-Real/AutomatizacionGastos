# Delta for Money Movements

## MODIFIED Requirements

### Requirement: Movement Summary Endpoint

`GET /movements/summary` MUST return `movementSummarySchema` for the `ownerId` viewer scoped by the viewer predicate (own + partner SHARED). The period MUST be expressed as a single optional `month` key (`YYYY-MM`); the endpoint MUST reject any other shape with `422` and MUST NOT accept free `from`/`to` dates. When `month` is present the endpoint MUST scope `kpis`, `daily`, `categories` and `top` to that Buenos Aires calendar month (1st to last day, `America/Argentina/Buenos_Aires`). When `month` is absent the endpoint MUST return lifetime totals for the same blocks and an empty `daily` array. Totals MUST include ONLY `ARS` movements; other currencies MUST NOT be mixed into totals. SAVINGS movements MUST be excluded from income, expenses, per-day buckets, category breakdowns, and top lists; `balance` MUST equal income − expenses − manual savings over the requested period, where `kpis.manualSavings` MUST report the sum of `savingsOrigin = MANUAL` SAVINGS movements in that same period. `kpis.savings` MUST report the sum of ALL SAVINGS movements (auto + manual) in the requested period. PENDING movements MUST be excluded from income, expenses, balance, per-day buckets, category breakdowns, and top lists. The summary MUST include `planned: { total, movements }` — the ARS sum and the pending rows of the owner's outstanding PENDING EXPENSE movements — and that block MUST ignore `month`. `mom` and `countThisMonth` MUST NOT be emitted. Shape:

```
kpis:        { income, expenses, balance, savings, manualSavings, avgPerMonth, avgPerMovement, maxAmount, count }
daily:       [{ day, income, expenses, balance }]                 // every day of the requested month, zero-filled
categories:  [{ name, expenseAmount, incomeAmount, expensePercent, incomePercent }]
top:         { expenses: [movement], income: [movement] }         // by amount desc
planned:     { total, movements }                                 // outstanding PENDING EXPENSE rows (no date)
```

(Previously: the period was an optional `from`/`to` pair, `kpis.savings` was pinned to the current calendar month regardless of the request, `daily` was always the last 30 days, the payload carried `mom: { months }` and `kpis.countThisMonth`, and `planned` was `{ month, total }`.)

#### Scenario: Month-scoped KPIs

- GIVEN INCOME 900 in 2026-10 and INCOME 400 in 2026-11
- WHEN the summary is requested with `month=2026-10`
- THEN `kpis.income` is 900 and `kpis.balance` is the October net

#### Scenario: Lifetime totals without month

- GIVEN INCOME 900 in October and INCOME 400 in November
- WHEN the summary is requested with no `month`
- THEN `kpis.income` is 1300 and `daily` is empty

#### Scenario: Invalid month key

- GIVEN `month=2026-13`
- WHEN the summary is requested
- THEN the API responds `422` with the validation envelope

#### Scenario: Daily series follows the requested month

- GIVEN `month=2026-02` (28 days)
- WHEN the summary is requested
- THEN `daily` has exactly 28 zero-filled days ending 2026-02-28

#### Scenario: Buenos Aires bucketing

- GIVEN `occurredAt` 2026-08-01T02:59:00Z (= 2026-07-31 23:59 in Buenos Aires)
- WHEN the summary is requested with `month=2026-07`
- THEN the movement is included, and it is absent from `month=2026-08`

#### Scenario: Savings reported for the requested month

- GIVEN SAVINGS 100 and 50 in 2026-10 and SAVINGS 200 in 2026-11
- WHEN the summary is requested with `month=2026-10`
- THEN `kpis.savings` is 150

#### Scenario: PENDING excluded from sums

- GIVEN INCOME 900, EXPENSE 300, and a PENDING EXPENSE 2500
- WHEN the summary is requested with `month=2026-11`
- THEN income = 900, expenses = 300, balance = 600, and 2500 appears only in `planned.total`

#### Scenario: planned ignores the month

- GIVEN a PENDING expense loaded two months ago and never paid
- WHEN the summary is requested with any `month`
- THEN `planned.total` still reports it

### Requirement: Movement List Endpoint

`GET /movements` MUST return `listMovementsSchema` - an array of movements visible to the `ownerId` viewer (own movements plus the partner's SHARED ones, per the viewer-scoped predicate) ordered by `occurredAt` DESC - filtered by optional `type` (`EXPENSE`|`INCOME`|`SAVINGS`), `visibility` (`mine`|`shared`|`all`), `month` (`YYYY-MM`) on `occurredAt`, `category`, and `q` (case-insensitive note substring). `month` MUST be validated with the same rule as the summary and MUST reject anything else with `422`. Unknown owner or no matches MUST return an empty array. All currencies MUST appear (no currency filter).

(Previously: the period was a free `from`/`to` date range.)

#### Scenario: Month-scoped list

- GIVEN movements in October and November
- WHEN `GET /movements?month=2026-10` is called
- THEN only October movements return, newest first

#### Scenario: Combined filters

- GIVEN an owner with mixed movements
- WHEN `GET /movements?type=INCOME&month=2026-08&q=venta`
- THEN only matching income movements return, newest first

#### Scenario: No matches

- GIVEN filters that match nothing
- THEN the endpoint returns an empty array (200), not an error

#### Scenario: SAVINGS filter

- GIVEN an owner with SAVINGS and other movements
- WHEN `GET /movements?type=SAVINGS`
- THEN only SAVINGS movements return, newest first

### Requirement: Movement List Excludes Planned Rows

`GET /movements` MUST NOT return PENDING rows: a previsto carries no date of its own, so it cannot belong to a month. The outstanding PENDING total MUST remain available only through `summary.planned`, and the PENDING rows themselves MUST remain reachable through the mark-paid candidates and the repository's owner-scoped reads.

(Previously: `GET /movements` returned PENDING rows like any other movement and applied no status filter, because the dashboard read planned rows from the list.)

#### Scenario: PENDING not returned in the month list

- GIVEN an owner with a PENDING movement
- WHEN `GET /movements?month=2026-11` is called
- THEN the PENDING row is absent and the paid movements are returned

#### Scenario: planned total still exposes the previsto

- GIVEN the same owner
- WHEN `GET /movements/summary?month=2026-11` is called
- THEN `planned.total` includes the PENDING amount
