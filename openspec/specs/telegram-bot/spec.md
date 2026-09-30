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

The system MUST reuse the shared parser for amount/note extraction and MUST classify `INCOME`/`EXPENSE` per the existing deterministic rules. Categorization MUST be deterministic-first: the shared category matcher runs before the bot brain, and user-authored keyword rules MUST beat brain suggestions. The bot brain MUST be invoked for every non-command `idle` message (see Intent-First Message Handling); on a keyword miss it supplies the category suggestion and participates in the amount rules below. A brain-suggested category MUST be used only when it resolves against an owner category — exact match via `normalizeForMatch` first, then the tolerant plural fold via `normalizeForMatchTolerant` (so "Otros"→"otro" and "cafes"→"Cafe" resolve). When the brain signals a category that does NOT resolve, the system MUST enter the registration-collection dialog (`awaiting_registration`) and ask the owner for the category with the amount persisted — the brain MUST NEVER auto-create categories and the movement MUST NOT register in "otro" on a non-resolving signaled category. When the brain signals no category (`null`), the movement falls to "otro" and the existing `awaiting_category` correction follows. The deterministic amount MUST be authoritative: when the deterministic amount is absent but the brain returns a valid amount, the system MUST register the movement directly with the brain amount. When both amounts exist and differ, the system MUST NOT register anything silently and MUST ask the owner which amount is correct (see Amount-Conflict Question) — EXCEPT the "mil" stance: when the deterministic amount is a bare integer token and the message contains a prose-number word ("mil", "k", or a Spanish number word such as "quinientos", "doscientos", "cien"), the brain amount MUST win directly with NO conflict question. Note precedence: the deterministic note MUST win; the brain note MUST be used only when the deterministic note is absent (gap rescue); the system MUST NOT conflict-ask about notes. When the brain is unavailable or returns `null`, the system MUST behave exactly as today: a keyword miss falls to "otro" + correction, and a message with no parseable amount is replied to with help text.
(Previously: the note interpreter was invoked only on a keyword miss or amount-parse failure and never on a keyword match; both amounts differing always asked the owner; no note precedence rule existed; brain-suggested categories matched exact `normalizeForMatch` only.)

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

- GIVEN owner text matching no keyword rule and a brain suggestion that resolves against an owner category
- WHEN the message is processed
- THEN a movement registers with the brain category and a success reply is sent
- AND no correction round-trip occurs

#### Scenario: Folded brain suggestion resolves

- GIVEN owner text "gaste en otros" with a brain suggestion "Otros" and an owner category "otro"
- WHEN the message is processed
- THEN the movement registers in "otro" and no correction round-trip occurs

#### Scenario: Keyword miss with unknown brain category

- GIVEN owner text matching no keyword rule and a brain suggestion not in the owner's category list
- WHEN the message is processed
- THEN the registration-collection dialog opens asking for the category with the amount persisted
- AND no category is auto-created
- AND the movement is NOT registered in "otro" without asking

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

### Requirement: Setup Flow (awaiting_setup)

When an owner with no categories sends a valid registration, the system MUST reply asking for their categories, enter the owner's `awaiting_setup` state, and treat the next non-empty text reply as the category list (newline- or comma-separated). Creating the listed categories MUST also create the "otro" fallback and MUST reply with a confirmation. A later re-run of `configurar categorias` MUST append new categories rather than overwrite. The `configurar categorias` question MUST list the owner's existing categories (dynamic listing, never fixed text). Before the plain category-list split, the setup reply MUST be parsed for batch commands — `borrar categoria: X`, `renombrar categoria: X a: Y`, and `registrar categoria: X` MUST execute through the guarded CategoryService operations and MUST NOT be created as literal categories; only remaining plain tokens become categories.
(Previously: the setup question was fixed text and every comma/newline token was created as a literal category, so batch commands like "borrar categoría: no" became phantom categories.)

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

#### Scenario: Setup question lists existing categories

- GIVEN an owner with categories runs `configurar categorias`
- WHEN the setup question is sent
- THEN it lists the existing category names instead of fixed text

#### Scenario: Batch delete executes, never creates a literal

- GIVEN an owner in `awaiting_setup` replies "borrar categoria: no"
- WHEN it is processed
- THEN the "no" category is deleted through the category service
- AND no literal "borrar categoria: no" category is created

### Requirement: Correction Loop (awaiting_category) and Learning

