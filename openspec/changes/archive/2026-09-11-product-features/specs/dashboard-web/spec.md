# Delta for Dashboard Web

## MODIFIED Requirements

### Requirement: Movement List

The dashboard MUST fetch `GET /movements` for the owner and MUST render a table ordered by `occurredAt` descending with columns for date, type, amount (es-AR), currency, category, and note. Each row MUST expose edit and delete actions.
(Previously: the list was read-only with no row actions.)

**Feature: Movement list**
#### Scenario: Render movements
  - Given income and expense movements
  - When the list loads
  - Then all movements render newest first, with type and es-AR amounts
#### Scenario: Empty or unknown owner
  - Given no movements
  - When the list loads
  - Then a Spanish empty state shows and no rows render
#### Scenario: Row actions present
  - Given a rendered movement row
  - When the row is inspected
  - Then edit and delete actions are available

## ADDED Requirements

### Requirement: Movement Edit Form

The dashboard MUST provide an edit form for a movement that allows changing amount, note, and category. The category input MUST be a dropdown populated from `GET /movements/categories` for the owner. Submitting MUST call `PATCH /movements/:id` with only changed fields, and MUST clear the category when the dropdown selection is cleared (sends `null`). Invalid input MUST show a Spanish error and MUST NOT call the API.

**Feature: Edit form**
#### Scenario: Edit amount and note
  - Given a movement row
  - When the owner edits amount and note and submits
  - Then `PATCH /movements/:id` is called with the changed fields
#### Scenario: Category dropdown from owner categories
  - Given the owner has categories
  - When the edit form opens
  - Then the dropdown lists the owner's categories from `GET /movements/categories`
#### Scenario: Clear category sends null
  - Given a movement with a category
  - When the owner clears the dropdown and submits
  - Then `PATCH /movements/:id` is called with `category: null`
#### Scenario: Invalid amount blocked
  - Given an invalid (non-positive) amount in the form
  - When the owner submits
  - Then a Spanish error shows and no API call is made

### Requirement: Movement Delete with Confirmation

The dashboard MUST confirm before deleting a movement. Confirming MUST call `DELETE /movements/:id` and, on success, remove the row and refresh the affected data. Cancelling MUST do nothing. A failed delete MUST show a Spanish error and keep the row.

**Feature: Delete confirmation**
#### Scenario: Confirmed delete
  - Given a movement row
  - When the owner confirms deletion
  - Then `DELETE /movements/:id` is called and the row is removed after success
#### Scenario: Cancelled delete
  - Given a movement row
  - When the owner cancels the confirm dialog
  - Then no API call is made and the row remains
#### Scenario: Failed delete
  - Given a movement whose delete fails
  - When the owner confirms deletion
  - Then a Spanish error shows and the row remains

### Requirement: Auto-Refresh After Mutations

After any successful mutation (create/edit/delete), the dashboard MUST refresh both the movement list and the summary (KPIs, categories, top lists) so they stay coherent. The dashboard MUST use a single App-level refresh token that, when bumped, triggers both the list and summary hooks to re-fetch. The refresh MUST happen without a full page reload.

**Feature: Auto-refresh**
#### Scenario: Delete refreshes list and summary
  - Given a successful delete
  - When the refresh token bumps
  - Then both the list and the summary re-fetch
#### Scenario: Edit refreshes list and summary
  - Given a successful edit
  - When the refresh token bumps
  - Then both the list and the summary re-fetch
#### Scenario: Refresh without reload
  - Given a successful mutation
  - When the data refreshes
  - Then it happens in place without a full page reload