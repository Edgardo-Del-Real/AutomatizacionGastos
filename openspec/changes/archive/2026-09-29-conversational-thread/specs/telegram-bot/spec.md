# Delta for telegram-bot

## MODIFIED Requirements

### Requirement: Success and Help Reply Content

The system MUST reply to a successfully registered movement with a confirmation that includes the amount, the note, and the assigned category; the confirmation MUST be the brain's `reply` text when the brain is available and returns one, and MUST fall back to the fixed success template carrying the same facts. The system MUST reply to an unparseable message with help text (brain-written or fixed). The system MUST reply to off-topic messages with an expense-scoped redirect — never as general chat. Query messages MUST be answered from the EXECUTED query result (brain-written from the executed query or the fixed query template); an honest redirect is used only when query execution fails or the type is unresolvable. A reply MUST NOT be sent for non-owner, edited, empty, or deduplicated messages. The system MUST reply to collection questions (ask amount, ask category, kept collecting) through the `asked_registration` action with fixed fallback templates when the brain reply is null. The system MUST reply to a `greeting`-classified message with a warm, expense-scoped greeting, and MUST NOT close any open dialog when doing so.
(Previously: off-topic and query messages both received expense-scoped redirects, and queries were never executed; collection questions and greetings had no reply surface.)

#### Scenario: Success confirmation

- GIVEN an owner registers "$2500 cafe"
- WHEN the movement is created
- THEN a confirmation with amount, note, and category is sent (brain-written from the executed result or the fixed template)

#### Scenario: Unparseable gets help

- GIVEN owner text with no parseable amount and a brain result of `null`
- WHEN the message is processed
- THEN a help reply is sent and no movement is created

#### Scenario: Off-topic gets a redirect, never a chat answer

- GIVEN an owner message classified `off_topic`
- WHEN the message is processed
- THEN an expense-scoped redirect reply is sent
- AND no movement is created and no general-chat answer is produced

#### Scenario: Query gets an executed answer

- GIVEN an owner message classified `query_recent` and a successful executor run
- WHEN the message is processed
- THEN the reply answers with the owner's real recent movements
- AND a redirect is sent only when the execution fails

#### Scenario: Collection question uses the ask template

- GIVEN the brain returns `null` for `reply` on a collection question
- WHEN the dialog asks for the amount or the category
- THEN the fixed `asked_registration` template carrying the question is sent

#### Scenario: Greeting keeps the dialog alive

- GIVEN an owner in `awaiting_registration` sends "hola"
- WHEN the message is classified `greeting`
- THEN a warm greeting replies and the open collection dialog and its payload stay intact

### Requirement: Per-Owner State Machine

The system MUST persist, per owner, a state machine with values `idle`, `awaiting_setup`, and `awaiting_category`, plus a pending amount-conflict question (exact state value is a design decision). The system MUST add a fourth state `awaiting_registration` for registration detail collection, kept distinct from `awaiting_category` (correction of an already-registered movement) — the two MUST NOT be conflated. Transitions MUST be explicit and testable: registration when owner has no categories → `awaiting_setup`; assignment to "otro" → `awaiting_category`; resolved answer or completed setup → `idle`; an answer that is a new registration during `awaiting_category` MUST remain in the registration path without corrupting the pending correction; a registration with a null amount or an unresolvable category intent → `awaiting_registration` (see registration-collection); a completed or abandoned collection → `idle`. The pending movement for a correction MUST be persisted so it survives a restart. The pending amount-conflict question MUST be persisted with the same abandonment and restart semantics as `awaiting_category`. The `awaiting_registration` collect payload MUST be persisted with the same restart semantics, and a corrupt payload MUST recover without registering anything. With the brain active, a `resolve` answer MUST act ONLY on the persisted payload — a bare affirmation or a resolve with no matching payload value abandons the question with a clear reply and is NOT reprocessed as a registration (phantom guard); the deterministic fallback (brain null/absent) keeps today's behavior: a reply matching a presented amount resolves it, and any other text abandons it (nothing registers from the conflicting message) and is processed as a new registration.
(Previously: the state machine had only `idle`, `awaiting_setup`, and `awaiting_category`; there was no `awaiting_registration` state and no collect-payload persistence.)

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

