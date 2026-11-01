# Delta for Dashboard Web

## ADDED Requirements

### Requirement: Month Selector

The dashboard MUST expose a single month selector in the header that drives ALL data-bearing sections (`Resumen`, `Análisis`, `Movimientos`). The selection MUST live in the URL as `?mes=YYYY-MM` so it survives a reload, browser back/forward, and a shared link; an absent or malformed value MUST fall back to the current Buenos Aires month. The default on first load MUST be the current Buenos Aires month, even when that month has no movements. Changing the month MUST re-query every affected section without a full page reload. The selector MUST provide previous-month and next-month actions plus a direct month input, MUST label the active selection in Spanish (`octubre de 2026`), and MUST be keyboard operable with an accessible name.

#### Scenario: Default to the current month

- GIVEN the owner opens the dashboard on 2026-11-01 with no `mes` in the URL
- WHEN the page loads
- THEN every section requests `month=2026-11`
- AND the selector shows "noviembre de 2026"

#### Scenario: Navigate to the previous month

- GIVEN the selector shows "noviembre de 2026"
- WHEN the owner presses previous
- THEN the URL becomes `?mes=2026-10`
- AND every section re-queries `month=2026-10`

#### Scenario: Selection survives a reload

- GIVEN the URL is `?mes=2026-09`
- WHEN the page reloads
- THEN the selector and all sections still show September 2026

#### Scenario: Malformed key falls back

- GIVEN the URL is `?mes=2026-13`
- WHEN the page loads
- THEN the selector falls back to the current Buenos Aires month

#### Scenario: Empty month is reachable

- GIVEN a month with no movements
- WHEN the owner selects it
- THEN every section renders its own Spanish empty state
- AND the selector keeps showing the selected month

## MODIFIED Requirements

### Requirement: Metrics Overview

