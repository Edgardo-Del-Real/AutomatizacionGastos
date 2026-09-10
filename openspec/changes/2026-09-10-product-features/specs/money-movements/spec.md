# Delta for Money Movements

## MODIFIED Requirements

### Requirement: Movement Contracts

`@rita/contracts` MUST export `movementSchema`, `listMovementsSchema`, `movementSummarySchema`, `createMovementSchema`, and `updateMovementSchema`. `updateMovementSchema` MUST make `amount`, `note`, and `category` all optional with at least one present. `category` MUST accept `null` (clears the category) or an owner category; an absent `category` MUST leave it unchanged. `amount`, when present, MUST be a positive number. The `expenseSchema` family MUST remain exported unchanged. Every movement API response MUST validate against these contracts.
(Previously: only `movementSchema`, `listMovementsSchema`, and `movementSummarySchema` were defined and category was free-form nullable.)

**Feature: Contracts**
- Scenario: Update schema optional fields
  - Given a payload with only `note`
  - When validated against `updateMovementSchema`
  - Then it passes and other fields are unchanged
- Scenario: Null clears category
  - Given a payload with `category: null`
  - When validated against `updateMovementSchema`
  - Then it passes and represents clearing the category
- Scenario: Invalid category rejected
  - Given a payload whose `category` is not an owner category and not null
  - When validated against `updateMovementSchema`
  - Then it fails validation
- Scenario: Non-positive amount rejected
  - Given a payload with `amount: 0`
  - When validated against `updateMovementSchema`
  - Then it fails validation
- Scenario: Empty patch rejected
  - Given a payload with no recognized fields
  - When validated against `updateMovementSchema`
  - Then it fails validation
- Scenario: Expense contracts unchanged
  - Given code importing `expenseSchema`
  - When contracts rebuild
  - Then its shape is unchanged

## ADDED Requirements

### Requirement: Movement Update Endpoint

The system MUST provide `PATCH /movements/:id` scoped by owner (`x-owner-id`). It MUST update only the fields present per `updateMovementSchema`, MUST support both `EXPENSE` and `INCOME` movements, and MUST apply `category: null` by clearing the category and an absent field by leaving it unchanged. A category value MUST be validated against the owner's category set; an invalid category MUST return `422 ValidationFailedError`. A missing movement or one owned by another owner MUST return `404`.

**Feature: Update endpoint**
- Scenario: Update note only
  - Given an owner movement
  - When `PATCH /movements/:id` is called with `{ note: "cena" }`
  - Then the note updates and amount and category are unchanged
- Scenario: Clear category
  - Given a movement with a category
  - When `PATCH /movements/:id` is called with `{ category: null }`
  - Then the category is cleared
- Scenario: Set valid category
  - Given a movement and an owner category
  - When `PATCH /movements/:id` is called with `{ category: "<category>" }`
  - Then the category is set
- Scenario: Invalid category
  - Given a movement and a category not belonging to the owner
  - When `PATCH /movements/:id` is called with it
  - Then a `422 ValidationFailedError` is returned
- Scenario: Update income movement
  - Given an `INCOME` movement
  - When `PATCH /movements/:id` is called with a valid patch
  - Then the income movement updates
- Scenario: Missing movement
  - Given no movement with that id for the owner
  - When `PATCH /movements/:id` is called
  - Then `404` is returned
- Scenario: Another owner's movement
  - Given a movement owned by a different owner
  - When `PATCH /movements/:id` is called for the current owner
  - Then `404` is returned

### Requirement: Movement Delete Endpoint

The system MUST provide `DELETE /movements/:id` scoped by owner (`x-owner-id`). It MUST support both `EXPENSE` and `INCOME` movements. A missing movement or one owned by another owner MUST return `404`. Deleting a movement MUST update the dashboard list and KPIs after refresh.

**Feature: Delete endpoint**
- Scenario: Delete income movement
  - Given an `INCOME` movement for the owner
  - When `DELETE /movements/:id` is called
  - Then the movement is deleted
- Scenario: Delete expense movement
  - Given an `EXPENSE` movement for the owner
  - When `DELETE /movements/:id` is called
  - Then the movement is deleted
- Scenario: Missing movement
  - Given no movement with that id for the owner
  - When `DELETE /movements/:id` is called
  - Then `404` is returned
- Scenario: Another owner's movement
  - Given a movement owned by a different owner
  - When `DELETE /movements/:id` is called for the current owner
  - Then `404` is returned

### Requirement: Category Read Endpoint

The system MUST provide `GET /movements/categories` scoped by owner, returning the owner's category list (names and keyword rules). This endpoint MUST be the read source for the dashboard edit-form category dropdown. Unknown or empty owner MUST return an empty list.

**Feature: Category read endpoint**
- Scenario: Owner categories returned
  - Given an owner with categories
  - When `GET /movements/categories` is called
  - Then all owner categories are returned
- Scenario: Empty owner
  - Given an owner with no categories
  - When `GET /movements/categories` is called
  - Then an empty list is returned

### Requirement: Legacy Data Preservation

Existing movements with a `NULL` category or a legacy seed slug (e.g. "food", "other") MUST be left untouched by the categorization feature and MUST remain editable through the dashboard (PATCH may set a category on them). The learned category matcher MUST apply only to newly created bot messages.

**Feature: Legacy data**
- Scenario: Null-category movement stays
  - Given an existing movement with `NULL` category
  - When the categorization feature activates
  - Then the movement is unchanged
- Scenario: Legacy seed slug stays
  - Given an existing movement with category "food"
  - When the categorization feature activates
  - Then the movement is unchanged
- Scenario: Legacy movement editable
  - Given an existing legacy movement
  - When the owner sets a category via PATCH
  - Then the category is set and the movement remains intact