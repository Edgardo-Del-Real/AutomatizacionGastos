# Delta for Money Movements

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Movement Contracts

`@rita/contracts` MUST export `movementSchema`, `listMovementsSchema`, `movementSummarySchema`, `createMovementSchema`, and `updateMovementSchema`. `updateMovementSchema` MUST make `amount`, `note`, and `category` all optional with at least one present. `category` MUST accept `null` (clears the category) or an owner category; an absent `category` MUST leave it unchanged. `amount`, when present, MUST be a positive number. `movementSchema` MUST carry `visibility` (`INDIVIDUAL`|`SHARED`) and `registrantId` (the creating owner). The `expenseSchema` family MUST remain exported unchanged. Every movement API response MUST validate against these contracts.
(Previously: movement schema carried no visibility and no registrantId.)

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

#### Scenario: Movement carries visibility and registrant

- GIVEN a persisted SHARED movement by Rita
- WHEN it is validated against `movementSchema`
- THEN it carries `visibility=SHARED` and `registrantId=rita`

#### Scenario: Expense contracts unchanged

- GIVEN code importing `expenseSchema`
- WHEN contracts rebuild
- THEN its shape is unchanged

### Requirement: Movement List Endpoint

`GET /movements` MUST return `listMovementsSchema` — an array of movements visible to the `ownerId` viewer (own movements plus the partner's SHARED ones, per the viewer-scoped predicate) ordered by `occurredAt` DESC — filtered by optional `type` (`EXPENSE`|`INCOME`), `visibility` (`mine`|`shared`|`all`), `from`/`to` date range on `occurredAt`, `category`, and `q` (case-insensitive note substring). Unknown owner or no matches MUST return an empty array. All currencies MUST appear (no currency filter).
(Previously: returned only the owner's own movements with no visibility filter.)

#### Scenario: Combined filters

- GIVEN a viewer with mixed movements
- WHEN `GET /movements?type=INCOME&from=2026-08-01&to=2026-08-31&q=venta`
- THEN only matching income movements return, newest first

#### Scenario: No matches

- GIVEN filters that match nothing
- THEN the endpoint returns an empty array (200), not an error

#### Scenario: Visibility filter applied

- GIVEN a viewer with own and partner SHARED movements
- WHEN `GET /movements?visibility=shared`
- THEN only SHARED movements visible to the viewer return

### Requirement: Movement Summary Endpoint

`GET /movements/summary` MUST return `movementSummarySchema` for the `ownerId` viewer scoped by the viewer predicate (own + partner SHARED) with optional `from`/`to` filters and the `visibility` filter (`mine`|`shared`|`all`). Totals MUST include ONLY `ARS` movements; other currencies MUST NOT be mixed into totals. Month/day bucketing MUST use `America/Argentina/Buenos_Aires`. Shape:

```
kpis:        { income, expenses, balance, avgPerMonth, avgPerMovement, maxAmount, count }
mom:         { months: [{ month, income, expenses, balance }] }   // last 6 months
daily:       [{ day, income, expenses, balance }]                 // last 30 days, zero-filled
categories:  [{ name, expenseAmount, incomeAmount, expensePercent, incomePercent }]
top:         { expenses: [movement], income: [movement] }         // by amount desc
```

(Previously: summary covered only the owner's own movements.)

#### Scenario: ARS-only totals

- GIVEN movements of ARS 1000 and USD 500
- WHEN the summary is requested
- THEN `balance` is 1000 and the USD amount is excluded from all totals

#### Scenario: Buenos Aires bucketing

- GIVEN `occurredAt` 2026-08-01T02:59:00Z (= 2026-07-31 23:59 in Buenos Aires)
- WHEN the summary is requested
- THEN the movement is bucketed to July, not August

#### Scenario: No data

- GIVEN a viewer with no visible movements
- WHEN the summary is requested
- THEN kpis are zeros, `daily` is zero-filled, and `categories` is empty

#### Scenario: Month comparison

- GIVEN movements in June and July 2026
- WHEN the summary is requested
- THEN `mom.months` contains both months with per-month income, expenses, and balance

#### Scenario: Visibility filter feeds charts

- GIVEN a viewer with own and partner SHARED movements
- WHEN `GET /movements/summary?visibility=mine`
- THEN `categories`, `top`, and `kpis` derive only from the viewer's own movements

### Requirement: Movement Update Endpoint

The system MUST provide `PATCH /movements/:id` scoped by owner (`x-owner-id`). It MUST update only the fields present per `updateMovementSchema`, MUST support both `EXPENSE` and `INCOME` movements, and MUST apply `category: null` by clearing the category and an absent field by leaving it unchanged. A category value MUST be validated against the owner's category set; an invalid category MUST return `422 ValidationFailedError`. A missing movement, one owned by another owner, or a SHARED movement whose registrant is not the caller MUST return `404`. A partner MUST NOT update the registrant's movements.
(Previously: owner-scoped; a movement owned by another owner returned 404, with no registrant distinction.)

#### Scenario: Update note only

- GIVEN a movement owned by the caller
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

### Requirement: Movement Delete Endpoint

The system MUST provide `DELETE /movements/:id` scoped by owner (`x-owner-id`). It MUST support both `EXPENSE` and `INCOME` movements. A missing movement, one owned by another owner, or a SHARED movement whose registrant is not the caller MUST return `404`. A partner MUST NOT delete the registrant's movements. Deleting a movement MUST update the dashboard list and KPIs after refresh.
(Previously: owner-scoped; another owner's movement returned 404, with no registrant distinction.)

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