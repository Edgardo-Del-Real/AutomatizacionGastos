# Delta for Dashboard Web

## RENAMED Requirements

### Requirement: Expense List → Movement List

(Reason: the domain now covers income and expense movements.)
(Migration: update references and tests to "Movement List".)

### Requirement: Client-Side Filters → Movement Filters

(Reason: filters now apply against the `/movements` endpoint, not only in the browser.)
(Migration: behavior replaced by the MODIFIED block below.)

### Requirement: Loading and Error States → Loading, Error and Empty States

(Reason: adds explicit empty states for every section.)
(Migration: update references.)

## MODIFIED Requirements

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

The dashboard MUST fetch `GET /movements` for the owner and MUST render a table ordered by `occurredAt` descending with columns for date, type, amount (es-AR), currency, category, and note.
(Previously: fetched the full `/expenses` list without a type column.)

#### Scenario: Render movements

- GIVEN income and expense movements
- WHEN the list loads
- THEN all movements render newest first, with type and es-AR amounts

#### Scenario: Empty or unknown owner

- GIVEN no movements
- WHEN the list loads
- THEN a Spanish empty state shows and no rows render

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