#### Scenario: Null-amount registration enters collection

- GIVEN a `register_expense` envelope with amount null
- WHEN the message is processed
- THEN the owner transitions to `awaiting_registration` and the collect payload is persisted

#### Scenario: Collection completes to idle

- GIVEN an owner in `awaiting_registration` whose amount and category are both resolved
- WHEN the registration is created
- THEN the owner returns to `idle` and the collect payload clears

### Requirement: Intent-First Message Handling

For every non-command owner message in `idle`, the system MUST invoke the bot brain's `interpret` before deterministic execution and MUST route on the returned intent: `register_expense` runs the existing registration flow (with the brain's amount/category/note; a null amount enters `awaiting_registration` per registration-collection); `query`/`query_recent`/`query_balance`/`query_month` execute the deterministic query executor and answer from real data (an honest redirect replies only when the query fails or the type is unresolvable); `associate_keyword` redirects to the `asociar palabra` command; `help` replies with help; `off_topic` replies with an expense-scoped redirect and MUST NOT be answered as general chat; `greeting` replies with a warm expense-scoped greeting and MUST NOT close any open dialog; `correct_amount` is reserved and replies with deterministic help in `idle`; `correct_category` runs the movement-correction flow (see movement-correction). The setup gate (owner with no categories) MUST take precedence over `interpret`: such messages go straight to `awaiting_setup` with no brain call. The state machine MUST remain authoritative — the LLM MUST never decide state transitions. `interpret` MUST NOT be invoked for commands or the setup flow; for dialog-state messages (`awaiting_category`, `awaiting_amount_confirmation`, `awaiting_registration`) it MUST be invoked with dialog context and the envelope's `dialog_action` routes the message (see Dialog Controller), with today's deterministic rules as the fallback when the brain is null/absent. When `interpret` returns `null` in `idle`, the system MUST behave exactly as today.
(Previously: queries were answered with an honest not-supported redirect; `correct_amount` and `correct_category` were both reserved with deterministic help; `interpret` was never invoked in dialog states; there was no `greeting` intent and null-amount registrations dead-ended in a free-text question with no state.)

#### Scenario: Register intent runs the existing flow

- GIVEN a brain envelope `{intent:"register_expense", amount:5000, category:"Supermercado", note:"gaste en el super"}`
- WHEN the message is processed in `idle`
- THEN the registration flow runs with amount 5000 and category "Supermercado"

#### Scenario: Keyword rule beats the brain suggestion

- GIVEN owner text matching a user-authored keyword rule and a brain category suggestion
- WHEN the message is processed
- THEN the movement registers with the matched keyword category and the brain suggestion is ignored

#### Scenario: Query intent executes and answers from real data

- GIVEN owner text "cuánto gasté" classified `query_balance`
- WHEN the message is processed
- THEN no movement is created and the balance query executor answers with the owner's real summary
- AND an honest redirect is sent only if the query execution fails

#### Scenario: Off-topic redirects

- GIVEN owner text classified `off_topic`
- WHEN the message is processed
- THEN the reply is an expense-scoped redirect and no movement is created

#### Scenario: Greeting replies warm and keeps the thread

- GIVEN owner text "hola" classified `greeting` with an open `awaiting_registration` dialog
- WHEN the message is processed
- THEN a warm greeting replies and the open dialog stays alive

#### Scenario: Setup gate precedes the brain

- GIVEN an owner with no categories sends "$2500 cafe"
- WHEN the message is processed
- THEN the owner enters `awaiting_setup` and `interpret` is not invoked

#### Scenario: Brain null behaves as today

- GIVEN `GROQ_API_KEY` unset or a brain result of `null`
- WHEN a message is processed in `idle`
- THEN the behavior is identical to today (deterministic parse, otro + correction, or help)

#### Scenario: Dialog answers route through the brain

