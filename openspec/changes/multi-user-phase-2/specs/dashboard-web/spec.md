# Delta for Dashboard Web

## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Movement List

The dashboard MUST fetch `GET /movements` for the selected viewer and MUST render a table ordered by `occurredAt` descending with columns for date, type, amount (es-AR), currency, category, note, and the SHARED badge. Each row MUST expose edit and delete actions ONLY for movements the viewer registered (registrantId equals the selected viewer); partner rows MUST be read-only. The list MUST apply the visibility filter (`mine`|`shared`|`all`).
(Previously: all rows were editable for the single owner and no visibility column or filter existed.)

#### Scenario: Render movements

- GIVEN income and expense movements visible to the viewer
- WHEN the list loads
- THEN all visible movements render newest first, with type and es-AR amounts

#### Scenario: Empty or unknown owner

- GIVEN no visible movements
- WHEN the list loads
- THEN a Spanish empty state shows and no rows render

#### Scenario: Row actions present

- GIVEN a rendered movement row registered by the selected viewer
- WHEN the row is inspected
- THEN edit and delete actions are available

#### Scenario: Partner rows read-only

- GIVEN a SHARED movement registered by the partner
- WHEN the row renders for the current viewer
- THEN the row shows the SHARED badge and NO edit or delete actions

### Requirement: Movement Filters

The dashboard MUST provide combined filters — type, date range (from/to), category, note text, and visibility (`mine`|`shared`|`all`) — that re-query `GET /movements` with those query params, MUST apply all active filters together, and MUST provide a reset action that restores the unfiltered list.
(Previously: type, date range, category, and note filters only.)

#### Scenario: Combined filter

- GIVEN a viewer with mixed movements
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

#### Scenario: Visibility combines with other filters

- GIVEN a viewer with own and partner SHARED movements
- WHEN the user selects visibility "shared" plus a type filter
- THEN only movements matching both are shown