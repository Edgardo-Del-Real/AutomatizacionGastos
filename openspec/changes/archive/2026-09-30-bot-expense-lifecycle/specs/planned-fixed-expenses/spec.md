# Delta for Planned Fixed Expenses

## MODIFIED Requirements

### Requirement: Mark Paid Transition

The system MUST provide `POST /movements/:id/paid` scoped by owner (`x-owner-id`). It MUST require the movement to be `EXPENSE` and `PENDING`; marking an already-`PAID` movement or a non-EXPENSE movement MUST return `409`. A missing movement or one owned by another owner MUST return `404`. The transition MUST set `status=PAID` and `occurredAt=now` in a single write; afterwards the movement MUST enter expenses, balance, and charts on its payment date. The bot MUST be able to trigger this transition conversationally through the same service (see bot-expense-lifecycle), preserving the 409/404 semantics; the transition itself MUST NOT change.
(Previously: the transition had no bot trigger channel; only the REST endpoint could mark a movement paid.)

#### Scenario: PENDING expense marked paid

- GIVEN a PENDING EXPENSE for the owner
- WHEN `POST /movements/:id/paid` is called
- THEN the movement is `PAID` with `occurredAt` = now and starts counting in KPIs

#### Scenario: Bot triggers the transition conversationally

- GIVEN the owner asks the bot to mark a PENDING expense as paid
- WHEN the bot invokes `POST /movements/:id/paid`
- THEN the movement is `PAID` with `occurredAt` = now and one confirmation reply is sent

#### Scenario: already-PAID rejected

- GIVEN a `PAID` movement
- WHEN `POST /movements/:id/paid` is called
- THEN `409` is returned and nothing changes

#### Scenario: non-EXPENSE rejected

- GIVEN an INCOME movement
- WHEN `POST /movements/:id/paid` is called
- THEN `409` is returned

#### Scenario: missing movement

- GIVEN no movement with that id for the owner
- WHEN `POST /movements/:id/paid` is called
- THEN `404` is returned