Dialog messages in `awaiting_category` MUST first route through the brain (see Dialog Controller): a `resolve` answer reassigns the pending movement; `null` intents (queries, CRUD) execute without consuming the pending; `register_expense` abandons the pending. When the brain is absent, returns `null`, or the envelope says `abandon`, the deterministic rules below apply verbatim: a reply whose normalized text exactly matches an existing category name is the ANSWER; a reply that parses as an amount is a NEW registration that abandons the pending correction; a single-token reply that is not an existing category MUST auto-create that category and apply it; any other multi-word reply MUST list the existing categories without closing the state. Before the single-token auto-create, the reply MUST be checked through the punctuation-stripped guard normalization (`normalizeForMatchGuard`): a reply that normalizes to a guard word ("no", "si", with or without punctuation) MUST route to the abandon/affirmation handling and MUST NOT auto-create a category. A valid answer MUST reassign the pending movement to that category and confirm. Correction answers MUST NOT learn keyword rules — keyword rules are created only through the explicit `asociar palabra` command.
(Previously: every `awaiting_category` message was classified by the deterministic rules alone; the brain was never involved.)
(Previously: corrections learned a keyword rule mapping the original note's first significant word to the answered category, and every non-answer text was treated as a new registration.)
(Previously: guard sets matched without punctuation stripping, so "no." fell through to the single-token auto-create and created a phantom category.)

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

#### Scenario: Punctuated guard never auto-creates

- GIVEN the owner is in `awaiting_category`
- WHEN they reply "no."
- THEN no category is created and the reply routes to the abandon handling

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

For every non-command owner message in `idle`, the system MUST invoke the bot brain's `interpret` before deterministic execution and MUST route on the returned intent: `register_expense` runs the existing registration flow (with the brain's amount/category/note; a null amount enters `awaiting_registration` per registration-collection); `query`/`query_recent`/`query_balance`/`query_month` execute the deterministic query executor and answer from real data (an honest redirect replies only when the query fails or the type is unresolvable); `associate_keyword` redirects to the `asociar palabra` command; `help` replies with help; `off_topic` replies with an expense-scoped redirect and MUST NOT be answered as general chat; `greeting` replies with a warm expense-scoped greeting and MUST NOT close any open dialog; `correct_amount` is reserved and replies with deterministic help in `idle`; `correct_category` runs the movement-correction flow (see movement-correction); `mark_paid` runs the movement-lifecycle executor to transition a referenced PENDING EXPENSE to PAID, and `delete_expense` runs it to delete a referenced expense (see bot-expense-lifecycle) — lifecycle intents MUST NOT enter the registration path. The setup gate (owner with no categories) MUST take precedence over `interpret`: such messages go straight to `awaiting_setup` with no brain call. The state machine MUST remain authoritative — the LLM MUST never decide state transitions. `interpret` MUST NOT be invoked for commands or the setup flow; for dialog-state messages (`awaiting_category`, `awaiting_amount_confirmation`, `awaiting_registration`) it MUST be invoked with dialog context and the envelope's `dialog_action` routes the message (see Dialog Controller), with today's deterministic rules as the fallback when the brain is null/absent. When `interpret` returns `null` in `idle`, the system MUST behave exactly as today.
(Previously: queries were answered with an honest not-supported redirect; `correct_amount` and `correct_category` were both reserved with deterministic help; `interpret` was never invoked in dialog states; there was no `greeting` intent, no lifecycle intents, and null-amount registrations dead-ended in a free-text question with no state.)

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

#### Scenario: Lifecycle intent routes to the executor

- GIVEN owner text "ya lo pagué" classified `mark_paid`
- WHEN the message is processed in `idle`
- THEN the movement-lifecycle executor marks the referenced PENDING expense PAID and replies once

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

For every non-command owner message in a dialog state (`awaiting_category`, `awaiting_amount_confirmation`, `awaiting_registration`), the system MUST invoke the bot brain's `interpret(body, { state, pending, openQuestion })` BEFORE the deterministic dialog rules and MUST route on the envelope's `dialog_action`: `resolve` → deterministic resolution from the persisted payload ONLY (reassign the pending movement to the answered category, register the chosen amount, or resolve the collected amount/category per registration-collection); `abandon` or brain null/absent → today's D6 rules verbatim (for `awaiting_registration`: clear the collect payload, reply, nothing registers); `null` → intent routing with the pending untouched (queries and CRUD execute; `register_expense` abandons the dialog and registers the new message, replying exactly once with a single merged message carrying the abandon fact and the registration outcome — never two contradictory replies). Commands MUST still be handled before any state logic, in every state. Queries and CRUD intents during dialogs MUST NOT consume the pending. Phantom guard: a `resolve` answer MUST act ONLY on the persisted payload — no valid payload → abandon with a clear reply, nothing registers, and no amount is ever fabricated.
(Previously: the dialog controller covered only `awaiting_category` and `awaiting_amount_confirmation`; `awaiting_registration` did not exist.)
(Previously: register-during-dialog sent two contradictory replies: an abandon message followed by the registration confirmation.)

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

