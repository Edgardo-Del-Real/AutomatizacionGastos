# Delta for Dashboard Web

## ADDED Requirements

### Requirement: Metrics Overview

The dashboard MUST fetch the monthly expense summary for the configured owner (summary endpoint, `ownerId` query param) and MUST display, for the last ~6 months, each month's expense count and total amount as summary cards and a bar chart.

#### Scenario: Display monthly metrics

- GIVEN the owner has expenses within the last six months
- WHEN the dashboard loads the summary
- THEN cards and a bar chart show count and totalAmount for each of the last ~6 months, ordered by month

#### Scenario: No summary data

- GIVEN the summary endpoint returns an empty months array
- WHEN the dashboard loads the summary
- THEN an empty state is shown instead of cards or a chart

### Requirement: Expense List

The dashboard MUST fetch the full expense list for the configured owner (list endpoint, `ownerId` query param) and MUST render a table ordered by occurredAt descending with columns for date, amount, currency, category, and note.

#### Scenario: Render expenses

- GIVEN the owner has expenses
- WHEN the dashboard loads the list
- THEN all expenses render in the table, newest occurredAt first, with date, amount, currency, category, and note populated

#### Scenario: Empty or unknown owner

- GIVEN the list endpoint returns no expenses (empty list or unknown ownerId)
- WHEN the dashboard loads the list
- THEN an empty state is shown and no rows render

### Requirement: Client-Side Filters

The dashboard MUST provide month (derived from occurredAt) and category filters that refine the already-loaded list in the browser, MUST apply both filters together when both are set, and MUST allow resetting to the full list.

#### Scenario: Filter by month and category

- GIVEN a loaded list spanning multiple months and categories
- WHEN the user selects a month and a category
- THEN only expenses matching both are shown

#### Scenario: Filter with no matches

- GIVEN filters that match no expenses
- WHEN the user applies them
- THEN the table shows an empty state, not an error

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

### Requirement: Loading and Error States

While either fetch is in flight, the dashboard MUST show a loading state for the affected section. When a fetch fails, the dashboard MUST show an error message with a retry action, and retrying MUST re-issue the failed request.

#### Scenario: Loading indicator

- GIVEN a summary or list request is pending
- THEN the affected section shows a loading state

#### Scenario: Network failure and retry

- GIVEN the API is unreachable
- WHEN the dashboard loads
- THEN an error state with a retry action is shown for the affected section
- AND retrying after the API recovers loads the data successfully

### Requirement: Response Validation

The dashboard MUST validate every API response against the shared expense contracts before use. A response that does not match the expected shape MUST surface the error state for the affected section and MUST NOT render partial or malformed data.

#### Scenario: Valid responses

- GIVEN the endpoints return contract-conforming payloads
- WHEN the dashboard renders
- THEN summary and list render from validated data

#### Scenario: Malformed response

- GIVEN the summary or list endpoint returns a payload with missing or wrong-typed fields
- WHEN the dashboard processes it
- THEN the affected section shows the error state with retry, with no crash and no partial render
