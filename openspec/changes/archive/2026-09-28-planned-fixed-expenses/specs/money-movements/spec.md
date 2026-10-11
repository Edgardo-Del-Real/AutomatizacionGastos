# Delta for Money Movements

## MODIFIED Requirements

### Requirement: Movement Contracts

`@rita/contracts` MUST export `movementSchema`, `listMovementsSchema`, `movementSummarySchema`, `createMovementSchema`, and `updateMovementSchema`. `updateMovementSchema` MUST make `amount`, `note`, and `category` all optional with at least one present. `category` MUST accept `null` (clears the category) or an owner category; an absent `category` MUST leave it unchanged. `amount`, when present, MUST be a positive number. The `expenseSchema` family MUST remain exported unchanged. Every movement API response MUST validate against these contracts. `movementTypeSchema` and `movementFiltersSchema.type` MUST accept `SAVINGS` in addition to `EXPENSE` and `INCOME`, so the list `type` filter supports SAVINGS. `movementSummarySchema` MUST include a current-calendar-month `savings` figure in `kpis` and per-month `savings` in `mom`. `movementStatusSchema` MUST be exported with values `PAID` and `PENDING`. `movementSchema` MUST include an optional `status` field. `createMovementSchema` MUST accept an optional `status`, and a `PENDING` status MUST be rejected for types other than `EXPENSE`. `updateMovementSchema` MUST NOT accept `status` or `occurredAt`; it stays `amount | note | category`. `movementSummarySchema` MUST include a `planned: { month, total }` block reporting the owner's next-month PENDING EXPENSE total.
(Previously: only `movementSchema`, `listMovementsSchema`, and `movementSummarySchema` were defined, category was free-form nullable, and no status or planned concepts existed.)

#### Scenario: Update schema optional fields

- GIVEN a payload with only `note`
- WHEN validated against `updateMovementSchema`
- THEN it passes and other fields are unchanged

#### Scenario: Null clears category

- GIVEN a payload with `category: null`
- WHEN validated against `updateMovementSchema`
- THEN it passes and represents clearing the category

#### Scenario: Invalid category rejected

- GIVEN a payload whose `category` is not an owner category and not null
- WHEN validated against `updateMovementSchema`
- THEN it fails validation

#### Scenario: Non-positive amount rejected

- GIVEN a payload with `amount: 0`
- WHEN validated against `updateMovementSchema`
- THEN it fails validation

#### Scenario: Empty patch rejected

- GIVEN a payload with no recognized fields
- WHEN validated against `updateMovementSchema`
- THEN it fails validation

#### Scenario: Expense contracts unchanged

- GIVEN code importing `expenseSchema`
- WHEN contracts rebuild
- THEN its shape is unchanged

#### Scenario: SAVINGS accepted by the list filter

- GIVEN `movementFiltersSchema.type`
- WHEN validated with `"SAVINGS"`
- THEN it passes

#### Scenario: Status schema exported

- GIVEN `movementStatusSchema`
- WHEN validated with `"PENDING"` and `"PAID"`
- THEN both pass

#### Scenario: PENDING rejected for non-expense create

- GIVEN a create payload with `type: "INCOME"` and `status: "PENDING"`
- WHEN validated against `createMovementSchema`
- THEN it fails validation

#### Scenario: Status patch rejected

- GIVEN a payload with only `status`
- WHEN validated against `updateMovementSchema`
- THEN it fails validation (empty patch)

### Requirement: Movement Summary Endpoint

`GET /movements/summary` MUST return `movementSummarySchema` for the `ownerId` owner with optional `from`/`to` filters. Totals MUST include ONLY `ARS` movements; other currencies MUST NOT be mixed into totals. Month/day bucketing MUST use `America/Argentina/Buenos_Aires`. SAVINGS movements MUST be excluded from income, expenses, balance, per-month/per-day buckets, category breakdowns, and top lists; `balance` MUST equal income − expenses with SAVINGS excluded. `kpis.savings` MUST report the current-calendar-month (Buenos Aires) sum of SAVINGS movements and `mom.months[].savings` MUST report per-month SAVINGS sums. PENDING movements MUST be excluded from income, expenses, balance, per-month/per-day buckets, category breakdowns, and top lists; `kpis.savings` MUST remain SAVINGS-only and unchanged by PENDING. The summary MUST include `planned: { month, total }`, the sum of the owner's PENDING EXPENSE movements targeted at the month following the current Buenos Aires month; the `planned` block MUST ignore `from`/`to`. Shape:

