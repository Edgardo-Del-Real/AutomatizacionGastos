# Planned Fixed Expenses Specification

## Purpose

Register next month's fixed expenses as `PENDING` EXPENSE movements that stay invisible to KPIs until the owner marks them paid. The planned month is derived from the load date (`occurredAt` + 1 month, Buenos Aires) with no stored month column; marking paid rewrites `occurredAt` to the real payment date, and only then do the amounts enter expenses, balance, and charts.

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

### Requirement: Planned Month Derivation

The planned target month MUST be derived as `occurredAt` (load date) + 1 month in `America/Argentina/Buenos_Aires`. The system MUST NOT store a planned-month column. A `PENDING` movement MUST keep the load date in `occurredAt` until marked paid.

#### Scenario: Derived from load date

- GIVEN a PENDING expense loaded on 2026-08-15
- WHEN the planned month is computed
- THEN the target month is 2026-09

#### Scenario: Buenos Aires boundary

- GIVEN a PENDING expense with `occurredAt` 2026-08-01T02:59:00Z (= 2026-07-31 23:59 Buenos Aires)
- WHEN the planned month is computed
- THEN the target month is 2026-08 (load month is July, plus one)

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

`movementSummarySchema` MUST include `planned: { month, total }`, where `total` is the sum of the owner's PENDING EXPENSE movements targeted at `month`. The `planned` block MUST always target the month following the current Buenos Aires month and MUST ignore any `from`/`to` filters.

#### Scenario: planned reports next month

- GIVEN PENDING EXPENSE 2500 loaded this month
- WHEN the summary is requested
- THEN `planned` is `{ month: <next month>, total: 2500 }`

#### Scenario: planned ignores date filters

- GIVEN `from`/`to` limited to the current month
- WHEN the summary is requested
- THEN `planned` still reports the next-month total

#### Scenario: no pending planned is zero

- GIVEN no PENDING EXPENSE
- WHEN the summary is requested
- THEN `planned.total` is 0

### Requirement: Mark Paid Transition

The system MUST provide `POST /movements/:id/paid` scoped by owner (`x-owner-id`). It MUST require the movement to be `EXPENSE` and `PENDING`; marking an already-`PAID` movement or a non-EXPENSE movement MUST return `409`. A missing movement or one owned by another owner MUST return `404`. The transition MUST set `status=PAID` and `occurredAt=now` in a single write; afterwards the movement MUST enter expenses, balance, and charts on its payment date.

#### Scenario: PENDING expense marked paid

- GIVEN a PENDING EXPENSE for the owner
- WHEN `POST /movements/:id/paid` is called
- THEN the movement is `PAID` with `occurredAt` = now and starts counting in KPIs

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

A planned expense MUST be creatable from both channels: the bot's `previsto:` prefix and the dashboard's "Agregar previsto" action. Both MUST create a `PENDING` EXPENSE through the existing registration path. Planned expenses are INDIVIDUAL by design: the bot MUST reject `previsto:` combined with `compartido:` (either order) with an educational redirect and MUST NOT create anything; the dashboard form MUST NOT offer a shared control and its payload MUST never carry visibility.

#### Scenario: bot registers a planned expense

- GIVEN owner text "previsto: 2500 alquiler"
- WHEN it is processed
- THEN a PENDING EXPENSE of 2500 is created

#### Scenario: bot rejects a shared previsto

- GIVEN owner text "compartido: previsto: 2500 alquiler" (or "previsto: compartido: 2500 alquiler")
- WHEN it is processed
- THEN an educational redirect replies and nothing is created

#### Scenario: dashboard adds a planned expense

- GIVEN the "Agregar previsto" form with amount, note, and category
- WHEN the owner submits
- THEN a PENDING EXPENSE is created