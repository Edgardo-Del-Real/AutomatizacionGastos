# Money Movements Specification

## Purpose

Full-stack money-movement tracking (expenses AND income). Extends the existing `Expense` model with a `type` discriminator, classifies inbound messages as income or expense, and exposes `/movements` + `/movements/summary` endpoints with ARS-only, Buenos-Aires-timezone aggregation, while keeping `/expenses*` backward compatible.

## Requirements

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

`@rita/contracts` MUST export `movementSchema`, `listMovementsSchema`, `movementSummarySchema`, `createMovementSchema`, and `updateMovementSchema`. `updateMovementSchema` MUST make `amount`, `note`, and `category` all optional with at least one present. `category` MUST accept `null` (clears the category) or an owner category; an absent `category` MUST leave it unchanged. `amount`, when present, MUST be a positive number. The `expenseSchema` family MUST remain exported unchanged. Every movement API response MUST validate against these contracts. `movementTypeSchema` and `movementFiltersSchema.type` MUST accept `SAVINGS` in addition to `EXPENSE` and `INCOME`, so the list `type` filter supports SAVINGS. `movementSummarySchema` MUST include a current-calendar-month `savings` figure in `kpis` and per-month `savings` in `mom`. `movementStatusSchema` MUST be exported with values `PAID` and `PENDING`. `movementSchema` MUST include an optional `status` field. `createMovementSchema` MUST accept an optional `status`, and a `PENDING` status MUST be rejected for types other than `EXPENSE`. `updateMovementSchema` MUST NOT accept `status` or `occurredAt`; it stays `amount | note | category`. `movementSummarySchema` MUST include a `planned: { month, total }` block reporting the owner's next-month PENDING EXPENSE total. `movementSchema` MUST carry `visibility` (`INDIVIDUAL`|`SHARED`) and `registrantId` (the creating owner).
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

#### Scenario: Movement carries visibility and registrant

- GIVEN a persisted SHARED movement by Rita
- WHEN it is validated against `movementSchema`
- THEN it carries `visibility=SHARED` and `registrantId=rita`

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