#### Scenario: New registration during a dialog abandons the pending and replies once

- GIVEN an owner in `awaiting_category` sends "$8000 supermercado"
- WHEN the brain returns `dialog_action: null` with `register_expense`
- THEN the pending correction is abandoned, the new message follows the normal registration path, and exactly one merged reply is sent

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

### Requirement: Savings Rule Command

The system MUST recognize `registrar ahorro: <palabra> al <X>%` as an owner command that creates or upserts the savings rule (semantics per the savings capability) and MUST reply with a confirmation. A malformed percent MUST be rejected with a validation error and MUST NOT store a rule. Unrecognized commands MUST still fall through to normal registration parsing.

#### Scenario: Define a savings rule

- GIVEN owner sends "registrar ahorro: entrenuts al 10%"
- WHEN it is processed
- THEN the rule is created or upserted and a confirmation is sent

#### Scenario: Invalid percent rejected

- GIVEN owner sends "registrar ahorro: entrenuts al 0%"
- WHEN it is processed
- THEN a validation error replies and no rule is stored

#### Scenario: Unrecognized command falls through

- GIVEN owner text that is not a recognized command
- WHEN it is processed
- THEN it is treated as a normal registration

### Requirement: Savings Split on Income Registration

When an INCOME registration's note matches a savings-rule keyword and no override applies, the system MUST register the INCOME with the NET amount and a SAVINGS movement in the "ahorro" category in a single transaction (semantics per the savings capability), and the confirmation reply MUST report the gross, net, and savings amounts. A SHARED income MUST produce a SHARED savings movement. An income matching no rule MUST register whole as today.

#### Scenario: Split applied on registration

- GIVEN rule "entrenuts" at 10% and message "cobro sueldo de entrenuts 1000"
- WHEN the message is processed
- THEN INCOME 900 and SAVINGS 100 in "ahorro" are created in one transaction
- AND the confirmation reports 1000 gross, 900 net, and 100 saved

#### Scenario: Shared income shares the savings

- GIVEN "compartido: cobro sueldo de entrenuts 1000" with a matching rule
- WHEN the message is processed
- THEN both the INCOME and the SAVINGS movement carry SHARED visibility

#### Scenario: No rule registers whole

- GIVEN an income matching no savings rule
- WHEN the message is processed
- THEN a single whole INCOME movement is created and the reply is today's confirmation

### Requirement: Registration Overrides

The system MUST parse the deterministic overrides "sin ahorro" and "con X%" at arrival alongside the `compartido:` prefix, and MUST apply them on the brain-absent path too. "sin ahorro" MUST register the full gross with no SAVINGS movement; "con X%" MUST replace the rule percent for that message only, with X validated as `0 < X <= 100`.

#### Scenario: sin ahorro disables the split

- GIVEN a matching rule and message "sin ahorro cobro sueldo de entrenuts 1000"
- WHEN the message is processed
- THEN INCOME 1000 registers whole and no SAVINGS movement is created

#### Scenario: con X% overrides the rule percent

- GIVEN a rule at 10% and message "con 5% cobro sueldo de entrenuts 1000"
- WHEN the message is processed
- THEN INCOME 950 and SAVINGS 50 are created

#### Scenario: Override works without the brain

- GIVEN `GROQ_API_KEY` unset and a matching rule
- WHEN an income with "sin ahorro" or "con 5%" arrives
- THEN the override applies deterministically with today's flow

#### Scenario: Invalid override percent rejected

- GIVEN a message "con 150% cobro sueldo de entrenuts 1000"
- WHEN the message is processed
- THEN the registration is rejected with a validation error and no movement is created

### Requirement: Savings Query Routing

The system MUST answer "cuánto ahorré este mes" from real data with the sum of SAVINGS movements in the current calendar month (semantics per the savings capability); an honest redirect MUST be used only when query execution fails.

#### Scenario: Savings query answers real data

- GIVEN SAVINGS 100 and 50 this month
- WHEN the owner asks "cuánto ahorré este mes"
- THEN the reply answers 150 from real data

#### Scenario: Savings query failure redirects

- GIVEN a savings query whose execution fails
- WHEN the owner asks "cuánto ahorré este mes"
- THEN an honest redirect replies and no amount is fabricated

### Requirement: Planned Expense Registration (`previsto:` prefix)

