# Delta for Money Movements

## MODIFIED Requirements

### Requirement: Movement Contracts

`@rita/contracts` MUST export `movementSchema`, `listMovementsSchema`, `movementSummarySchema`, `createMovementSchema`, and `updateMovementSchema`. `updateMovementSchema` MUST make `amount`, `note`, and `category` all optional with at least one present. `category` MUST accept `null` (clears the category) or an owner category; an absent `category` MUST leave it unchanged. `amount`, when present, MUST be a positive number. The `expenseSchema` family MUST remain exported unchanged. Every movement API response MUST validate against these contracts. `movementTypeSchema` and `movementFiltersSchema.type` MUST accept `SAVINGS` in addition to `EXPENSE` and `INCOME`, so the list `type` filter supports SAVINGS. `movementSummarySchema` MUST include a current-calendar-month `savings` figure in `kpis` and per-month `savings` in `mom`. `movementStatusSchema` MUST be exported with values `PAID` and `PENDING`. `movementSchema` MUST include an optional `status` field. `createMovementSchema` MUST accept an optional `status`, and a `PENDING` status MUST be rejected for types other than `EXPENSE`. `updateMovementSchema` MUST NOT accept `status` or `occurredAt`; it stays `amount | note | category`. `movementSummarySchema` MUST include a `planned: { month, total }` block reporting the owner's next-month PENDING EXPENSE total. `movementSchema` MUST carry `visibility` (`INDIVIDUAL`|`SHARED`) and `registrantId` (the creating owner). `movementSchema` MUST carry an optional nullable `savingsOrigin` (`AUTO_SPLIT`|`MANUAL`), additive after the `sharedTotal` precedent: legacy rows MUST validate without it and the movements read path MUST return it. `createMovementSchema` MUST accept an optional `savingsOrigin`; on a `SAVINGS` create it MUST be absent (the server stamps `MANUAL`) or `MANUAL`, and `AUTO_SPLIT` MUST fail validation.
(Previously: `movementSchema`/`createMovementSchema` carried no `savingsOrigin`.)

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

#### Scenario: Movement carries visibility and registrant

- GIVEN a persisted SHARED movement by Rita
- WHEN it is validated against `movementSchema`
- THEN it carries `visibility=SHARED` and `registrantId=rita`

#### Scenario: savingsOrigin carried on movements

- GIVEN a persisted AUTO_SPLIT SAVINGS row
- WHEN it is validated against `movementSchema`
- THEN it carries `savingsOrigin="AUTO_SPLIT"`

#### Scenario: Legacy row omits savingsOrigin

- GIVEN a pre-existing SAVINGS row
- WHEN it is validated against `movementSchema`
- THEN it validates and `savingsOrigin` is absent or null

#### Scenario: AUTO_SPLIT create rejected

- GIVEN a create payload with `type: "SAVINGS"` and `savingsOrigin: "AUTO_SPLIT"`
- WHEN validated against `createMovementSchema`
- THEN it fails validation (auto-split rows are internal-only)

#### Scenario: MANUAL create accepted

- GIVEN a create payload with `type: "SAVINGS"` and no `savingsOrigin`
- WHEN validated against `createMovementSchema`
- THEN it passes and the server stamps `MANUAL`

### Requirement: Movement Summary Endpoint

`GET /movements/summary` MUST return `movementSummarySchema` for the `ownerId` viewer scoped by the viewer predicate (own + partner SHARED) with optional `from`/`to` filters and the `visibility` filter (`mine`|`shared`|`all`). Totals MUST include ONLY `ARS` movements; other currencies MUST NOT be mixed into totals. Month/day bucketing MUST use `America/Argentina/Buenos_Aires`. SAVINGS movements MUST be excluded from income, expenses, per-month/per-day buckets, category breakdowns, and top lists; `balance` MUST equal income − expenses − manual savings, where `kpis.manualSavings` MUST report the sum of `savingsOrigin = MANUAL` SAVINGS movements within the requested `from`/`to` period (viewer-scoped, ARS) and `balance` MUST deduct it. `kpis.savings` MUST report the current-calendar-month (Buenos Aires) sum of ALL SAVINGS movements (auto + manual) and `mom.months[].savings` MUST report per-month SAVINGS sums; both MUST remain unchanged. PENDING movements MUST be excluded from income, expenses, balance, per-month/per-day buckets, category breakdowns, and top lists; `kpis.savings` MUST remain SAVINGS-only and unchanged by PENDING. `mom`/`daily`/`categories`/`top`/`planned` MUST NOT change: manual savings do not appear in trend buckets (documented limitation). The summary MUST include `planned: { month, total }`, the sum of the owner's outstanding PENDING EXPENSE movements (previstos carry no planned date; `month` is the informational next-month key); the `planned` block MUST ignore `from`/`to`. Shape:

