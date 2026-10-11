# Delta for Dashboard Web

## MODIFIED Requirements

### Requirement: Metrics Overview

The dashboard MUST fetch `GET /movements/summary` for the configured owner and MUST render a single scroll with sections in this order: KPI cards (Ingresos, Gastos, Balance, Ahorrado, Promedio mes, Promedio por movimiento, Máximo, Cantidad), month-over-month comparison, last-30-days daily chart with daily average, category breakdown with percentages, top expenses, top income, then the movement list. The "Ahorrado" card MUST show the current-calendar-month savings from `kpis.savings`. All amounts MUST render with `Intl.NumberFormat("es-AR", { style: "currency" })` and all UI strings MUST be in Spanish.
(Previously: the KPI cards were Ingresos, Gastos, Balance, Promedio mes, Promedio por movimiento, Máximo, Cantidad — no Ahorrado.)

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

### Requirement: Movement List

The dashboard MUST fetch `GET /movements` for the owner and MUST render a table ordered by `occurredAt` descending with columns for date, type, amount (es-AR), currency, category, and note. Each row MUST expose edit and delete actions. A SAVINGS row MUST render its type as "Ahorro" with an "Ahorro" badge.
(Previously: only INCOME and EXPENSE rows existed with a two-way type label/badge.)

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

### Requirement: Movement Filters

The dashboard MUST provide combined filters — type, date range (from/to), category, and note text — that re-query `GET /movements` with those query params, MUST apply all active filters together, and MUST provide a reset action that restores the unfiltered list. The type filter MUST offer "Ahorro" as an option alongside Ingreso and Gasto.
(Previously: the type filter offered only Ingreso and Gasto.)

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