# Delta for Telegram Bot

## MODIFIED Requirements

### Requirement: Movement Parsing, Classification and Categorization

The system MUST reuse the shared parser for amount/note extraction and MUST classify `INCOME`/`EXPENSE` per the existing deterministic rules. Categorization MUST be deterministic-first: the shared category matcher runs before the note interpreter, and user-authored keyword rules MUST beat interpreter suggestions. The note interpreter MUST be invoked only on a keyword miss (category suggestion) or on a deterministic amount-parse failure (amount rescue), and MUST NOT be invoked when a keyword matches. An interpreter-suggested category MUST be used only when it exactly matches an owner category via `normalizeForMatch`; otherwise the movement MUST be created in "otro" and the existing `awaiting_category` correction MUST follow — the interpreter MUST NEVER auto-create categories. When the deterministic amount is absent but the interpreter returns a valid amount, the system MUST register the movement directly with the interpreter amount. When both amounts exist and differ, the system MUST NOT register anything silently; it MUST ask the owner which amount is correct (see Amount-Conflict Question). When the interpreter is unavailable or returns `null`, the system MUST behave exactly as today: a keyword miss falls to "otro" + correction, and a message with no parseable amount is replied to with help text.
(Previously: parsing and categorization were purely deterministic; a message with no parseable amount always received help text and no interpreter existed.)

**Feature: Interpreter-enhanced registration**
#### Scenario: Keyword classification
- GIVEN owner text "Recibí $50000 de sueldo"
- WHEN the message is processed
- THEN an `INCOME` movement is created
- AND it is assigned a matched category when one applies, else "otro"
#### Scenario: Matched note skips the interpreter
- GIVEN owner text matching a user-authored keyword rule
- WHEN the message is processed
- THEN the movement registers with the matched category
- AND the interpreter is not invoked
#### Scenario: Keyword miss with resolvable interpreter category
- GIVEN owner text matching no keyword rule and an interpreter suggestion that exactly matches an owner category
- WHEN the message is processed
- THEN a movement registers with the interpreter category and a success reply is sent
- AND no correction round-trip occurs
#### Scenario: Keyword miss with unknown interpreter category
- GIVEN owner text matching no keyword rule and an interpreter suggestion not in the owner's category list
- WHEN the message is processed
- THEN the movement registers in "otro"
- AND the `awaiting_category` correction is offered
- AND no category is auto-created
#### Scenario: No amount rescued by the interpreter
- GIVEN owner text "gaste como 5 mil pesos" with no deterministic amount and an interpreter amount of 5000
- WHEN the message is processed
- THEN a movement registers directly with amount 5000 and a success reply is sent
#### Scenario: No amount and interpreter null
- GIVEN owner text with no deterministic amount and an interpreter result of `null`
- WHEN the message is processed
- THEN no movement is created
- AND a help reply is sent
#### Scenario: Conflicting amounts ask the owner
- GIVEN a deterministic amount of 5000 and an interpreter amount of 4800 on a keyword miss
- WHEN the message is processed
- THEN no movement is registered
- AND the bot asks which amount is correct
#### Scenario: No interpreter configured degrades to today
- GIVEN `GROQ_API_KEY` is unset
- WHEN a keyword-miss or amountless message is processed
- THEN the behavior is identical to today (otro + correction, or help reply)

### Requirement: Correction Loop (awaiting_category) and Learning