The dashboard MUST fetch `GET /movements/summary` for the configured owner scoped to the selected month and MUST render, in this order: KPI cards, the planned expenses section, and the category breakdown. The KPI cards MUST show `Ingresos`, `Gastos`, `Disponible`, `Ahorro` and `Movimientos`, all belonging to the selected month: `Disponible` MUST render `kpis.balance` (the month's net: income − expenses − manual savings), `Ahorro` MUST render `kpis.savings` for that month, and `Movimientos` MUST render `kpis.count`. The planned expenses section MUST show `summary.planned.total` (es-AR) with no month and no planned date. All amounts MUST render with `Intl.NumberFormat("es-AR", { style: "currency" })` and all UI strings MUST be in Spanish.
(Previously: the summary was fetched with no period, so `Ingresos`/`Gastos`/`Balance` were lifetime totals; the requirement also described sections that the code does not render — month-over-month comparison, top expenses, top income, and eight KPI cards including `Promedio mes`, `Promedio por movimiento`, `Máximo` and `Cantidad`.)

#### Scenario: Cards belong to the selected month

- GIVEN October with INCOME 900 and November with INCOME 400
- WHEN the owner selects "octubre de 2026"
- THEN the `Ingresos` card shows $900 in es-AR currency

#### Scenario: Available is the month net

- GIVEN the selected month with INCOME 900, EXPENSE 300 and a MANUAL SAVINGS of 50
- WHEN the KPI cards render
- THEN `Disponible` shows $550

#### Scenario: Ahorro card shows the selected month

- GIVEN `kpis.savings` is 150 for the selected month
- WHEN the KPI cards render
- THEN the `Ahorro` card shows $150

#### Scenario: Movement count

- GIVEN `kpis.count` is 12 for the selected month
- WHEN the KPI cards render
- THEN the `Movimientos` card shows 12

#### Scenario: Planned section renders the outstanding total

- GIVEN `summary.planned.total` is 4000
- WHEN the dashboard loads
- THEN a "Gastos fijos previstos" section shows the pending total in es-AR without a month label

### Requirement: Movement List

The dashboard MUST fetch `GET /movements` for the selected viewer scoped to the selected month and MUST render a table ordered by `occurredAt` descending with columns for date, type, amount (es-AR), currency, category, note, and the SHARED badge. Each row MUST expose edit and delete actions ONLY for movements the viewer registered (registrantId equals the selected viewer); partner rows MUST be read-only. The list MUST apply the visibility filter (`mine`|`shared`|`all`). A SAVINGS row MUST render its type as "Ahorro" with an "Ahorro" badge. Planned expenses MUST NOT appear in the list: they carry no date and are surfaced only by the planned section.
(Previously: the list was unfiltered in time and rendered PENDING rows with a "Previsto" badge, an em dash in the date column, and a "Marcar pagado" action.)

#### Scenario: Render the selected month

- GIVEN movements in October and November
- WHEN the owner selects "octubre de 2026"
- THEN only October movements render, newest first

#### Scenario: Empty or unknown owner

- GIVEN no movements in the selected month
- WHEN the list loads
- THEN a Spanish empty state shows and no rows render

#### Scenario: Row actions present

- GIVEN a rendered movement row
- WHEN the row is inspected
- THEN edit and delete actions are available

#### Scenario: Partner rows read-only

- GIVEN a SHARED movement registered by the partner
- WHEN the row renders for the current viewer
- THEN the row shows the SHARED badge and NO edit or delete actions

#### Scenario: SAVINGS row renders with the Ahorro badge

- GIVEN a movement with type `SAVINGS`
- WHEN the list loads
- THEN the row renders the "Ahorro" label with an "Ahorro" badge

#### Scenario: Planned rows do not appear

- GIVEN an outstanding PENDING expense
- WHEN the list loads for any month
- THEN no "Previsto" row renders and the planned section still shows the total

### Requirement: Movement Filters

The dashboard MUST provide combined filters — type, category, note text, and visibility (`mine`|`shared`|`all`) — that re-query `GET /movements` with those query params plus the selected month, MUST apply all active filters together, and MUST provide a reset action that restores the unfiltered list for the selected month. The type filter MUST offer "Ahorro" as an option alongside Ingreso and Gasto. The filters MUST NOT offer a free date range (the month selector owns the period) and MUST NOT offer a status or "Previstos" option.
(Previously: the filters included a free from/to date range and a synthetic "Previstos" option that matched `EXPENSE` + `PENDING`.)

#### Scenario: Combined filter

- GIVEN an owner with mixed movements in the selected month
- WHEN the user sets a type, a category, and note text
- THEN only matching movements of that month are shown

#### Scenario: No matches

- GIVEN filters that match nothing
- WHEN the user applies them
- THEN the list section shows an empty state, not an error

#### Scenario: Reset

- GIVEN active filters
- WHEN the user clicks reset
- THEN the unfiltered list of the selected month reloads

#### Scenario: Filter by Ahorro

- GIVEN an owner with SAVINGS and other movements
- WHEN the user selects "Ahorro" in the type filter
- THEN only SAVINGS movements of the selected month are shown

#### Scenario: No date range or status option offered

- GIVEN the filter bar renders
- WHEN the owner inspects the filter options
- THEN no from/to date input and no status option appear

### Requirement: Loading, Error and Empty States

While any fetch is in flight, the dashboard MUST show a Spanish loading state for the affected section. On failure, the dashboard MUST show a Spanish error message with a retry action that re-issues the failed request for the selected month. Every section MUST show a Spanish empty state when its data is empty, naming the selected month so an empty month is never mistaken for a missing month.
(Previously: empty states were generic and did not name a month.)

#### Scenario: Loading

- GIVEN a pending request
- THEN the affected section shows a Spanish loading state

#### Scenario: Failure and retry

- GIVEN the API is unreachable
- WHEN the dashboard loads
- THEN a Spanish error with a retry action shows for the affected section
- AND retrying after the API recovers loads the selected month successfully

#### Scenario: Empty section names the month

- GIVEN a month with no movements
- THEN the empty state reads a Spanish sentence that names the selected month
