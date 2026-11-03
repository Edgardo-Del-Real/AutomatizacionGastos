# Manual Savings Specification

## Purpose

Standalone manual savings registration: the owner reserves amount `x` as savings without an income registration. The movement is type `SAVINGS`, category "ahorro", origin `MANUAL`, and `INDIVIDUAL` by default; `Disponible` (balance) deducts `x` while `x` stays out of expense totals and category breakdowns. Entry points are deterministic bot surfaces only: the `sa:manual` sub-menu action and the `registrar ahorro manual:` text command.

## Requirements

### Requirement: Savings Origin Model

The system MUST store a `savingsOrigin` field on SAVINGS movements (enum `AUTO_SPLIT` | `MANUAL`, nullable). Historical rows MUST stay NULL — NULL means legacy and MUST be inert (all legacy SAVINGS rows were auto-splits by construction); the system MUST NOT backfill. `createIncomeWithSavings` MUST stamp its SAVINGS row `AUTO_SPLIT`; the manual-savings creation path MUST stamp `MANUAL`. No new index is required.

#### Scenario: Migration preserves legacy rows

- GIVEN SAVINGS rows exist before the migration
- WHEN the migration applies
- THEN every row keeps its data and `savingsOrigin` is NULL

#### Scenario: Auto-split stamps AUTO_SPLIT

- GIVEN `createIncomeWithSavings` persists a SAVINGS row
- WHEN the row is read
- THEN its `savingsOrigin` is `AUTO_SPLIT`

#### Scenario: Manual creation stamps MANUAL

- GIVEN a manual savings is created
- WHEN the row is read
- THEN its `savingsOrigin` is `MANUAL`

### Requirement: Manual Savings Creation

`POST /expenses` MUST accept a manual-savings creation (`type: SAVINGS`): `savingsOrigin` MUST be absent or `MANUAL` — `AUTO_SPLIT` MUST return `422 ValidationFailedError` (auto-split rows are produced only by the internal split transaction). The category MUST be the owner's "ahorro" (enforced via `ensureAhorro`): an explicit category other than "ahorro" MUST return `422`; an absent category MUST default to "ahorro". The created row MUST be `SAVINGS` + origin `MANUAL` + category "ahorro" + status `PAID` + currency `ARS`, and MUST default to `INDIVIDUAL` visibility (out-of-band; visibility MUST NOT be patchable). The POST response MUST stay the frozen `expenseSchema` shape; `type`/`savingsOrigin` MUST be observable via GET /movements. The bot-internal path `createManualSavings({ ownerId, amount, note?, occurredAt })` MUST apply the same semantics.

#### Scenario: Manual savings created via the API

- GIVEN `POST /expenses` with `{ type: "SAVINGS", amount: 50, note: "fondo vacaciones" }`
- WHEN processed
- THEN 201 and a row with type SAVINGS, origin MANUAL, category "ahorro", status PAID, visibility INDIVIDUAL

#### Scenario: Category enforced on create

- GIVEN `POST /expenses` with `{ type: "SAVINGS", amount: 50, category: "bolsillo" }`
- WHEN processed
- THEN `422 ValidationFailedError` is returned and nothing is stored

#### Scenario: Category defaulted when absent

- GIVEN `POST /expenses` with `{ type: "SAVINGS", amount: 50 }`
- WHEN processed
- THEN the row stores category "ahorro"

#### Scenario: AUTO_SPLIT rejected on create

- GIVEN `POST /expenses` with `{ type: "SAVINGS", amount: 50, savingsOrigin: "AUTO_SPLIT" }`
- WHEN processed
- THEN `422 ValidationFailedError` is returned and nothing is stored

#### Scenario: Non-positive amount rejected

- GIVEN `POST /expenses` with `{ type: "SAVINGS", amount: 0 }`
- WHEN processed
- THEN `422 ValidationFailedError` is returned and nothing is stored

### Requirement: Balance Deduction Invariant

