# Proposal: Monthly Dashboard

## Intent

Every number the owner sees in the dashboard must belong to a month. Today the dashboard fetches
`GET /movements/summary` with no period, so `Ingresos`, `Gastos` and `Disponible` are lifetime totals
while only `Ahorro` and `Movimientos del mes` are month-scoped. On 2026-11-01 the owner opened the
dashboard and saw October's money presented as if it were current: there is no way to tell which
month a card belongs to, and no way to look at a previous month.

The fix is one concept, `month=YYYY-MM`, threaded from the API to every dashboard tab, plus the
removal of the dead summary blocks that made the payload ambiguous.

## Scope

### In Scope

- `month=YYYY-MM` as the only period concept on `GET /movements/summary` and `GET /movements`;
  `from`/`to` are removed from both.
- A single global month selector in the dashboard header (`?mes=YYYY-MM`), driving the three tabs
  (`Resumen`, `Análisis`, `Movimientos`); default = the current Buenos Aires month.
- `Disponible` becomes the net of the selected month (`income − expenses − manualSavings`).
- `kpis.savings` becomes period-scoped (it is currently pinned to the current month while
  `kpis.manualSavings` already follows the requested period).
- `planned` loses its `month` key and gains `movements`: previstos carry no date, so the block is
  `{ total, movements }` — the total plus the rows, because the monthly table can no longer list them
  and the mark-paid action needs a surface.
- Removal of the dead summary payload: `mom`, `countThisMonth`, `summaryMonths`, `lastMonths`.
- Movement list becomes month-scoped; the free `Desde`/`Hasta` inputs and the synthetic
  `Previstos` type option leave the filter bar.
- The bot keeps its behaviour: it passes the current month explicitly and reads `kpis.count`.

### Out of Scope

- Month-named bot queries ("cuánto gasté en octubre"). The bot stays on the current month.
- Month-over-month comparison (Δ% per card) and the 6-month chart: explicitly declined; `mom` is
  deleted instead of being drawn.
- Removing `top`, `avgPerMonth`, `avgPerMovement`, `maxAmount` (also unrendered) — tracked as a
  follow-up cleanup to keep this change reviewable.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `money-movements`: the summary endpoint becomes month-scoped, `mom`/`countThisMonth` disappear,
  `savings` follows the period, `planned` is `{ total }`.
- `dashboard-web`: one global month selector; every tab renders the selected month.
- `planned-fixed-expenses`: the planned block no longer carries a month key.
- `manual-savings`: the "Ahorro" KPI follows the selected period instead of the current month.

## Approach

One concept replaces two: `month=YYYY-MM`. The API derives the Buenos Aires day range from the key
(calendar math already lives there and is correct); the dashboard never does date arithmetic. An
absent `month` means lifetime totals and stays available for exactly one caller — the bot's
"cuánto tengo" balance query, which is a lifetime question by definition. With a single period the
service collapses from 12 aggregate queries to 9, and `thisMonthKpis`, `nextBaMonth`,
`currentMonthPeriod`, `lastMonths` and `summaryMonths` are deleted.

## Delivery

Two stacked slices on `dev` (the repo's established flow for review-sized changes):

1. `feat/monthly-dashboard-pr1` — contracts + API + bot plumbing + the minimum dashboard adaptation
   needed to keep the tree compiling and green.
2. `feat/monthly-dashboard-pr2` — month selector, tab wiring, filter cleanup.

## Risks

- **Visible semantic change**: `Disponible` stops being the lifetime balance. That is the intent,
  but the number will look much smaller. Rollback: revert the slice; no data migration is involved.
- **Contract cut**: `mom` and `countThisMonth` are removed, so any external consumer breaks. There is
  exactly one consumer (`apps/dashboard`) and the bot, both updated in the same change.
- **Intermediate state**: after slice 1 the dashboard asks for the current month with no selector.
  Slices are stacked and merged together, so no such state is ever released.
- **Spec drift found**: the canonical `dashboard-web` "Metrics Overview" describes sections that the
  code does not render (month-over-month comparison, top lists, eight KPI cards). The delta rewrites
  that requirement to match reality instead of preserving a fiction.
