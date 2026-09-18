# Delta for Telegram Bot

## ADDED Requirements

### Requirement: Dialog Controller (Brain-Routed Dialogs)

For every non-command owner message in a dialog state (`awaiting_category`, `awaiting_amount_confirmation`), the system MUST invoke the bot brain's `interpret(body, { state, pending, openQuestion })` BEFORE the deterministic dialog rules and MUST route on the envelope's `dialog_action`: `resolve` → deterministic resolution from the persisted payload ONLY (reassign the pending movement to the answered category, or register the chosen amount); `abandon` or brain null/absent → today's D6 rules verbatim; `null` → intent routing with the pending untouched (queries and CRUD execute; `register_expense` abandons the dialog and registers the new message). Commands MUST still be handled before any state logic, in every state. Queries and CRUD intents during dialogs MUST NOT consume the pending. Phantom guard: a `resolve` answer MUST act ONLY on the persisted payload — no valid payload → abandon with a clear reply, nothing registers, and no amount is ever fabricated.

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

### Requirement: Mixed-Intent Create + Reassign (then_reassign)

When a `create_category` envelope carries `then_reassign: true`, the system MUST create the category and THEN reassign the pending correction movement (when one exists) to the created category in the same processing cycle, replying once. When no pending movement exists, `then_reassign` MUST be ignored — no matcher invocation, no error.

#### Scenario: Create and reassign in one reply

- GIVEN an owner in `awaiting_category` with a pending movement sends "creá gastos hormiga y guardalo ahí"
- WHEN the brain returns `create_category` with `then_reassign: true`
- THEN the category is created, the pending movement is reassigned to it, and exactly one confirmation reply is sent

#### Scenario: No pending ignores the reassign flag

- GIVEN an owner in `idle` with no pending movement sends "creá gastos hormiga y guardalo ahí"
- WHEN the brain returns `create_category` with `then_reassign: true`
- THEN only the category is created and no reassignment attempt occurs

## MODIFIED Requirements

### Requirement: Intent-First Message Handling

For every non-command owner message in `idle`, the system MUST invoke the bot brain's `interpret` before deterministic execution and MUST route on the returned intent: `register_expense` runs the existing registration flow (with the brain's amount/category/note); `query`/`query_recent`/`query_balance`/`query_month` execute the deterministic query executor and answer from real data (an honest redirect replies only when the query fails or the type is unresolvable); `associate_keyword` redirects to the `asociar palabra` command; `help` replies with help; `off_topic` replies with an expense-scoped redirect and MUST NOT be answered as general chat; `correct_amount` is reserved and replies with deterministic help in `idle`; `correct_category` runs the movement-correction flow (see movement-correction). The setup gate (owner with no categories) MUST take precedence over `interpret`: such messages go straight to `awaiting_setup` with no brain call. The state machine MUST remain authoritative — the LLM MUST never decide state transitions. `interpret` MUST NOT be invoked for commands or the setup flow; for dialog-state messages (`awaiting_category`, `awaiting_amount_confirmation`) it MUST be invoked with dialog context and the envelope's `dialog_action` routes the message (see Dialog Controller), with today's deterministic rules as the fallback when the brain is null/absent. When `interpret` returns `null` in `idle`, the system MUST behave exactly as today.
(Previously: queries were answered with an honest not-supported redirect; `correct_amount` and `correct_category` were both reserved with deterministic help; `interpret` was never invoked in dialog states.)

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

#### Scenario: Setup gate precedes the brain

- GIVEN an owner with no categories sends "$2500 cafe"
- WHEN the message is processed
- THEN the owner enters `awaiting_setup` and `interpret` is not invoked

#### Scenario: Brain null behaves as today

- GIVEN `GROQ_API_KEY` unset or a brain result of `null`
- WHEN a message is processed in `idle`
- THEN the behavior is identical to today (deterministic parse, otro + correction, or help)

#### Scenario: Dialog answers route through the brain

- GIVEN a message in `awaiting_category` or `awaiting_amount_confirmation`
- WHEN it is processed
- THEN `interpret` is invoked with dialog context and the envelope's `dialog_action` routes the message
- AND the deterministic rules apply only as the fallback (brain null/absent/abandon)

### Requirement: Success and Help Reply Content

The system MUST reply to a successfully registered movement with a confirmation that includes the amount, the note, and the assigned category; the confirmation MUST be the brain's `reply` text when the brain is available and returns one, and MUST fall back to the fixed success template carrying the same facts. The system MUST reply to an unparseable message with help text (brain-written or fixed). The system MUST reply to off-topic messages with an expense-scoped redirect — never as general chat. Query messages MUST be answered from the EXECUTED query result (brain-written from the executed query or the fixed query template); an honest redirect is used only when query execution fails or the type is unresolvable. A reply MUST NOT be sent for non-owner, edited, empty, or deduplicated messages.
(Previously: off-topic and query messages both received expense-scoped redirects, and queries were never executed.)

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

### Requirement: Correction Loop (awaiting_category) and Learning

Dialog messages in `awaiting_category` MUST first route through the brain (see Dialog Controller): a `resolve` answer reassigns the pending movement; `null` intents (queries, CRUD) execute without consuming the pending; `register_expense` abandons the pending. When the brain is absent, returns `null`, or the envelope says `abandon`, the deterministic rules below apply verbatim: a reply whose normalized text exactly matches an existing category name is the ANSWER; a reply that parses as an amount is a NEW registration that abandons the pending correction; a single-token reply that is not an existing category MUST auto-create that category and apply it; any other multi-word reply MUST list the existing categories without closing the state. A valid answer MUST reassign the pending movement to that category and confirm. Correction answers MUST NOT learn keyword rules — keyword rules are created only through the explicit `asociar palabra` command.
(Previously: every `awaiting_category` message was classified by the deterministic rules alone; the brain was never involved.)
(Previously: corrections learned a keyword rule mapping the original note's first significant word to the answered category, and every non-answer text was treated as a new registration.)

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

The system MUST persist, per owner, a state machine with values `idle`, `awaiting_setup`, and `awaiting_category`, plus a pending amount-conflict question (exact state value is a design decision). Transitions MUST be explicit and testable: registration when owner has no categories → `awaiting_setup`; assignment to "otro" → `awaiting_category`; resolved answer or completed setup → `idle`; an answer that is a new registration during `awaiting_category` MUST remain in the registration path without corrupting the pending correction. The pending movement for a correction MUST be persisted so it survives a restart. The pending amount-conflict question MUST be persisted with the same abandonment and restart semantics as `awaiting_category`. With the brain active, a `resolve` answer MUST act ONLY on the persisted payload — a bare affirmation or a resolve with no matching payload value abandons the question with a clear reply and is NOT reprocessed as a registration (phantom guard); the deterministic fallback (brain null/absent) keeps today's behavior: a reply matching a presented amount resolves it, and any other text abandons it (nothing registers from the conflicting message) and is processed as a new registration.
(Previously: a conflicting-message answer always abandoned and reprocessed the text as a new registration; no payload-only resolve existed.)

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

## Pre-Existing Drift (informational)

- Canonical `telegram-bot` "Intent-First Message Handling" and "Success and Help Reply Content" pinned honest query redirects ("not supported yet", "never as executed queries"); live `telegram.service.ts` executes queries via `QueryExecutor` and answers real data. Reconciled above.
- Canonical `bot-brain` "Intent Taxonomy" pinned the same honest query redirect and a narrower intent set; live `bot-brain.ts` already ships `query`, `query_type`, `new_name`, `create_category`, `delete_category`, `rename_category`, `capabilities`. Reconciled in the bot-brain delta.