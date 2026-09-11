# Dashboard Web Specification

## Requirements

### Requirement: Metrics Overview

The dashboard MUST fetch `GET /movements/summary` for the configured owner and MUST render a single scroll with sections in this order: KPI cards (Ingresos, Gastos, Balance, Promedio mes, Promedio por movimiento, Máximo, Cantidad), month-over-month comparison, last-30-days daily chart with daily average, category breakdown with percentages, top expenses, top income, then the movement list. All amounts MUST render with `Intl.NumberFormat("es-AR", { style: "currency" })` and all UI strings MUST be in Spanish.
(Previously: fetched `/expenses/summary` and showed monthly expense cards and a bar chart.)

#### Scenario: Full dashboard

- GIVEN a summary with data
- WHEN the dashboard loads
- THEN all sections render in the specified order with es-AR amounts and Spanish labels

#### Scenario: Month-over-month delta

- GIVEN `mom.months` with June and July totals
- WHEN the comparison section renders
- THEN it shows the percentage change between consecutive months

#### Scenario: Empty summary

- GIVEN an empty summary
- WHEN the dashboard loads
- THEN a Spanish empty state renders instead of charts

### Requirement: Movement List

The dashboard MUST fetch `GET /movements` for the owner and MUST render a table ordered by `occurredAt` descending with columns for date, type, amount (es-AR), currency, category, and note. Each row MUST expose edit and delete actions.
(Previously: the list was read-only with no row actions.)

#### Scenario: Render movements

- GIVEN income and expense movements
- WHEN the list loads
- THEN all movements render newest first, with type and es-AR amounts

#### Scenario: Empty or unknown owner

- GIVEN no movements
- WHEN the list loads
- THEN a Spanish empty state shows and no rows render

#### Scenario: Row actions present

- GIVEN a rendered movement row
- WHEN the row is inspected
- THEN edit and delete actions are available

### Requirement: Movement Filters

The dashboard MUST provide combined filters — type, date range (from/to), category, and note text — that re-query `GET /movements` with those query params, MUST apply all active filters together, and MUST provide a reset action that restores the unfiltered list.
(Previously: client-side month and category filters over an already-loaded list.)

#### Scenario: Combined filter

- GIVEN an owner with mixed movements
- WHEN the user sets a type, a date range, and note text
- THEN only matching movements are shown

#### Scenario: No matches

- GIVEN filters that match nothing
- WHEN the user applies them
- THEN the list section shows an empty state, not an error

#### Scenario: Reset

- GIVEN active filters
- WHEN the user clicks reset
- THEN the unfiltered list reloads

### Requirement: Fixed Owner

The dashboard MUST derive the owner from a single deployment configuration value (`VITE_OWNER_ID`) and MUST use it for both API requests, defaulting to `"default"` when unset. The dashboard MUST NOT provide an owner selector.

#### Scenario: Configured owner

- GIVEN `VITE_OWNER_ID` is set to `"acme"`
- WHEN the dashboard loads
- THEN both summary and list requests use `ownerId=acme`

#### Scenario: Default owner

- GIVEN `VITE_OWNER_ID` is unset
- WHEN the dashboard loads
- THEN both requests use `ownerId=default`

### Requirement: Loading, Error and Empty States

While any fetch is in flight, the dashboard MUST show a Spanish loading state for the affected section. On failure, the dashboard MUST show a Spanish error message with a retry action that re-issues the failed request. Every section MUST show a Spanish empty state when its data is empty.
(Previously: loading and error states only.)

#### Scenario: Loading

- GIVEN a pending request
- THEN the affected section shows a Spanish loading state

#### Scenario: Failure and retry

- GIVEN the API is unreachable
- WHEN the dashboard loads
- THEN a Spanish error with a retry action shows for the affected section
- AND retrying after the API recovers loads the data successfully

#### Scenario: Empty section

- GIVEN a section with no data
- THEN a Spanish empty state shows for that section

### Requirement: Response Validation

The dashboard MUST validate every API response against the shared movement contracts (`movementSchema`, `listMovementsSchema`, `movementSummarySchema`) before use. A response that does not match the expected shape MUST surface the error state for the affected section and MUST NOT render partial or malformed data.
(Previously: validated against the expense contracts.)

#### Scenario: Valid responses

- GIVEN contract-conforming payloads
- WHEN the dashboard renders
- THEN all sections render from validated data

#### Scenario: Malformed response

- GIVEN a payload with missing or wrong-typed fields
- WHEN the dashboard processes it
- THEN the affected section shows the error state with retry, with no crash and no partial render

### Requirement: Movement Edit Form

The dashboard MUST provide an edit form for a movement that allows changing amount, note, and category. The category input MUST be a dropdown populated from `GET /movements/categories` for the owner. Submitting MUST call `PATCH /movements/:id` with only changed fields, and MUST clear the category when the dropdown selection is cleared (sends `null`). Invalid input MUST show a Spanish error and MUST NOT call the API.

#### Scenario: Edit amount and note

- GIVEN a movement row
- WHEN the owner edits amount and note and submits
- THEN `PATCH /movements/:id` is called with the changed fields

#### Scenario: Category dropdown from owner categories

- GIVEN the owner has categories
- WHEN the edit form opens
- THEN the dropdown lists the owner's categories from `GET /movements/categories`

#### Scenario: Clear category sends null

- GIVEN a movement with a category
- WHEN the owner clears the dropdown and submits
- THEN `PATCH /movements/:id` is called with `category: null`

#### Scenario: Invalid amount blocked

- GIVEN an invalid (non-positive) amount in the form
- WHEN the owner submits
- THEN a Spanish error shows and no API call is made

### Requirement: Movement Delete with Confirmation

The dashboard MUST confirm before deleting a movement. Confirming MUST call `DELETE /movements/:id` and, on success, remove the row and refresh the affected data. Cancelling MUST do nothing. A failed delete MUST show a Spanish error and keep the row.

#### Scenario: Confirmed delete

- GIVEN a movement row
- WHEN the owner confirms deletion
- THEN `DELETE /movements/:id` is called and the row is removed after success

#### Scenario: Cancelled delete

- GIVEN a movement row
- WHEN the owner cancels the confirm dialog
- THEN no API call is made and the row remains

#### Scenario: Failed delete

- GIVEN a movement whose delete fails
- WHEN the owner confirms deletion
- THEN a Spanish error shows and the row remains

### Requirement: Auto-Refresh After Mutations

After any successful mutation (create/edit/delete), the dashboard MUST refresh both the movement list and the summary (KPIs, categories, top lists) so they stay coherent. The dashboard MUST use a single App-level refresh token that, when bumped, triggers both the list and summary hooks to re-fetch. The refresh MUST happen without a full page reload.

#### Scenario: Delete refreshes list and summary

- GIVEN a successful delete
- WHEN the refresh token bumps
- THEN both the list and the summary re-fetch

#### Scenario: Edit refreshes list and summary

- GIVEN a successful edit
- WHEN the refresh token bumps
- THEN both the list and the summary re-fetch

#### Scenario: Refresh without reload

- GIVEN a successful mutation
- WHEN the data refreshes
- THEN it happens in place without a full page reload