- GIVEN a message in `awaiting_category`, `awaiting_amount_confirmation`, or `awaiting_registration`
- WHEN it is processed
- THEN `interpret` is invoked with dialog context and the envelope's `dialog_action` routes the message
- AND the deterministic rules apply only as the fallback (brain null/absent/abandon)

### Requirement: Dialog Controller (Brain-Routed Dialogs)

For every non-command owner message in a dialog state (`awaiting_category`, `awaiting_amount_confirmation`, `awaiting_registration`), the system MUST invoke the bot brain's `interpret(body, { state, pending, openQuestion })` BEFORE the deterministic dialog rules and MUST route on the envelope's `dialog_action`: `resolve` → deterministic resolution from the persisted payload ONLY (reassign the pending movement to the answered category, register the chosen amount, or resolve the collected amount/category per registration-collection); `abandon` or brain null/absent → today's D6 rules verbatim (for `awaiting_registration`: clear the collect payload, reply, nothing registers); `null` → intent routing with the pending untouched (queries and CRUD execute; `register_expense` abandons the dialog and registers the new message). Commands MUST still be handled before any state logic, in every state. Queries and CRUD intents during dialogs MUST NOT consume the pending. Phantom guard: a `resolve` answer MUST act ONLY on the persisted payload — no valid payload → abandon with a clear reply, nothing registers, and no amount is ever fabricated.
(Previously: the dialog controller covered only `awaiting_category` and `awaiting_amount_confirmation`; `awaiting_registration` did not exist.)

#### Scenario: Query in dialog answers without consuming the pending

- GIVEN an owner in `awaiting_category` with a pending movement asks "decime los últimos movimientos"
- WHEN the brain returns `dialog_action: null` with a query intent
- THEN the recent-query executor answers with real data
- AND the pending movement and `awaiting_category` state stay intact

#### Scenario: Resolve answer reassigns the pending movement

- GIVEN an owner in `awaiting_category` with a pending movement replies "Transporte"
- WHEN the brain returns `dialog_action: "resolve"`
- THEN the pending movement is reassigned to "Transporte" and the owner returns to `idle`

#### Scenario: Resolve answer registers the chosen amount

- GIVEN an owner in `awaiting_amount_confirmation` with presented amounts 5000 and 4800 replies "5000"
- WHEN the brain returns `dialog_action: "resolve"`
- THEN a movement registers with 5000 from the persisted payload and the question closes

#### Scenario: Phantom guard blocks a bare affirmation

- GIVEN an owner in `awaiting_amount_confirmation` with presented amounts 5000 and 4800 replies "si"
- WHEN the brain returns `dialog_action: "resolve"` with no matching payload amount
- THEN nothing registers, the question abandons with a clear reply, and no amount is fabricated

#### Scenario: New registration during a dialog abandons the pending

- GIVEN an owner in `awaiting_category` sends "$8000 supermercado"
- WHEN the brain returns `dialog_action: null` with `register_expense`
- THEN the pending correction is abandoned and the new message follows the normal registration path

#### Scenario: CRUD during a dialog does not consume the pending

- GIVEN an owner in `awaiting_category` with a pending movement sends "creá una categoría mascotas"
- WHEN the brain returns `dialog_action: null` with `create_category`
- THEN the category is created, the pending movement stays intact, and the state stays open

#### Scenario: Brain absent in a dialog degrades to D6

- GIVEN `GROQ_API_KEY` is unset and an owner in `awaiting_category` replies with a multi-word non-category text
- WHEN the message is processed
- THEN the bot lists the existing categories and the state stays open (today's rules verbatim)

#### Scenario: Collection resolve follows the cascade

- GIVEN an owner in `awaiting_registration` asked for the category replies "Transporte"
- WHEN the brain returns `dialog_action: "resolve"`
- THEN the category cascade resolves "Transporte" from the persisted payload and the registration completes

#### Scenario: Collection abandon clears the payload

- GIVEN an owner in `awaiting_registration` with a persisted payload replies "no, dejalo"
- WHEN the brain returns `dialog_action: "abandon"`
- THEN the collect payload clears, a clear reply is sent, and nothing registers