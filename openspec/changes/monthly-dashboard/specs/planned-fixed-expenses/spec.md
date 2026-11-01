# Delta for Planned Fixed Expenses

## MODIFIED Requirements

### Requirement: Planned Summary Block

`movementSummarySchema` MUST include `planned: { total, movements }`, where `total` is the sum of the owner's OUTSTANDING PENDING EXPENSE movements in ARS and `movements` is the PENDING EXPENSE rows themselves (every PENDING EXPENSE; no date derivation). The block MUST NOT carry a month key: a previsto has no planned date, so there is nothing to label. The block MUST ignore the requested month entirely. `movements` MUST exist so the dashboard can list the previstos and offer the mark-paid action after they leave the monthly table.

(Previously: the block was `planned: { month, total }`, where `month` was derived as the Buenos Aires month following the current one and shipped as an informational label that no consumer rendered.)

#### Scenario: planned reports every outstanding previsto

- GIVEN PENDING EXPENSE 2500 loaded this month
- WHEN the summary is requested for any month
- THEN `planned.total` is 2500 and `planned.movements` contains that row

#### Scenario: an old previsto still counts

- GIVEN a PENDING expense loaded two months ago and never paid
- WHEN the summary is requested for any month
- THEN it is still included in `planned.total`

#### Scenario: planned ignores the requested month

- GIVEN the summary is requested with `month=2026-10` and again with `month=2026-11`
- WHEN both responses are compared
- THEN `planned.total` is identical

#### Scenario: no pending planned is zero

- GIVEN no PENDING EXPENSE
- WHEN the summary is requested
- THEN `planned` is `{ total: 0, movements: [] }`

#### Scenario: no month key is emitted

- GIVEN any summary response
- WHEN the payload is validated against `movementSummarySchema`
- THEN `planned` contains only `total` and `movements`
