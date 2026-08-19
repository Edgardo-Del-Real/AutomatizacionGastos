# Money Movements Specification

## Purpose

Full-stack money-movement tracking (expenses AND income). Extends the existing `Expense` model with a `type` discriminator, classifies webhook messages as income or expense, and exposes `/movements` + `/movements/summary` endpoints with ARS-only, Buenos-Aires-timezone aggregation, while keeping `/expenses*` backward compatible.

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

`@rita/contracts` MUST export `movementSchema` (existing `expenseSchema` fields plus `type: z.enum(["EXPENSE","INCOME"])`), `listMovementsSchema`, and `movementSummarySchema`. The `expenseSchema` family MUST remain exported unchanged. Every movement API response MUST validate against these contracts.

#### Scenario: Type validation

- GIVEN a payload with `type="INCOME"`
- WHEN validated against `movementSchema`
- THEN it passes
- AND a payload with `type="SAVINGS"` MUST fail validation

#### Scenario: Expense contracts unchanged

- GIVEN code importing `expenseSchema`
- WHEN contracts rebuild
- THEN its shape is unchanged

### Requirement: Webhook Income Detection

The webhook MUST classify a message as `INCOME` when its normalized note matches any keyword (`ingreso|cobro|sueldo|venta|recibí|depósito`, case-insensitive) OR the amount is prefixed with `+`; otherwise it MUST classify as `EXPENSE`.

#### Scenario: Keyword match

- GIVEN message "Recibí $50000 de sueldo"
- WHEN the webhook processes it
- THEN the movement type is `INCOME`

#### Scenario: Plus-prefixed amount

- GIVEN message "+5000" with no keyword
- WHEN the webhook processes it
- THEN the movement type is `INCOME`

#### Scenario: No signal defaults to expense

- GIVEN message "$2000 supermercado"
- WHEN the webhook processes it
- THEN the movement type is `EXPENSE`

#### Scenario: Ambiguous message is conservative

- GIVEN a message with money amounts but no income signal
- WHEN the webhook processes it
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
