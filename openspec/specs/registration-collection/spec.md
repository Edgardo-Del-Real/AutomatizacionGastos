# Registration-Collection Specification

## Purpose

Persisted "collect registration" dialog: when a registration arrives with no amount or an unresolvable category, the bot enters `awaiting_registration`, persists the collected facts, asks one question at a time (amount first, then category), and registers from stored context. The LLM only classifies; entry, persist, resolve, and consume are deterministic.

## Requirements

### Requirement: Collect Dialog State and Payload

The system MUST define a dialog state `awaiting_registration`, distinct from `awaiting_category` (which stays correction-of-registered-movement with its `pendingMovementId` phantom guard). The persisted payload MUST be a zod-validated JSON in `BotState.pendingNote` carrying `{body, note, amount (nullable), category (nullable), shared, planned, override}`, mirroring the amount-confirmation payload pattern. No Prisma migration: `pendingNote` + zod is the version contract.

#### Scenario: Payload persists collect facts

- GIVEN a `register_expense` envelope with amount null and note "gym"
- WHEN the bot enters `awaiting_registration`
- THEN the payload persists `{note:"gym", amount:null, category:null, shared, planned, override}` in `pendingNote`

#### Scenario: Correction semantics untouched

- GIVEN an owner in `awaiting_category` with a registered pending movement
- WHEN the movement is reassigned
- THEN correction semantics and the `pendingMovementId` phantom guard apply unchanged

### Requirement: Deterministic Entry and Persistence

Entry MUST be deterministic: (a) the `executeRegistration` amount-null branch (deterministic and brain amounts both null) MUST enter `awaiting_registration` and persist the payload instead of emitting an unpersisted free-text question; (b) when the envelope signals a category intent and neither the deterministic match nor the suggestion resolves, the bot MUST enter the same state. The state machine remains the transition authority — the LLM MUST NOT transition state.

#### Scenario: Amount-null entry persists

- GIVEN owner text "quiero cargar un gasto previsto" classified `register_expense` with amount null
- WHEN the message is processed
- THEN the bot enters `awaiting_registration`, persists the payload, and asks the amount
- AND no movement is created and no unpersisted free-text question is sent

#### Scenario: Category-unresolved entry

- GIVEN an envelope with a resolved amount but a category intent that resolves to nothing
- WHEN the message is processed
- THEN the bot enters `awaiting_registration` with the amount persisted and asks the category

#### Scenario: No category signal keeps otro

- GIVEN a brain envelope with no category signal and no deterministic match
- WHEN the message is processed
- THEN the movement registers in "otro" with the existing correction offer (unchanged)

### Requirement: Amount-Answer Resolution

An amount answer MUST resolve from the message (deterministic parse or brain amount) against the persisted payload only — never fabricated. With amount and category resolved, the bot MUST register from stored context and return to `idle`. With only the amount resolved, the bot MUST persist it and ask the category.

#### Scenario: Amount answer completes the registration

- GIVEN an owner in `awaiting_registration` with `category` already resolved
- WHEN the owner replies "5000"
- THEN a movement registers with 5000, the payload clears, and the owner returns to `idle`

#### Scenario: Amount answer keeps collecting

- GIVEN an owner in `awaiting_registration` with `category` unresolved
- WHEN the owner replies "5000"
- THEN the payload updates with amount 5000 and the bot asks the category

### Requirement: Category-Answer Cascade

A category answer MUST resolve through the deterministic cascade in order: exact normalized match; folded-plural match; no auto-create — a single-token non-match MUST present the closed-set category buttons and STAY open (never auto-creates, never dead-ends); a multi-word non-match lists the existing categories as buttons and STAYS open.
(Previously: a single-token non-match auto-created the category through the guarded `CategoryService.createCategory` and completed the registration.)

#### Scenario: Exact match resolves

- GIVEN an owner in `awaiting_registration` asked for the category
- WHEN the owner replies "Transporte" matching an existing category
- THEN the registration completes with "Transporte" and the owner returns to `idle`

#### Scenario: Multi-word non-match lists buttons and stays open

- GIVEN an owner in `awaiting_registration` asked for the category
- WHEN the owner replies with a multi-word text matching no category
- THEN the bot presents the category buttons and the state stays open

#### Scenario: Single-token non-match shows buttons and never auto-creates

- GIVEN an owner in `awaiting_registration` replies "Mascotas" (not existing, not reserved)
- WHEN the cascade reaches the non-match step
- THEN no category is created, the category buttons render, and the state stays open

### Requirement: Abandon Handling

An explicit abandon (`dialog_action:"abandon"` or a deterministic "no, dejalo" reply) MUST clear the collect payload, reply clearly, and MUST NOT register anything from the abandoned message.

#### Scenario: Abandon clears the collect

- GIVEN an owner in `awaiting_registration` with a persisted payload
- WHEN the owner replies "no, dejalo"
- THEN the payload clears, a clear reply is sent, and nothing registers

### Requirement: Non-Consuming Intents

Queries, CRUD, and `off_topic` messages during `awaiting_registration` MUST execute without consuming the pending: payload and state MUST stay intact.

#### Scenario: Query during collect does not consume

- GIVEN an owner in `awaiting_registration` with a payload
- WHEN the owner asks "decime los últimos movimientos"
- THEN the query executor answers with real data and the pending payload stays intact

#### Scenario: CRUD during collect does not consume

- GIVEN an owner in `awaiting_registration` with a payload
- WHEN the owner sends "creá una categoría mascotas"
- THEN the category is created and the pending payload stays intact

### Requirement: Restart and Corrupt-Payload Recovery

The collect payload MUST survive a process restart. A corrupt `pendingNote` payload MUST NOT crash or register anything: it MUST recover by abandoning the dialog with a clear reply (amount-confirmation precedent).

#### Scenario: Collect survives restart

- GIVEN an owner in `awaiting_registration` with a persisted payload
- WHEN the process restarts
- THEN the state and payload are still present and the dialog continues

#### Scenario: Corrupt payload recovers

- GIVEN `pendingNote` holds invalid JSON for the collect payload
- WHEN the owner sends any message
- THEN the dialog abandons with a clear reply and nothing registers

### Requirement: Deterministic-Only Mode

Without the brain, collection MUST fire only on brain envelopes or deterministic prefixes (`previsto:`/`compartido:` without amount); a no-brain bare noun MUST still receive the help reply, unchanged.

#### Scenario: No-brain bare noun keeps help

- GIVEN `GROQ_API_KEY` is unset
- WHEN the owner sends "gym"
- THEN the help reply is sent and no collect dialog starts

### Requirement: asked_registration Reply Action

The system MUST reply to collection questions through a dedicated `asked_registration` action with fixed fallback templates (ask amount, ask category, kept collecting) when the brain reply is null; the LLM reply MUST ask only grounded questions from the executed result.

#### Scenario: Fixed fallback asks the amount

- GIVEN the brain returns `null` for `reply` on an amount-null entry
- WHEN the collect dialog opens
- THEN the fixed ask-amount template is sent

#### Scenario: Fixed fallback asks the category

- GIVEN the brain returns `null` for `reply` after the amount resolves
- WHEN the category question is asked
- THEN the fixed ask-category template is sent