```
kpis:        { income, expenses, balance, savings, avgPerMonth, avgPerMovement, maxAmount, count }
mom:         { months: [{ month, income, expenses, balance, savings }] }   // last 6 months
daily:       [{ day, income, expenses, balance }]                 // last 30 days, zero-filled
categories:  [{ name, expenseAmount, incomeAmount, expensePercent, incomePercent }]
top:         { expenses: [movement], income: [movement] }         // by amount desc
planned:     { month, total }                                     // next month, PENDING EXPENSE only
```

(Previously: SAVINGS did not exist, `kpis`/`mom` had no `savings` fields, and the summary had no `planned` block or PENDING exclusion.)

#### Scenario: ARS-only totals

- GIVEN movements of ARS 1000 and USD 500
- WHEN the summary is requested
- THEN `balance` is 1000 and the USD amount is excluded from all totals

#### Scenario: Buenos Aires bucketing

- GIVEN `occurredAt` 2026-08-01T02:59:00Z (= 2026-07-31 23:59 in Buenos Aires)
- WHEN the summary is requested
- THEN the movement is bucketed to July, not August

#### Scenario: No data

- GIVEN an owner with no movements
- WHEN the summary is requested
- THEN kpis are zeros, `daily` is zero-filled, and `categories` is empty

#### Scenario: Month comparison

- GIVEN movements in June and July 2026
- WHEN the summary is requested
- THEN `mom.months` contains both months with per-month income, expenses, and balance

#### Scenario: Savings excluded from sums

- GIVEN INCOME 900, SAVINGS 100, and EXPENSE 300
- WHEN the summary is requested
- THEN income = 900, expenses = 300, balance = 600, and SAVINGS appear in no bucket or top list

#### Scenario: Savings reported month-scoped

- GIVEN SAVINGS 100 and 50 in the current month and 200 in a prior month
- WHEN the summary is requested
- THEN `kpis.savings` is 150 and `mom` reports each month's own savings

#### Scenario: PENDING excluded from sums

- GIVEN INCOME 900, EXPENSE 300, and a PENDING EXPENSE 2500
- WHEN the summary is requested
- THEN income = 900, expenses = 300, balance = 600, and 2500 appears only in `planned`

#### Scenario: SAVINGS column survives PENDING exclusion

- GIVEN SAVINGS 100 this month and a PENDING EXPENSE 2500
- WHEN the summary is requested
- THEN `mom.months[].savings` is 100 and `planned.total` is 2500

#### Scenario: planned ignores date filters

- GIVEN `from`/`to` limited to the current month
- WHEN the summary is requested
- THEN `planned` still reports the next-month total

#### Scenario: planned empty

- GIVEN no PENDING EXPENSE
- WHEN the summary is requested
- THEN `planned.total` is 0

## ADDED Requirements

### Requirement: Movement List Includes Planned Rows

`GET /movements` MUST return PENDING rows like any other movement and MUST NOT apply any status filter; the dashboard reads planned rows from the list.

#### Scenario: PENDING returned in the list

- GIVEN an owner with a PENDING movement
- WHEN `GET /movements` is called
- THEN the PENDING row is returned, newest first

#### Scenario: no status filter

- GIVEN the list query supports optional filters
- WHEN `GET /movements` is called
- THEN no status parameter filters rows

### Requirement: Planned Movement Editing

`PATCH /movements/:id` MUST support PENDING EXPENSE rows exactly as PAID ones: only `amount`, `note`, and `category` MAY change, and the amount MUST be editable while the movement is PENDING. `occurredAt` and `status` MUST NOT be editable through PATCH; only the mark-paid transition rewrites them.

#### Scenario: edit a pending amount

- GIVEN a PENDING EXPENSE of 2500
- WHEN `PATCH /movements/:id` is called with `{ amount: 2600 }`
- THEN the amount becomes 2600 and the status stays PENDING

#### Scenario: occurredAt not editable

- GIVEN a payload with `occurredAt`
- WHEN validated against `updateMovementSchema`
- THEN it fails validation and no field changes