# Planned Fixed Expenses Specification

## Purpose

Register fixed expenses as `PENDING` EXPENSE movements that stay invisible to KPIs until the owner marks them paid. A previsto carries no planned date: it keeps its load date in `occurredAt` and is shown only in the outstanding `planned` total. Marking it paid rewrites `occurredAt` to the real payment date, and only then does the amount enter expenses, balance, and charts — in the month it was actually paid.
(Previously: the planned target month was derived as `occurredAt` + 1 month in Buenos Aires, so previstos were dated to the following month.)

## Requirements

### Requirement: Movement Status Model

The system MUST store a `status` field on every movement (enum `MovementStatus` = `PENDING` | `PAID`) with default `PAID`, and the migration MUST backfill existing rows as `PAID` atomically (`CREATE TYPE` + `ADD COLUMN ... NOT NULL DEFAULT`). Status MUST be meaningful only for `EXPENSE`; `INCOME` and `SAVINGS` MUST always be `PAID`.

#### Scenario: Migration preserves existing rows

- GIVEN movements exist before the migration
- WHEN the migration applies
- THEN all existing rows have `status=PAID`

#### Scenario: Default on creation

- GIVEN a movement created without an explicit status
- WHEN it is persisted
- THEN it is stored as `PAID`

#### Scenario: PENDING stored

- GIVEN a planned expense created with `status: "PENDING"`
- WHEN it is persisted
- THEN its status is `PENDING`

### Requirement: Planned Expenses Carry No Date

A `PENDING` movement MUST NOT carry a planned target month: it MUST keep the load date in `occurredAt` from creation and MUST NOT be tied to a projected month. The `planned` block MUST count every outstanding PENDING EXPENSE regardless of its `occurredAt`. When marked paid, `markPaidById` rewrites `occurredAt` to the payment date so the amount enters the KPIs of the month the payment happened.

#### Scenario: A previsto has no planned date

- GIVEN a PENDING expense loaded on 2026-08-15
- WHEN the planned block is computed
- THEN the expense is counted regardless of any projected month

#### Scenario: Old previstos still count

- GIVEN a PENDING expense loaded two months ago and never paid
- WHEN the planned block is computed
- THEN it is still included in `planned.total`

### Requirement: Planned Creation Guards

`createMovementSchema` MUST accept an optional `status`, and `PENDING` MUST be valid only for `EXPENSE`; a `PENDING` `INCOME` or `SAVINGS` creation MUST be rejected. A `PENDING` registration MUST NOT trigger any savings split. Planned expenses are INDIVIDUAL by design: a `PENDING` movement MUST always persist as `INDIVIDUAL` visibility, and a shared signal (prefix, flag, or payload key) MUST NOT make it `SHARED`.

#### Scenario: PENDING income rejected

- GIVEN a creation payload with `type: "INCOME"` and `status: "PENDING"`
- WHEN validated
- THEN it is rejected

#### Scenario: PENDING never splits savings

- GIVEN a PENDING EXPENSE matching a savings-rule keyword
- WHEN it is registered
- THEN no savings split applies (only INCOME splits)

#### Scenario: PENDING is always INDIVIDUAL

- GIVEN a planned expense created while a shared signal is present (e.g. a `visibility: "SHARED"` payload key)
- WHEN it is persisted
- THEN its visibility is `INDIVIDUAL` and it is never visible to the partner

### Requirement: KPI Exclusion (PENDING_EXCLUDED)

A `PENDING` movement MUST NOT contribute to income, expenses, balance, per-month/per-day buckets, category breakdowns, or top lists. `summaryMonths` MUST exclude PENDING from its income/expense sums while keeping the `savings` column intact. `kpis.savings` MUST remain unchanged by PENDING movements. The movement list (`GET /movements`) MUST include PENDING rows.

#### Scenario: PENDING create leaves KPIs unchanged

- GIVEN INCOME 900, EXPENSE 300, and a new PENDING EXPENSE 2500
- WHEN the summary is requested
- THEN income=900, expenses=300, balance=600, and no bucket includes 2500

#### Scenario: SAVINGS column survives exclusion

- GIVEN SAVINGS 100 this month and a PENDING EXPENSE 2500
- WHEN the summary is requested
- THEN `mom.months[].savings` is 100 and the PENDING amount never replaces or reduces it

#### Scenario: PENDING visible in the list

- GIVEN an owner with a PENDING movement
- WHEN `GET /movements` is called
- THEN the PENDING row is returned

### Requirement: Planned Summary Block

`movementSummarySchema` MUST include `planned: { month, total }`, where `total` is the sum of the owner's OUTSTANDING PENDING EXPENSE movements (every PENDING EXPENSE; no date derivation). `month` MUST remain the next-month key as an informational label only and the block MUST ignore any `from`/`to` filters.
(Previously: `total` was the sum of PENDING movements targeted at the month derived from `occurredAt` + 1 month, so previstos were dated to the following month.)

#### Scenario: planned reports every outstanding previsto

- GIVEN PENDING EXPENSE 2500 loaded this month
- WHEN the summary is requested
- THEN `planned` is `{ month: <next month key>, total: 2500 }`

#### Scenario: an old previsto still counts

- GIVEN a PENDING expense loaded two months ago and never paid
- WHEN the summary is requested
- THEN it is still included in `planned.total`

#### Scenario: planned ignores date filters

- GIVEN `from`/`to` limited to the current month
- WHEN the summary is requested
- THEN `planned` still reports the outstanding total

#### Scenario: no pending planned is zero

- GIVEN no PENDING EXPENSE
- WHEN the summary is requested
- THEN `planned.total` is 0

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

### Requirement: Planned Expense Creation Channels

A planned expense MUST be creatable from two channels: the bot's `📅 Gasto previsto` menu button (capture type PENDING → `monto+nota` → preview → save) and the dashboard's "Agregar previsto" action. Both MUST create a `PENDING` EXPENSE through the existing registration path. The `previsto:` prefix is REMOVED: a message starting with `previsto:` in `idle` MUST reply with an educational redirect teaching the 📅 button and MUST NOT create anything. Planned expenses are INDIVIDUAL by design: a PENDING capture MUST never carry SHARED visibility, and the dashboard form MUST NOT offer a shared control.
(Previously: the bot channel was the `previsto:` prefix, which rejected combination with `compartido:`.)

#### Scenario: bot registers a planned expense from the button

- GIVEN an owner tapped `📅 Gasto previsto` and sends "2500 alquiler", then picks a category
- WHEN `✅ Guardar` executes
- THEN a PENDING EXPENSE of 2500 is created

#### Scenario: legacy previsto prefix redirects

- GIVEN owner text "previsto: 2500 alquiler"
- WHEN it is processed
- THEN the educational redirect teaches the 📅 Gasto previsto button and nothing is created

#### Scenario: PENDING is always INDIVIDUAL

- GIVEN a PENDING capture whose preview carries any shared signal
- WHEN it is persisted
- THEN its visibility is `INDIVIDUAL` and it is never visible to the partner

#### Scenario: dashboard adds a planned expense

- GIVEN the "Agregar previsto" form with amount, note, and category
- WHEN the owner submits
- THEN a PENDING EXPENSE is created