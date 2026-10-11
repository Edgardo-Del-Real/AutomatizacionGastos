# Delta for Dashboard Web

## MODIFIED Requirements

### Requirement: Metrics Overview

The dashboard MUST fetch `GET /movements/summary` for the configured owner and MUST render a single scroll with sections in this order: KPI cards (Ingresos, Gastos, Balance, Ahorrado, Promedio mes, Promedio por movimiento, Máximo, Cantidad), planned expenses section, month-over-month comparison, last-30-days daily chart with daily average, category breakdown with percentages, top expenses, top income, then the movement list. The "Ahorrado" card MUST show the current-calendar-month savings from `kpis.savings`. The planned expenses section MUST show `summary.planned` (next-month total, es-AR) with Spanish labels. All amounts MUST render with `Intl.NumberFormat("es-AR", { style: "currency" })` and all UI strings MUST be in Spanish.
(Previously: the scroll had no planned expenses section.)

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

#### Scenario: Ahorrado card shows current-month savings

- GIVEN `kpis.savings` is 150
- WHEN the KPI cards render
- THEN the "Ahorrado" card shows $150 in es-AR currency

#### Scenario: Ahorrado card with no savings

- GIVEN `kpis.savings` is 0
- WHEN the KPI cards render
- THEN the "Ahorrado" card shows $0

#### Scenario: Planned section renders next-month total

- GIVEN `summary.planned` is `{ month: "2026-09", total: 4000 }`
- WHEN the dashboard loads
- THEN a "Gastos fijos previstos" section shows the month and total in es-AR

### Requirement: Movement List

The dashboard MUST fetch `GET /movements` for the owner and MUST render a table ordered by `occurredAt` descending with columns for date, type, amount (es-AR), currency, category, and note. Each row MUST expose edit and delete actions. A SAVINGS row MUST render its type as "Ahorro" with an "Ahorro" badge. A PENDING row MUST render its status as "Previsto" with a "Previsto" badge and a "Marcar pagado" action for own rows.
(Previously: only INCOME/EXPENSE/SAVINGS rows existed with type labels/badges; no PENDING rendering.)

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

#### Scenario: SAVINGS row renders with the Ahorro badge

- GIVEN a movement with type `SAVINGS`
- WHEN the list loads
- THEN the row renders the "Ahorro" label with an "Ahorro" badge

#### Scenario: PENDING row renders the Previsto badge and mark-paid action

- GIVEN a movement with status `PENDING`
- WHEN the list loads
- THEN the row renders a "Previsto" badge and a "Marcar pagado" action

### Requirement: Movement Filters

The dashboard MUST provide combined filters — type, date range (from/to), category, and note text — that re-query `GET /movements` with those query params, MUST apply all active filters together, and MUST provide a reset action that restores the unfiltered list. The type filter MUST offer "Ahorro" as an option alongside Ingreso and Gasto. The filters MUST NOT include a status filter; planned expenses are surfaced only through the dedicated planned section.
(Previously: the type filter offered only Ingreso and Gasto; no status-filter statement existed.)

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

#### Scenario: Filter by Ahorro

- GIVEN an owner with SAVINGS and other movements
- WHEN the user selects "Ahorro" in the type filter
- THEN only SAVINGS movements are shown

#### Scenario: No status filter offered

- GIVEN the filter bar renders
- WHEN the owner inspects the filter options
- THEN no status option appears

### Requirement: Auto-Refresh After Mutations

After any successful mutation (create/edit/delete/mark-paid), the dashboard MUST refresh both the movement list and the summary (KPIs, categories, top lists) so they stay coherent. The dashboard MUST use a single App-level refresh token that, when bumped, triggers both the list and summary hooks to re-fetch. The refresh MUST happen without a full page reload.
(Previously: refresh was scoped to create/edit/delete.)

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

#### Scenario: Mark-paid refreshes list and summary

- GIVEN a successful mark-paid
- WHEN the refresh token bumps
- THEN both the list and the summary re-fetch

## ADDED Requirements

### Requirement: Planned Expense Creation (Agregar previsto)

The dashboard MUST provide an "Agregar previsto" form with amount, note, and category (category dropdown from `GET /movements/categories`) that creates an EXPENSE with `status: "PENDING"` via the movement creation API. Invalid input MUST show a Spanish error and MUST NOT call the API.

#### Scenario: Create a planned expense

- GIVEN the owner fills the form with amount, note, and category
- WHEN they submit
- THEN a PENDING EXPENSE is created and list + summary refresh

#### Scenario: Invalid amount blocked

- GIVEN an invalid (non-positive) amount in the form
- WHEN the owner submits
- THEN a Spanish error shows and no API call is made

### Requirement: Mark Paid Action

The dashboard MUST provide a "Marcar pagado" action on own PENDING rows that calls `POST /movements/:id/paid`. A `409` response MUST surface a Spanish error and keep the row PENDING. Success MUST refresh list and summary (per the auto-refresh contract).

#### Scenario: Mark paid succeeds

- GIVEN a PENDING EXPENSE row for the owner
- WHEN the owner clicks "Marcar pagado"
- THEN `POST /movements/:id/paid` is called and the row updates after success

#### Scenario: 409 surfaces a Spanish error

- GIVEN a PENDING row whose status changed to PAID on another surface
- WHEN the owner clicks "Marcar pagado"
- THEN a Spanish error shows and the row stays unchanged