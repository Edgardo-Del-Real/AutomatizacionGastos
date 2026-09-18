# Telegram Bot Specification

## Purpose

Sole inbound surface for movement ingestion, via Telegram Bot API long polling (`getUpdates`). Only the owner's text messages are parsed, classified, and persisted as movements; successful registrations, setup, and correction flows reply back to the owner. Only `message` updates are processed; all logic is drivable offline through `bot.handleUpdate()`.

## Requirements

### Requirement: Long-Polling Lifecycle

The system MUST start the Telegram long-polling loop when the API process starts and MUST stop it gracefully on SIGINT/SIGTERM. The loop MUST NOT require any inbound HTTP surface. The processing pipeline MUST be fully drivable via `bot.handleUpdate(update)` with no polling loop and no network calls.

#### Scenario: Graceful stop on shutdown

- GIVEN the API process is polling
- WHEN SIGINT or SIGTERM is received
- THEN the polling loop stops cleanly without errors

#### Scenario: Offline pipeline drive

- GIVEN a fixture `Update` object
- WHEN `bot.handleUpdate(update)` is invoked in tests
- THEN the update is processed with zero network calls

### Requirement: Update Filtering

The system MUST process only `message` updates. `edited_message`, channel posts, service/status updates, and group-chat messages MUST be ignored entirely — never recorded, never creating movements, never triggering a reply. A `message` without text MUST NOT create a movement or reply.
(Previously: filtering was inbound-only with no reply consideration.)

#### Scenario: Edited message ignored

- GIVEN an `edited_message` update
- WHEN it is processed
- THEN no movement is created and nothing is recorded
- AND no reply is sent

#### Scenario: Non-text message

- GIVEN a `message` update with a photo and no text
- WHEN it is processed
- THEN no movement is created
- AND no reply is sent

#### Scenario: Group chat ignored

- GIVEN a `message` update in a group chat
- WHEN it is processed
- THEN no movement is created
- AND no reply is sent

### Requirement: Owner Filtering

The system MUST identify the sender by `message.from.id` and MUST process only when it equals `TELEGRAM_OWNER_CHAT_ID`. Any other sender MUST NOT produce a movement and MUST NOT receive a reply.
(Previously: non-owner senders were skipped silently; replies did not exist.)

#### Scenario: Owner message proceeds

- GIVEN a `message` whose `from.id` equals `TELEGRAM_OWNER_CHAT_ID`
- WHEN it is processed
- THEN the message proceeds to parsing

#### Scenario: Non-owner message skipped silently

- GIVEN a `message` whose `from.id` differs from `TELEGRAM_OWNER_CHAT_ID`
- WHEN it is processed
- THEN no movement is created
- AND no reply is sent

### Requirement: Message Deduplication

The system MUST record every processed `message` in `ProcessedMessage` under `(chatId, messageId)` and MUST skip, without error or reply, any message whose key already exists.
(Previously: duplicates were skipped silently; no reply existed.)

#### Scenario: Duplicate update skipped

- GIVEN a message already recorded with the same `(chatId, messageId)`
- WHEN the same message arrives again
- THEN it is skipped, no movement is created, and no reply is sent

#### Scenario: Same id in different chats

- GIVEN two messages with the same `messageId` from different chats
- WHEN both are processed
- THEN both are recorded and processed

### Requirement: Movement Parsing, Classification and Categorization

The system MUST reuse the shared parser for amount/note extraction and MUST classify `INCOME`/`EXPENSE` per the existing deterministic rules. Categorization MUST be deterministic-first: the shared category matcher runs before the bot brain, and user-authored keyword rules MUST beat brain suggestions. The bot brain MUST be invoked for every non-command `idle` message (see Intent-First Message Handling); on a keyword miss it supplies the category suggestion and participates in the amount rules below. A brain-suggested category MUST be used only when it exactly matches an owner category via `normalizeForMatch`; otherwise the movement MUST be created in "otro" and the existing `awaiting_category` correction MUST follow — the brain MUST NEVER auto-create categories. The deterministic amount MUST be authoritative: when the deterministic amount is absent but the brain returns a valid amount, the system MUST register the movement directly with the brain amount. When both amounts exist and differ, the system MUST NOT register anything silently and MUST ask the owner which amount is correct (see Amount-Conflict Question) — EXCEPT the "mil" stance: when the deterministic amount is a bare integer token and the message contains a prose-number word ("mil", "k", or a Spanish number word such as "quinientos", "doscientos", "cien"), the brain amount MUST win directly with NO conflict question. Note precedence: the deterministic note MUST win; the brain note MUST be used only when the deterministic note is absent (gap rescue); the system MUST NOT conflict-ask about notes. When the brain is unavailable or returns `null`, the system MUST behave exactly as today: a keyword miss falls to "otro" + correction, and a message with no parseable amount is replied to with help text.
(Previously: the note interpreter was invoked only on a keyword miss or amount-parse failure and never on a keyword match; both amounts differing always asked the owner; no note precedence rule existed.)

