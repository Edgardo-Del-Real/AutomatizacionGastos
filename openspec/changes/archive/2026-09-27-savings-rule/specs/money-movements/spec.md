# Delta for Money Movements

## MODIFIED Requirements

### Requirement: Movement Type Model

The system MUST store a `type` field on every movement (enum `EXPENSE` | `INCOME` | `SAVINGS`) with default `EXPENSE`, and MUST preserve existing rows as `EXPENSE` when the migration applies. The system MUST NOT rename the table or model.
(Previously: enum was `EXPENSE | INCOME` only.)

#### Scenario: Migration preserves existing rows

- GIVEN expenses exist before the migration
- WHEN the migration applies
- THEN all existing rows have `type=EXPENSE`

#### Scenario: Default on creation

- GIVEN a new movement is created without an explicit type
- WHEN it is persisted
- THEN it is stored as `EXPENSE`

#### Scenario: SAVINGS type stored

- GIVEN a savings split
- WHEN the SAVINGS movement is persisted
- THEN its type is `SAVINGS`

### Requirement: Movement Contracts

`@rita/contracts` MUST export `movementSchema`, `listMovementsSchema`, `movementSummarySchema`, `createMovementSchema`, and `updateMovementSchema`. `updateMovementSchema` MUST make `amount`, `note`, and `category` all optional with at least one present. `category` MUST accept `null` (clears the category) or an owner category; an absent `category` MUST leave it unchanged. `amount`, when present, MUST be a positive number. The `expenseSchema` family MUST remain exported unchanged. Every movement API response MUST validate against these contracts. `movementTypeSchema` and `movementFiltersSchema.type` MUST accept `SAVINGS` in addition to `EXPENSE` and `INCOME`, so the list `type` filter supports SAVINGS. `movementSummarySchema` MUST include a current-calendar-month `savings` figure in `kpis` and per-month `savings` in `mom`.
(Previously: only `movementSchema`, `listMovementsSchema`, and `movementSummarySchema` were defined, category was free-form nullable, and the type enum had no SAVINGS.)

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

### Requirement: Movement List Endpoint

`GET /movements` MUST return `listMovementsSchema` — an array of movements for the `ownerId` owner ordered by `occurredAt` DESC — filtered by optional `type` (`EXPENSE`|`INCOME`|`SAVINGS`), `from`/`to` date range on `occurredAt`, `category`, and `q` (case-insensitive note substring). Unknown owner or no matches MUST return an empty array. All currencies MUST appear (no currency filter).
(Previously: the `type` filter accepted only `EXPENSE`|`INCOME`.)

#### Scenario: Combined filters

- GIVEN an owner with mixed movements
- WHEN `GET /movements?type=INCOME&from=2026-08-01&to=2026-08-31&q=venta`
- THEN only matching income movements return, newest first

#### Scenario: No matches

- GIVEN filters that match nothing
- THEN the endpoint returns an empty array (200), not an error

#### Scenario: SAVINGS filter

- GIVEN an owner with SAVINGS and other movements
- WHEN `GET /movements?type=SAVINGS`
- THEN only SAVINGS movements return, newest first

### Requirement: Movement Summary Endpoint

`GET /movements/summary` MUST return `movementSummarySchema` for the `ownerId` owner with optional `from`/`to` filters. Totals MUST include ONLY `ARS` movements; other currencies MUST NOT be mixed into totals. Month/day bucketing MUST use `America/Argentina/Buenos_Aires`. SAVINGS movements MUST be excluded from income, expenses, balance, per-month/per-day buckets, category breakdowns, and top lists; `balance` MUST equal income − expenses with SAVINGS excluded. `kpis.savings` MUST report the current-calendar-month (Buenos Aires) sum of SAVINGS movements and `mom.months[].savings` MUST report per-month SAVINGS sums. Shape:

```
kpis:        { income, expenses, balance, savings, avgPerMonth, avgPerMovement, maxAmount, count }
mom:         { months: [{ month, income, expenses, balance, savings }] }   // last 6 months
daily:       [{ day, income, expenses, balance }]                 // last 30 days, zero-filled
categories:  [{ name, expenseAmount, incomeAmount, expensePercent, incomePercent }]
top:         { expenses: [movement], income: [movement] }         // by amount desc
```

(Previously: SAVINGS did not exist and `kpis`/`mom` had no `savings` fields.)

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

### Requirement: Movement Update Endpoint

The system MUST provide `PATCH /movements/:id` scoped by owner (`x-owner-id`). It MUST update only the fields present per `updateMovementSchema`, MUST support `EXPENSE`, `INCOME`, and `SAVINGS` movements, and MUST apply `category: null` by clearing the category and an absent field by leaving it unchanged. A category value MUST be validated against the owner's category set; an invalid category MUST return `422 ValidationFailedError`. Assigning the owner's SAVINGS category ("ahorro") to an `EXPENSE` or `INCOME` movement MUST return `422 ValidationFailedError`. A missing movement or one owned by another owner MUST return `404`.
(Previously: PATCH supported only `EXPENSE` and `INCOME`, and the SAVINGS category did not exist.)

#### Scenario: Update note only

- GIVEN an owner movement
- WHEN `PATCH /movements/:id` is called with `{ note: "cena" }`
- THEN the note updates and amount and category are unchanged

#### Scenario: Clear category

- GIVEN a movement with a category
- WHEN `PATCH /movements/:id` is called with `{ category: null }`
- THEN the category is cleared

#### Scenario: Set valid category

- GIVEN a movement and an owner category
- WHEN `PATCH /movements/:id` is called with `{ category: "<category>" }`
- THEN the category is set

#### Scenario: Invalid category

- GIVEN a movement and a category not belonging to the owner
- WHEN `PATCH /movements/:id` is called with it
- THEN a `422 ValidationFailedError` is returned

#### Scenario: Update income movement

- GIVEN an `INCOME` movement
- WHEN `PATCH /movements/:id` is called with a valid patch
- THEN the income movement updates

#### Scenario: Missing movement

- GIVEN no movement with that id for the owner
- WHEN `PATCH /movements/:id` is called
- THEN `404` is returned

#### Scenario: Another owner's movement

- GIVEN a movement owned by a different owner
- WHEN `PATCH /movements/:id` is called for the current owner
- THEN `404` is returned

#### Scenario: SAVINGS category rejected on income/expense

- GIVEN an `EXPENSE` or `INCOME` movement and the owner's "ahorro" category
- WHEN `PATCH /movements/:id` is called with `{ category: "ahorro" }`
- THEN a `422 ValidationFailedError` is returned and the category is not set