```
kpis:        { income, expenses, balance, savings, manualSavings, avgPerMonth, avgPerMovement, maxAmount, count }
mom:         { months: [{ month, income, expenses, balance, savings }] }   // last 6 months
daily:       [{ day, income, expenses, balance }]                 // last 30 days, zero-filled
categories:  [{ name, expenseAmount, incomeAmount, expensePercent, incomePercent }]
top:         { expenses: [movement], income: [movement] }         // by amount desc
planned:     { month, total }                                     // outstanding PENDING EXPENSE total (no planned date)
```

(Previously: `kpis` had no `manualSavings`, and `balance` did not deduct manual savings.)

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
- THEN `planned` still reports the outstanding total

#### Scenario: planned empty

- GIVEN no PENDING EXPENSE
- WHEN the summary is requested
- THEN `planned.total` is 0

#### Scenario: Visibility filter feeds charts

- GIVEN a viewer with own and partner SHARED movements
- WHEN `GET /movements/summary?visibility=mine`
- THEN `categories`, `top`, and `kpis` derive only from the viewer's own movements

#### Scenario: Manual savings deduct within the period

- GIVEN MANUAL SAVINGS 50 this month and MANUAL SAVINGS 30 last month
- WHEN the summary is requested for `from`/`to` limited to this month
- THEN `kpis.manualSavings` is 50 and `balance` = income − expenses − 50

#### Scenario: Mixed month totals

- GIVEN gross 1000 split into INCOME 900 and AUTO_SPLIT SAVINGS 100, EXPENSE 300, and MANUAL SAVINGS 50
- WHEN the summary is requested
- THEN income = 900, expenses = 300, balance = 550, `kpis.manualSavings` = 50, and `kpis.savings` = 150

#### Scenario: No manual savings keeps history identical

- GIVEN only legacy (NULL origin) rows
- WHEN the summary is requested
- THEN `kpis.manualSavings` is 0 and `balance` matches the pre-change value exactly

#### Scenario: Manual savings follow the viewer predicate

- GIVEN a household where the partner holds an INDIVIDUAL MANUAL SAVINGS
- WHEN the viewer requests the summary
- THEN the partner's row is excluded from `kpis.manualSavings` and `balance`

### Requirement: Movement Update Endpoint

The system MUST provide `PATCH /movements/:id` scoped by owner (`x-owner-id`). It MUST update only the fields present per `updateMovementSchema`, MUST support `EXPENSE`, `INCOME`, and `SAVINGS` movements, and MUST apply `category: null` by clearing the category and an absent field by leaving it unchanged. A category value MUST be validated against the owner's category set; an invalid category MUST return `422 ValidationFailedError`. Assigning the owner's SAVINGS category ("ahorro") to an `EXPENSE` or `INCOME` movement MUST return `422 ValidationFailedError`. On a SAVINGS movement with `savingsOrigin = MANUAL`, a patch whose `category` differs from "ahorro" — including `null` — MUST return `422 ValidationFailedError` and MUST NOT change the row; `amount` and `note` MAY be patched on MANUAL rows (balance recomputes). AUTO_SPLIT and legacy SAVINGS rows MUST keep the existing category freedom. A missing movement, one owned by another owner, or a SHARED movement whose registrant is not the caller MUST return `404`. A partner MUST NOT update the registrant's movements.
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

#### Scenario: Partner cannot update a SHARED movement

- GIVEN a SHARED movement registered by Rita and Edgardo as the caller
- WHEN `PATCH /movements/:id` is called
- THEN `404` is returned (registrant-only mutation)

#### Scenario: SAVINGS category rejected on income/expense

- GIVEN an `EXPENSE` or `INCOME` movement and the owner's "ahorro" category
- WHEN `PATCH /movements/:id` is called with `{ category: "ahorro" }`
- THEN a `422 ValidationFailedError` is returned and the category is not set

#### Scenario: MANUAL category drift rejected

- GIVEN a MANUAL SAVINGS row in "ahorro"
- WHEN `PATCH /movements/:id` is called with `{ category: "bolsillo" }`
- THEN a `422 ValidationFailedError` is returned and the row is unchanged

#### Scenario: MANUAL category null rejected

- GIVEN a MANUAL SAVINGS row in "ahorro"
- WHEN `PATCH /movements/:id` is called with `{ category: null }`
- THEN a `422 ValidationFailedError` is returned and the row is unchanged

#### Scenario: MANUAL amount edit allowed

- GIVEN a MANUAL SAVINGS of 50
- WHEN `PATCH /movements/:id` is called with `{ amount: 80 }`
- THEN the amount becomes 80 and balance recomputes (80 now deducts)

#### Scenario: AUTO_SPLIT freedom kept

- GIVEN an AUTO_SPLIT SAVINGS row
- WHEN `PATCH /movements/:id` is called with an owner category as before
- THEN the patch applies exactly as before the change