#### Scenario: Keyword classification

- GIVEN owner text "Recibí $50000 de sueldo"
- WHEN the message is processed
- THEN an `INCOME` movement is created
- AND it is assigned a matched category when one applies, else "otro"

#### Scenario: Matched keyword rule wins over the brain suggestion

- GIVEN owner text matching a user-authored keyword rule
- WHEN the message is processed
- THEN the movement registers with the matched category
- AND the brain category suggestion is ignored

#### Scenario: Keyword miss with resolvable brain category

- GIVEN owner text matching no keyword rule and a brain suggestion that exactly matches an owner category
- WHEN the message is processed
- THEN a movement registers with the brain category and a success reply is sent
- AND no correction round-trip occurs

#### Scenario: Keyword miss with unknown brain category

- GIVEN owner text matching no keyword rule and a brain suggestion not in the owner's category list
- WHEN the message is processed
- THEN the movement registers in "otro"
- AND the `awaiting_category` correction is offered
- AND no category is auto-created

#### Scenario: Amount rescued by the brain

- GIVEN owner text "compre mercaderia" with no deterministic amount and a brain amount of 5000
- WHEN the message is processed
- THEN a movement registers directly with amount 5000 and a success reply is sent

#### Scenario: No amount and brain null

- GIVEN owner text with no deterministic amount and a brain result of `null`
- WHEN the message is processed
- THEN no movement is created
- AND a help reply is sent

#### Scenario: Conflicting amounts ask the owner

- GIVEN a deterministic amount of 5000 and a brain amount of 4800 on a keyword miss with no prose-number word
- WHEN the message is processed
- THEN no movement is registered
- AND the bot asks which amount is correct

#### Scenario: "5 mil" stance registers the brain amount

- GIVEN owner text "gaste 5 mil en el super" (bare digit 5, prose "mil") and a brain amount of 5000
- WHEN the message is processed
- THEN a movement registers directly with 5000
- AND no conflict question is asked and no `awaiting_amount_confirmation` state is entered

#### Scenario: Deterministic note wins over the brain note

- GIVEN a deterministic note "cafe" and a brain note "cafe con leche"
- WHEN the message is processed
- THEN the movement registers with the deterministic note "cafe"

#### Scenario: Brain note fills the gap

- GIVEN no deterministic note and a brain note "mercaderia"
- WHEN the message is processed
- THEN the movement registers with the brain note "mercaderia"

#### Scenario: No brain configured degrades to today

- GIVEN `GROQ_API_KEY` is unset
- WHEN a keyword-miss or amountless message is processed
- THEN the behavior is identical to today (otro + correction, or help reply)

### Requirement: Movement Persistence and Error Tolerance

The system MUST persist each valid message as a movement (currency `ARS`, classified type, extracted note, timestamp, owner, assigned category) through the movement service. A movement-creation failure MUST be logged and MUST NOT stop subsequent messages or crash the polling loop.
(Previously: category was never set and replies did not exist.)

#### Scenario: Categorized movement persisted

- GIVEN owner text matching an owner category
- WHEN the message is processed
- THEN a movement with that category is created for the owner

#### Scenario: Persistence failure tolerated

- GIVEN a valid message whose movement creation fails
- WHEN the message is processed
- THEN the failure is logged and remaining messages still process

### Requirement: Configuration and Token Secrecy

The system MUST require `TELEGRAM_BOT_TOKEN` with no default and `TELEGRAM_OWNER_CHAT_ID` as a positive integer; WhatsApp env vars MUST NOT exist. The token MUST never be logged, including any `api.telegram.org` URL containing it.

#### Scenario: Missing token fails fast

- GIVEN `TELEGRAM_BOT_TOKEN` is unset
- WHEN the API starts
- THEN startup fails with a clear configuration error

#### Scenario: Token never logged

- GIVEN an error involving the Telegram API
- WHEN it is logged
- THEN the log contains no token and no `bot<token>` URL

### Requirement: Reply Channel (Bidirectional)

The system MUST expose an injectable reply port that sends a text message back to the sender chat. The reply port MUST be wired to the Telegram bot's reply mechanism in production and to a recording stub in offline tests. A reply failure MUST be logged and MUST NOT stop the polling loop or crash processing.