The summary MUST deduct manual savings from balance: `balance = income − expenses − manualSavings`, deducting only `savingsOrigin = MANUAL` rows within the requested period. AUTO_SPLIT and legacy rows MUST NOT be deducted (split months already store net income; subtracting them again would double-count). `kpis.savings` ("Ahorro del mes") MUST count AUTO_SPLIT + MANUAL rows of the current calendar month. Deleting a manual savings MUST remove its deduction (the money returns to Disponible).

#### Scenario: Manual savings deduct from balance

- GIVEN INCOME 900, EXPENSE 300, and a MANUAL SAVINGS of 50
- WHEN the summary computes
- THEN balance = 550 (900 − 300 − 50) and `kpis.manualSavings` = 50

#### Scenario: Mixed month counts auto and manual

- GIVEN gross 1000 split into INCOME 900 and AUTO_SPLIT SAVINGS 100, EXPENSE 300, and a MANUAL SAVINGS of 50
- WHEN the summary computes
- THEN balance = 550, `kpis.savings` = 150 (100 auto + 50 manual), and income = 900, expenses = 300

#### Scenario: Deleting manual savings returns the money

- GIVEN a MANUAL SAVINGS of 50 registered against INCOME 900 and EXPENSE 300
- WHEN the movement is deleted via `DELETE /movements/:id`
- THEN balance returns to 600 (900 − 300)

### Requirement: Bot Sub-Menu Action

The 💰 Ahorro sub-menu MUST expose a fourth action (`sa:manual`) that starts manual-savings capture: state `AWAITING_MANUAL_SAVINGS` plus a prompt for the amount and an optional note. The next text MUST be parsed like the text command; a valid capture MUST call `createManualSavings`, reply an es-AR confirmation, and return to the main menu. An unparseable reply MUST re-prompt and keep the state. The `sa:manual` callback data MUST stay under 64 bytes and the four-action keyboard within Telegram limits.

#### Scenario: Sub-menu action starts capture

- GIVEN the owner taps 💰 Ahorro and selects the manual savings action
- WHEN the callback is processed
- THEN state `AWAITING_MANUAL_SAVINGS` is set and the amount + optional note prompt replies

#### Scenario: Valid capture confirms and returns to menu

- GIVEN the prompt is open and the owner replies "500 fondo vacaciones"
- WHEN parsed
- THEN `createManualSavings` runs, an es-AR confirmation replies, and the main menu follows

#### Scenario: Unparseable capture re-prompts

- GIVEN the prompt is open and the owner replies "abc"
- WHEN parsed
- THEN nothing is stored, a re-prompt replies, and state stays `AWAITING_MANUAL_SAVINGS`

### Requirement: Bot Text Command

The system MUST register the deterministic command `registrar ahorro manual: <monto> [nota]` (amount required, note optional). It MUST be matched BEFORE the savings-rule regex, and the two MUST be disjoint: `registrar ahorro: manual al 10%` remains a savings RULE with keyword "manual". A non-numeric or non-positive amount MUST reply a validation error and MUST NOT store anything. The slash form `/registrar_ahorro_manual` MUST work through command normalization.

#### Scenario: Command registers manual savings

- GIVEN the owner sends "registrar ahorro manual: 500 fondo vacaciones"
- WHEN processed
- THEN `createManualSavings` stores 500 with note "fondo vacaciones" and a confirmation replies

#### Scenario: Command with amount only

- GIVEN the owner sends "registrar ahorro manual: 500"
- WHEN processed
- THEN a MANUAL SAVINGS of 500 is stored with no note

#### Scenario: Invalid amount rejected

- GIVEN the owner sends "registrar ahorro manual: 0" or "registrar ahorro manual: abc"
- WHEN processed
- THEN a validation reply is sent and nothing is stored

#### Scenario: Rule command stays a rule

- GIVEN the owner sends "registrar ahorro: manual al 10%"
- WHEN processed
- THEN it defines a savings rule with keyword "manual" — no manual savings is created