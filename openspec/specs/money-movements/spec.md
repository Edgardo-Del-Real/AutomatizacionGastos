# Money Movements Specification

## Purpose

Full-stack money-movement tracking (expenses AND income). Extends the existing `Expense` model with a `type` discriminator, classifies inbound messages as income or expense, and exposes `/movements` + `/movements/summary` endpoints with ARS-only, Buenos-Aires-timezone aggregation, while keeping `/expenses*` backward compatible.

## Requirements

### Requirement: Movement Type Model

The system MUST store a `type` field on every movement (enum `EXPENSE` | `INCOME`) with default `EXPENSE`, and MUST preserve existing rows as `EXPENSE` when the migration applies. The system MUST NOT rename the table or model.

#### Scenario: Migration preserves existing rows

- GIVEN expenses exist before the migration
- WHEN the migration applies
- THEN all existing rows have `type=EXPENSE`

#### Scenario: Default on creation

- GIVEN a new movement is created without an explicit type
- WHEN it is persisted
- THEN it is stored as `EXPENSE`

### Requirement: Movement Contracts

`@rita/contracts` MUST export `movementSchema`, `listMovementsSchema`, `movementSummarySchema`, `createMovementSchema`, and `updateMovementSchema`. `updateMovementSchema` MUST make `amount`, `note`, and `category` all optional with at least one present. `category` MUST accept `null` (clears the category) or an owner category; an absent `category` MUST leave it unchanged. `amount`, when present, MUST be a positive number. The `expenseSchema` family MUST remain exported unchanged. Every movement API response MUST validate against these contracts.
(Previously: only `movementSchema`, `listMovementsSchema`, and `movementSummarySchema` were defined and category was free-form nullable.)

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

### Requirement: Message Income Detection

The system MUST classify an inbound message as `INCOME` when its normalized note matches any keyword (`ingreso|cobro|sueldo|venta|recibí|depósito`, case-insensitive) OR the amount is prefixed with `+`; otherwise it MUST classify as `EXPENSE`.
(Previously: "Webhook Income Detection" — wording was "The webhook MUST classify a message"; scenario triggers referenced the webhook transport.)

#### Scenario: Keyword match

- GIVEN message "Recibí $50000 de sueldo"
- WHEN the system processes the message
- THEN the movement type is `INCOME`

#### Scenario: Plus-prefixed amount

- GIVEN message "+5000" with no keyword
- WHEN the system processes the message
- THEN the movement type is `INCOME`

#### Scenario: No signal defaults to expense

- GIVEN message "$2000 supermercado"
- WHEN the system processes the message
- THEN the movement type is `EXPENSE`

#### Scenario: Ambiguous message is conservative

- GIVEN a message with money amounts but no income signal
- WHEN the system processes the message
- THEN the movement type is `EXPENSE` (no false income)

### Requirement: Movement List Endpoint

`GET /movements` MUST return `listMovementsSchema` — an array of movements for the `ownerId` owner ordered by `occurredAt` DESC — filtered by optional `type` (`EXPENSE`|`INCOME`), `from`/`to` date range on `occurredAt`, `category`, and `q` (case-insensitive note substring). Unknown owner or no matches MUST return an empty array. All currencies MUST appear (no currency filter).

#### Scenario: Combined filters

- GIVEN an owner with mixed movements
- WHEN `GET /movements?type=INCOME&from=2026-08-01&to=2026-08-31&q=venta`
- THEN only matching income movements return, newest first

#### Scenario: No matches

- GIVEN filters that match nothing
- THEN the endpoint returns an empty array (200), not an error

### Requirement: Movement Summary Endpoint

`GET /movements/summary` MUST return `movementSummarySchema` for the `ownerId` owner with optional `from`/`to` filters. Totals MUST include ONLY `ARS` movements; other currencies MUST NOT be mixed into totals. Month/day bucketing MUST use `America/Argentina/Buenos_Aires`. Shape:

```
kpis:        { income, expenses, balance, avgPerMonth, avgPerMovement, maxAmount, count }
mom:         { months: [{ month, income, expenses, balance }] }   // last 6 months
daily:       [{ day, income, expenses, balance }]                 // last 30 days, zero-filled
categories:  [{ name, expenseAmount, incomeAmount, expensePercent, incomePercent }]
top:         { expenses: [movement], income: [movement] }         // by amount desc
```

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

### Requirement: Expense Retrocompatibility

`/expenses*` endpoints MUST keep current behavior and response shapes, returning ONLY movements with `type=EXPENSE`.

#### Scenario: Income excluded from expenses

- GIVEN an owner with INCOME and EXPENSE movements
- WHEN `GET /expenses`
- THEN only EXPENSE rows return in `expenseSchema` shape

#### Scenario: Expense summary unchanged

- GIVEN `GET /expenses/summary`
- THEN the response matches `expenseSummarySchema` as before

### Requirement: Movement Update Endpoint

The system MUST provide `PATCH /movements/:id` scoped by owner (`x-owner-id`). It MUST update only the fields present per `updateMovementSchema`, MUST support both `EXPENSE` and `INCOME` movements, and MUST apply `category: null` by clearing the category and an absent field by leaving it unchanged. A category value MUST be validated against the owner's category set; an invalid category MUST return `422 ValidationFailedError`. A missing movement or one owned by another owner MUST return `404`.

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

### Requirement: Movement Delete Endpoint

The system MUST provide `DELETE /movements/:id` scoped by owner (`x-owner-id`). It MUST support both `EXPENSE` and `INCOME` movements. A missing movement or one owned by another owner MUST return `404`. Deleting a movement MUST update the dashboard list and KPIs after refresh.

#### Scenario: Delete income movement

- GIVEN an `INCOME` movement for the owner
- WHEN `DELETE /movements/:id` is called
- THEN the movement is deleted

#### Scenario: Delete expense movement

- GIVEN an `EXPENSE` movement for the owner
- WHEN `DELETE /movements/:id` is called
- THEN the movement is deleted

#### Scenario: Missing movement

- GIVEN no movement with that id for the owner
- WHEN `DELETE /movements/:id` is called
- THEN `404` is returned

#### Scenario: Another owner's movement

- GIVEN a movement owned by a different owner
- WHEN `DELETE /movements/:id` is called for the current owner
- THEN `404` is returned

### Requirement: Category Read Endpoint

The system MUST provide `GET /movements/categories` scoped by owner, returning the owner's category list (names and keyword rules). This endpoint MUST be the read source for the dashboard edit-form category dropdown. Unknown or empty owner MUST return an empty list.

#### Scenario: Owner categories returned

- GIVEN an owner with categories
- WHEN `GET /movements/categories` is called
- THEN all owner categories are returned

#### Scenario: Empty owner

- GIVEN an owner with no categories
- WHEN `GET /movements/categories` is called
- THEN an empty list is returned

### Requirement: Legacy Data Preservation

Existing movements with a `NULL` category or a legacy seed slug (e.g. "food", "other") MUST be left untouched by the categorization feature and MUST remain editable through the dashboard (PATCH may set a category on them). The learned category matcher MUST apply only to newly created bot messages.

#### Scenario: Null-category movement stays

- GIVEN an existing movement with `NULL` category
- WHEN the categorization feature activates
- THEN the movement is unchanged

#### Scenario: Legacy seed slug stays

- GIVEN an existing movement with category "food"
- WHEN the categorization feature activates
- THEN the movement is unchanged

#### Scenario: Legacy movement editable

- GIVEN an existing legacy movement
- WHEN the owner sets a category via PATCH
- THEN the category is set and the movement remains intact