#### Scenario: Successful reply wired

- GIVEN a processed owner message that requires a reply
- WHEN the pipeline emits a reply
- THEN the reply text is sent to the owner chat

#### Scenario: Reply failure tolerated

- GIVEN the Telegram API fails to send a reply
- WHEN the pipeline attempts the reply
- THEN the failure is logged and processing continues

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

### Requirement: Setup Flow (awaiting_setup)

When an owner with no categories sends a valid registration, the system MUST reply asking for their categories, enter the owner's `awaiting_setup` state, and treat the next non-empty text reply as the category list (newline- or comma-separated). Creating the listed categories MUST also create the "otro" fallback and MUST reply with a confirmation. A later re-run of `configurar categorias` MUST append new categories rather than overwrite.

#### Scenario: First registration triggers setup

- GIVEN an owner with no categories sends "$2500 cafe"
- WHEN it is processed
- THEN the owner enters `awaiting_setup`
- AND a message asking for categories is sent
- AND the registration is not persisted yet

#### Scenario: Reply creates categories

- GIVEN the owner is in `awaiting_setup`
- WHEN they reply "Cafe\nTransporte"
- THEN categories "Cafe" and "Transporte" and "otro" are created
- AND a confirmation is sent
- AND the owner returns to `idle`

#### Scenario: Re-run appends

- GIVEN an owner with categories in `idle`
- WHEN they run `configurar categorias`
- THEN the bot asks again, and a reply of "Salud" appends "Salud" without removing existing categories

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

### Requirement: Bot Commands

The system MUST recognize and handle these owner commands: `registrar categoria: X`, `renombrar categoria: X a: Y`, `asociar palabra: P a categoria: X`, `listar categorias`, and `configurar categorias`. A rename MUST cascade to existing movements (see movement-categories). Unrecognized commands MUST fall through to normal registration parsing.

#### Scenario: Create category

- GIVEN owner sends "registrar categoria: Salud"
- WHEN it is processed
- THEN category "Salud" is created (unless it exists) and a confirmation is sent

#### Scenario: Rename category

- GIVEN owner sends "renombrar categoria: Cafe a: Cafeteria"
- WHEN it is processed
- THEN the category and its referenced movements are renamed and a confirmation is sent

#### Scenario: Associate keyword

- GIVEN owner sends "asociar palabra: uber a categoria: Transporte"
- WHEN it is processed
- THEN the keyword rule is attached and a confirmation is sent

#### Scenario: List categories

- GIVEN owner sends "listar categorias"
- WHEN it is processed
- THEN a reply lists all owner categories

#### Scenario: Unrecognized command falls through

- GIVEN owner text that is not a command
- WHEN it is processed
- THEN it is treated as a normal registration

### Requirement: Offline Testability (Reply + Middleware)

The system MUST be drivable offline for reply logic. The offline test harness MUST record outbound reply payloads instead of throwing on network calls, so that reply behavior is asserted without touching the Telegram network. The reply feature and this middleware change MUST be implemented together in the same test-driven cycle.

#### Scenario: Offline reply is recorded

- GIVEN the offline bot harness with a recording middleware
- WHEN `bot.handleUpdate` processes an update that triggers a reply
- THEN the reply payload is captured and asserted with no network call

#### Scenario: Both land together

- GIVEN the reply feature is added
- WHEN tests run
- THEN the recording middleware exists in the same change, so reply tests pass offline

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

### Requirement: LLM Branch Replies with Fixed Fallback

For conversational outcomes — registration success, correction offer/done, otro kept, category not found, amount conflict, amount-confirmation abandonment, help, and redirects — the system MUST invoke the brain's `reply` with the executed result ONLY and MUST send the returned text verbatim. The `reply` call MUST be skipped for commands and the setup flow. When the brain is absent, `reply` returns `null`, or the reply fails, the system MUST send the fixed `reply-text.ts` template carrying the same executed facts.

#### Scenario: Reply sent verbatim

- GIVEN a registered movement with executed facts and a brain reply string
- WHEN the outcome is a registration success
- THEN the brain reply string is sent verbatim to the owner

#### Scenario: Reply failure falls back fixed

- GIVEN the brain returns `null` for `reply`
- WHEN the outcome is a registration success
- THEN the fixed success template with the same amount, note, and category is sent

#### Scenario: Commands and setup skip the reply call

- GIVEN a command or a setup-flow message
- WHEN it is processed
- THEN the brain's `reply` is not invoked

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