When a movement is assigned to "otro", the system MUST reply asking for the correct category, enter `awaiting_category`, and remember the pending movement. In `awaiting_category`, a reply whose normalized text exactly matches an existing category name is the ANSWER; a reply that parses as an amount is a NEW registration that abandons the pending correction; a single-token reply that is not an existing category MUST auto-create that category and apply it; any other multi-word reply MUST list the existing categories without closing the state. A valid answer MUST reassign the pending movement to that category and confirm. Correction answers MUST NOT learn keyword rules — keyword rules are created only through the explicit `asociar palabra` command.
(Previously: corrections learned a keyword rule mapping the original note's first significant word to the answered category, and every non-answer text was treated as a new registration.)

**Feature: Correction loop without learning**
#### Scenario: Unmatched triggers correction
- GIVEN an owner registration matches no rule
- WHEN it is created as "otro"
- THEN the owner enters `awaiting_category`
- AND the bot asks for the correct category
#### Scenario: Answer reassigns without learning
- GIVEN the owner is in `awaiting_category` for note "uber viaje"
- WHEN they reply "Transporte"
- THEN the pending movement is reassigned to "Transporte"
- AND no keyword rule is created
#### Scenario: Unknown single-token answer auto-creates the category only
- GIVEN the owner is in `awaiting_category`
- WHEN they reply "Mascotas" which is not an existing category
- THEN category "Mascotas" is auto-created and the pending movement is assigned to it
- AND no keyword rule is learned
#### Scenario: Amount during awaiting_category is a new registration
- GIVEN the owner is in `awaiting_category`
- WHEN they send "$8000 supermercado"
- THEN it is treated as a new registration, not an answer, and the pending correction is abandoned
- AND processing follows the normal registration path
#### Scenario: Multi-word non-category answer lists categories
- GIVEN the owner is in `awaiting_category`
- WHEN they reply with a multi-word text that matches no category
- THEN the bot lists the existing categories and the state stays open
- AND the movement remains safely in "otro"

### Requirement: Per-Owner State Machine

The system MUST persist, per owner, a state machine with values `idle`, `awaiting_setup`, and `awaiting_category`, plus a pending amount-conflict question (exact state value is a design decision). Transitions MUST be explicit and testable: registration when owner has no categories → `awaiting_setup`; assignment to "otro" → `awaiting_category`; resolved answer or completed setup → `idle`; an answer that is a new registration during `awaiting_category` MUST remain in the registration path without corrupting the pending correction. The pending movement for a correction MUST be persisted so it survives a restart. The pending amount-conflict question MUST be persisted with the same abandonment and restart semantics as `awaiting_category`: a reply matching a presented amount resolves it, and any other text abandons it (nothing registers from the conflicting message) and is processed as a new registration.
(Previously: only `idle`, `awaiting_setup`, and `awaiting_category` existed; no amount-conflict question.)

**Feature: State transitions and conflict question**
#### Scenario: Idle to setup
- GIVEN an owner in `idle` with no categories
- WHEN a valid registration is processed
- THEN the owner transitions to `awaiting_setup`
#### Scenario: Correction to idle
- GIVEN an owner in `awaiting_category`
- WHEN a valid answer is given
- THEN the owner transitions back to `idle`
#### Scenario: Pending correction survives restart
- GIVEN an owner in `awaiting_category` with a pending movement
- WHEN the process restarts
- THEN the pending movement and state are still present
#### Scenario: Conflict answer registers the chosen amount
- GIVEN the bot asked which of 5000 and 4800 is correct
- WHEN the owner replies "5000"
- THEN a movement registers with 5000 and the question closes
#### Scenario: Conflict abandoned by a new registration
- GIVEN the bot asked which amount is correct
- WHEN the owner sends a new registration instead
- THEN the pending question is abandoned, nothing registers from the conflicting message, and the new registration is processed normally
#### Scenario: Pending conflict question survives restart
- GIVEN an unanswered amount-conflict question
- WHEN the process restarts
- THEN the pending question and its movement context are still present

## Pre-Existing Drift (not fixed by this change)

- The canonical "Correction Loop (awaiting_category) and Learning" requirement still mandates keyword auto-learning; the current implementation (D6) only reassigns movements — keyword rules are created exclusively via `asociar palabra`. This delta reflects the current behavior.
- The canonical "Correction Loop" text treats every non-answer as a new registration; the current implementation auto-creates single-token answers and lists categories for multi-word non-answers. This delta reflects the current behavior.