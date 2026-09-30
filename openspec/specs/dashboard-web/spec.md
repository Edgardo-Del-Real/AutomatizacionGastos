# Dashboard Web Specification

## Requirements

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

The dashboard MUST fetch `GET /movements` for the selected viewer and MUST render a table ordered by `occurredAt` descending with columns for date, type, amount (es-AR), currency, category, note, and the SHARED badge. Each row MUST expose edit and delete actions ONLY for movements the viewer registered (registrantId equals the selected viewer); partner rows MUST be read-only. The list MUST apply the visibility filter (`mine`|`shared`|`all`). A SAVINGS row MUST render its type as "Ahorro" with an "Ahorro" badge. A PENDING row MUST render its status as "Previsto" with a "Previsto" badge and a "Marcar pagado" action for own rows.
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

#### Scenario: Partner rows read-only

- GIVEN a SHARED movement registered by the partner
- WHEN the row renders for the current viewer
- THEN the row shows the SHARED badge and NO edit or delete actions

#### Scenario: SAVINGS row renders with the Ahorro badge

- GIVEN a movement with type `SAVINGS`
- WHEN the list loads
- THEN the row renders the "Ahorro" label with an "Ahorro" badge

#### Scenario: PENDING row renders the Previsto badge and mark-paid action

- GIVEN a movement with status `PENDING`
- WHEN the list loads
- THEN the row renders a "Previsto" badge and a "Marcar pagado" action

### Requirement: Movement Filters

The dashboard MUST provide combined filters — type, date range (from/to), category, note text, and visibility (`mine`|`shared`|`all`) — that re-query `GET /movements` with those query params, MUST apply all active filters together, and MUST provide a reset action that restores the unfiltered list. The type filter MUST offer "Ahorro" as an option alongside Ingreso and Gasto. The filters MUST NOT include a status filter; planned expenses are surfaced only through the dedicated planned section.
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

#### Scenario: Visibility combines with other filters

- GIVEN a viewer with own and partner SHARED movements
- WHEN the user selects visibility "shared" plus a type filter
- THEN only movements matching both are shown

### Requirement: Viewer Selector

The dashboard MUST fetch `GET /household/members` and MUST render a viewer selector (ownerId + name) that determines the owner for ALL API requests (list, summary, categories). The selected viewer MUST be the single source of ownerId, replacing `VITE_OWNER_ID` as the source of truth. When the household endpoint returns a single member or is unavailable, the dashboard MUST fall back to `VITE_OWNER_ID` (default `"default"`) with no selector. The selection MUST persist across reloads (e.g. localStorage).
(Previously: "Fixed Owner" — the owner came only from `VITE_OWNER_ID` and no selector existed.)

#### Scenario: Selector lists household members

- GIVEN `GET /household/members` returns Rita and Edgardo
- WHEN the dashboard loads
- THEN a selector shows both members and the requests use the selected viewer's ownerId

#### Scenario: Switching viewer re-queries

- GIVEN the user switches the selector from Rita to Edgardo
- WHEN the dashboard reloads data
- THEN both summary and list requests use Edgardo's ownerId

#### Scenario: Single-member fallback

- GIVEN `GET /household/members` returns only `default` (or fails)
- WHEN the dashboard loads
- THEN no selector renders and requests use `VITE_OWNER_ID` or `"default"`

#### Scenario: Selection persists

- GIVEN the user selected Edgardo
- WHEN the page reloads
- THEN the selector still shows Edgardo and requests use his ownerId

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

### Requirement: Planned Expense Creation (Agregar previsto)

The dashboard MUST provide an "Agregar previsto" form with amount, note, and category (category dropdown from `GET /movements/categories`) that creates an EXPENSE with `status: "PENDING"` via the movement creation API. Planned expenses are INDIVIDUAL by design: the form MUST NOT offer a "Compartido" control and the creation payload MUST never carry a visibility field. Invalid input MUST show a Spanish error and MUST NOT call the API.

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

### Requirement: Viewer Visibility Filter

The dashboard MUST provide a visibility filter with values `mine` | `shared` | `all` (default `all`) that re-queries `GET /movements` AND `GET /movements/summary` with the `visibility` query param, so the list AND the charts (KPIs, category breakdown, top lists) reflect the filter. A reset action MUST restore `all`.

#### Scenario: Filter applies to list and charts

- GIVEN a viewer with own and partner SHARED movements
- WHEN the user selects "shared"
- THEN both the list and the summary requests carry `visibility=shared` and the charts reflect only SHARED movements

#### Scenario: Reset restores all

- GIVEN an active visibility filter
- WHEN the user clicks reset
- THEN the list and summary reload with `visibility=all`

#### Scenario: Default is all

- GIVEN the dashboard loads with no filter selected
- THEN both requests carry `visibility=all` (own + partner SHARED)

### Requirement: SHARED Badge

The dashboard MUST render a SHARED badge on movement rows whose `visibility` is `SHARED`, showing the registrant's name. INDIVIDUAL rows MUST NOT show the badge.

#### Scenario: Badge on shared row

- GIVEN a SHARED movement registered by Edgardo
- WHEN the row renders in Rita's list
- THEN the row shows a SHARED badge with Edgardo's name

#### Scenario: No badge on individual row

- GIVEN an INDIVIDUAL movement
- WHEN the row renders
- THEN no badge is shown