The system MUST parse a `previsto:` prefix at arrival, alongside the `compartido:` prefix, and MUST register the movement as a `PENDING` EXPENSE through the existing create path. Planned expenses are INDIVIDUAL by design: `previsto:` MUST NOT compose with `compartido:` — a message combining both prefixes (in either order) MUST be rejected with an educational redirect and MUST NOT create anything, start a dialog, or change the bot state. The prefix MUST work on the brain-absent path. A `previsto:` registration MUST NOT trigger any savings split. The deterministic prefix MUST be authoritative: when both a `previsto:` prefix and a brain `planned` flag are present, the prefix wins; a brain `planned: true` flag without the prefix MAY register a PENDING EXPENSE; on the brain-absent path only the prefix can produce PENDING. A `PENDING` registration MUST always persist as INDIVIDUAL, even when a shared signal leaks in.
(Previously: only the literal `previsto:` prefix could produce PENDING; the brain envelope carried no `planned` field; `previsto:` composed with `compartido:`.)

#### Scenario: previsto registers a planned expense

- GIVEN owner text "previsto: 2500 alquiler"
- WHEN it is processed
- THEN a PENDING EXPENSE of 2500 is created and a confirmation replies

#### Scenario: previsto combined with compartido rejected

- GIVEN owner text "compartido: previsto: 2500 alquiler" (or "previsto: compartido: 2500 alquiler")
- WHEN it is processed
- THEN the educational redirect replies ("los gastos previstos son individuales") and no movement is created, no dialog starts, and the state stays untouched

#### Scenario: brain-absent path

- GIVEN `GROQ_API_KEY` unset
- WHEN "previsto: 2500 alquiler" is processed
- THEN the PENDING EXPENSE still registers deterministically

#### Scenario: Prefix wins over the flag

- GIVEN the brain returns `planned: false` and the text carries "previsto: 2500 alquiler"
- WHEN it is processed
- THEN the PENDING EXPENSE registers anyway (deterministic prefix authoritative)

#### Scenario: Flag alone registers PENDING with the brain

- GIVEN the brain returns `planned: true` for "dejalo para el mes que viene: 2500 alquiler" with no prefix
- WHEN it is processed
- THEN a PENDING EXPENSE registers

### Requirement: Recent Movements Exclude Planned

The bot's `recent` query MUST exclude PENDING movements; PENDING rows MUST be visible only through the `planned` query.

#### Scenario: recent omits pending

- GIVEN a PENDING EXPENSE and recent PAID movements
- WHEN the owner asks for recent movements
- THEN the reply lists only the PAID movements

#### Scenario: planned still answers

- GIVEN the same PENDING EXPENSE
- WHEN the owner asks "¿cuánto tengo previsto?"
- THEN the reply reports the planned total from real data

### Requirement: Planned Query Routing

The system MUST answer "¿cuánto tengo previsto?" and equivalent phrasings ("gastos fijos previstos", "cuánto voy a gastar el mes que viene") from real data: the sum of PENDING EXPENSE movements targeted at next month (`summary.planned`). An honest redirect MUST be used only when query execution fails.

#### Scenario: planned query answers real data

- GIVEN PENDING EXPENSE 2500 and 1500 targeted next month
- WHEN the owner asks "¿cuánto tengo previsto?"
- THEN the reply answers 4000 for next month from real data

#### Scenario: no pending answers zero

- GIVEN no PENDING EXPENSE
- WHEN the owner asks "¿cuánto tengo previsto?"
- THEN the reply answers 0 for next month

#### Scenario: planned query failure redirects

- GIVEN a planned query whose execution fails
- WHEN the owner asks "¿cuánto tengo previsto?"
- THEN an honest redirect replies and no amount is fabricated

### Requirement: Guarded Category Creation Funnel

Every bot-side category creation path — dialog single-token auto-create, `correct_category` target auto-create, `create_category` intent (including `then_reassign`), setup-list entries, and the `registrar categoria:` command — MUST funnel through the guarded `CategoryService.createCategory`. A name rejected by the reserved or duplicate-variant guards MUST produce a redirect reply, MUST NOT create any category, and MUST leave the pending correction (when one exists) open with the movement in "otro".

#### Scenario: registrar command redirected

- GIVEN owner sends "registrar categoria: previsto"
- WHEN it is processed
- THEN no category is created and a redirect reply teaches "previsto: monto nota"

#### Scenario: Dialog auto-create gated

- GIVEN an owner in `awaiting_category` replies "previsto"
- WHEN it is processed
- THEN no category is created, a redirect replies, and the pending correction stays open

#### Scenario: then_reassign gated

- GIVEN an owner in `awaiting_category` sends "creá gastos fijos y guardalo ahí"
- WHEN the brain returns `create_category` with `then_reassign: true`
- THEN no category is created and no reassignment occurs (a redirect replies instead)

#### Scenario: Setup entry gated

- GIVEN an owner in `awaiting_setup` replies "Cafe, gastos fijos"
- WHEN it is processed
- THEN "Cafe" is created and "gastos fijos" is rejected with a redirect (no category for it)