`GET /movements` MUST return `listMovementsSchema` — an array of movements visible to the `ownerId` viewer (own movements plus the partner's SHARED ones, per the viewer-scoped predicate) ordered by `occurredAt` DESC — filtered by optional `type` (`EXPENSE`|`INCOME`|`SAVINGS`), `visibility` (`mine`|`shared`|`all`), `from`/`to` date range on `occurredAt`, `category`, and `q` (case-insensitive note substring). Unknown owner or no matches MUST return an empty array. All currencies MUST appear (no currency filter).
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

#### Scenario: Visibility filter applied

- GIVEN a viewer with own and partner SHARED movements
- WHEN `GET /movements?visibility=shared`
- THEN only SHARED movements visible to the viewer return

### Requirement: Movement Summary Endpoint

`GET /movements/summary` MUST return `movementSummarySchema` for the `ownerId` viewer scoped by the viewer predicate (own + partner SHARED) with optional `from`/`to` filters and the `visibility` filter (`mine`|`shared`|`all`). Totals MUST include ONLY `ARS` movements; other currencies MUST NOT be mixed into totals. Month/day bucketing MUST use `America/Argentina/Buenos_Aires`. SAVINGS movements MUST be excluded from income, expenses, balance, per-month/per-day buckets, category breakdowns, and top lists; `balance` MUST equal income − expenses with SAVINGS excluded. `kpis.savings` MUST report the current-calendar-month (Buenos Aires) sum of SAVINGS movements and `mom.months[].savings` MUST report per-month SAVINGS sums. PENDING movements MUST be excluded from income, expenses, balance, per-month/per-day buckets, category breakdowns, and top lists; `kpis.savings` MUST remain SAVINGS-only and unchanged by PENDING. The summary MUST include `planned: { month, total }`, the sum of the owner's PENDING EXPENSE movements targeted at the month following the current Buenos Aires month; the `planned` block MUST ignore `from`/`to`. Shape:

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

#### Scenario: Visibility filter feeds charts

- GIVEN a viewer with own and partner SHARED movements
- WHEN `GET /movements/summary?visibility=mine`
- THEN `categories`, `top`, and `kpis` derive only from the viewer's own movements

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

The system MUST provide `PATCH /movements/:id` scoped by owner (`x-owner-id`). It MUST update only the fields present per `updateMovementSchema`, MUST support `EXPENSE`, `INCOME`, and `SAVINGS` movements, and MUST apply `category: null` by clearing the category and an absent field by leaving it unchanged. A category value MUST be validated against the owner's category set; an invalid category MUST return `422 ValidationFailedError`. Assigning the owner's SAVINGS category ("ahorro") to an `EXPENSE` or `INCOME` movement MUST return `422 ValidationFailedError`. A missing movement, one owned by another owner, or a SHARED movement whose registrant is not the caller MUST return `404`. A partner MUST NOT update the registrant's movements.
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

### Requirement: Movement Delete Endpoint

The system MUST provide `DELETE /movements/:id` scoped by owner (`x-owner-id`). It MUST support both `EXPENSE` and `INCOME` movements. A missing movement, one owned by another owner, or a SHARED movement whose registrant is not the caller MUST return `404`. A partner MUST NOT delete the registrant's movements. Deleting a movement MUST update the dashboard list and KPIs after refresh.

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

#### Scenario: Partner cannot delete a SHARED movement

- GIVEN a SHARED movement registered by Rita and Edgardo as the caller
- WHEN `DELETE /movements/:id` is called
- THEN `404` is returned (registrant-only mutation)

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

### Requirement: Movement Visibility Model

The system MUST store a `visibility` field on every movement (enum `INDIVIDUAL` | `SHARED`) with default `INDIVIDUAL`, and MUST backfill all existing rows to `INDIVIDUAL` when the migration applies. A SHARED movement MUST be visible to its registrant owner AND the partner owner; an INDIVIDUAL movement MUST be visible only to its owner.

#### Scenario: Backfill preserves existing rows

- GIVEN movements exist before the migration
- WHEN the migration applies
- THEN every existing row has `visibility=INDIVIDUAL`

#### Scenario: Default on creation

- GIVEN a new movement created without an explicit visibility
- WHEN it is persisted
- THEN it is stored as `INDIVIDUAL`

#### Scenario: SHARED visible to both owners

- GIVEN a SHARED movement owned by Rita
- WHEN Edgardo queries his movements
- THEN the movement is included in Edgardo's results

### Requirement: Viewer-Scoped Read Predicate

All movement read queries MUST scope by viewer using the single predicate `ownerId = viewer OR (visibility = 'SHARED' AND ownerId = partnerOf(viewer))`. The SAME predicate fragment MUST be applied to all raw movement queries (list, summary, and chart feeds). When the viewer has no partner (single-user mode), the predicate MUST reduce to `ownerId = viewer`.

#### Scenario: Own movements always visible

- GIVEN a viewer with own INDIVIDUAL and SHARED movements
- WHEN the viewer queries
- THEN all own movements are returned

#### Scenario: Partner SHARED visible

- GIVEN Edgardo owns a SHARED movement and Rita is the viewer
- WHEN Rita queries
- THEN the movement is returned

#### Scenario: Partner INDIVIDUAL hidden

- GIVEN Edgardo owns an INDIVIDUAL movement and Rita is the viewer
- WHEN Rita queries
- THEN the movement is NOT returned (no cross-owner leak)

#### Scenario: Two-owner leak guard

- GIVEN a household with two owners
- WHEN integration tests exercise both directions
- THEN neither owner sees the other's INDIVIDUAL movements, and both see SHARED ones

### Requirement: Visibility Filter Parameter

`GET /movements` and `GET /movements/summary` MUST accept a `visibility` query parameter with values `mine` | `shared` | `all`. `mine` MUST return only movements owned by the viewer; `shared` MUST return only movements with `visibility=SHARED` visible to the viewer; `all` (default) MUST return own movements plus the partner's SHARED ones. The parameter MUST also drive the dashboard chart feeds (e.g. category breakdown).

#### Scenario: Mine filters to own

- GIVEN a viewer with own and partner SHARED movements
- WHEN `GET /movements?visibility=mine`
- THEN only the viewer's own movements return

#### Scenario: Shared filters to SHARED

- GIVEN the same movements
- WHEN `GET /movements?visibility=shared`
- THEN only SHARED movements visible to the viewer return

#### Scenario: All is the default

- GIVEN the same movements
- WHEN `GET /movements` with no visibility parameter
- THEN own movements plus partner SHARED return

#### Scenario: Invalid value rejected

- GIVEN `visibility=foo`
- WHEN the endpoint is called
- THEN a validation error is returned

### Requirement: Legacy Expense Endpoints Frozen

`/expenses*` endpoints MUST remain owner-scoped and MUST NOT apply the visibility model, the viewer predicate, or the visibility filter. Their behavior and response shapes MUST NOT change in this change. (Migration: none — behavior pinned to current owner-scoped semantics.)

#### Scenario: Expenses stay owner-scoped

- GIVEN a household with two owners and SHARED movements
- WHEN `GET /expenses` is called for Rita
- THEN only Rita's EXPENSE movements return, with no partner rows and no visibility changes

#### Scenario: Summary unchanged

- GIVEN `GET /expenses/summary` for an owner
- THEN the response matches `expenseSummarySchema` exactly as before