# Delta for Telegram Bot

## MODIFIED Requirements

### Requirement: Update Filtering

The system MUST process `message` and `callback_query` updates (callback routing per bot-inline-interactions). `edited_message`, channel posts, service/status updates, and group-chat messages MUST be ignored entirely — never recorded, never creating movements, never triggering a reply. A `message` without text MUST NOT create a movement or reply. A `callback_query` MUST be processed only when its action is known and its sender resolves to a household member.
(Previously: only `message` updates were processed; `callback_query` updates were rejected by the normalizer.)

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

#### Scenario: Callback query processed

- GIVEN a `callback_query` with a known action from a known owner chat
- WHEN it is processed
- THEN the callback action executes
- AND no text movement is created

### Requirement: Message Deduplication

The system MUST record every processed `message` in `ProcessedMessage` under `(chatId, messageId)` and MUST skip, without error or reply, any message whose key already exists. Recording MUST happen AFTER the chat gate: unknown chats MUST NOT be recorded. Deduplication MUST be per `(chatId, messageId)` after the sender's owner has been resolved. Callback retries MUST be idempotent: every registering or destructive callback MUST carry a persisted token (save-token, target id) so a repeated callback MUST NOT double-execute and MUST reply "ya procesado" (per bot-inline-interactions).
(Previously: dedup covered only text `message` updates via `ProcessedMessage`; callback retries had no protection.)

#### Scenario: Duplicate update skipped

- GIVEN a message already recorded with the same `(chatId, messageId)`
- WHEN the same message arrives again
- THEN it is skipped, no movement is created, and no reply is sent

#### Scenario: Same id in different chats

- GIVEN two messages with the same `messageId` from different chats
- WHEN both are processed
- THEN both are recorded and processed

#### Scenario: Unknown chat is not recorded

- GIVEN a `message` from a chatId matching no household member
- WHEN it is processed
- THEN nothing is recorded in `ProcessedMessage`

#### Scenario: Retried callback does not double-execute

- GIVEN a callback whose action token was already consumed
- WHEN the same callback arrives again
- THEN a "ya procesado" reply is sent
- AND nothing executes

### Requirement: Reply Channel (Bidirectional)

The system MUST expose an injectable reply port `(text: string, keyboard?: InlineKeyboard, editMessageId?: number) => Promise<void>` that sends a text message back to the sender chat, optionally with an inline keyboard, and edits an existing message when `editMessageId` is present. The reply port MUST be wired to the Telegram bot's reply/edit mechanism in production and to a recording stub in offline tests; the stub MUST record text, keyboard rows, and edit target through `recordApiCalls` with zero network calls. A reply failure MUST be logged and MUST NOT stop the polling loop or crash processing.
(Previously: the reply port accepted a plain text string only, and the offline harness recorded text replies.)

#### Scenario: Successful reply wired

- GIVEN a processed owner message that requires a reply
- WHEN the pipeline emits a reply
- THEN the reply text is sent to the owner chat

#### Scenario: Reply failure tolerated

- GIVEN the Telegram API fails to send a reply
- WHEN the pipeline attempts the reply
- THEN the failure is logged and processing continues

#### Scenario: Keyboard reply recorded offline

- GIVEN a processed update that emits a reply with an inline keyboard
- WHEN the pipeline emits the reply
- THEN the stub records the text and the keyboard rows with no network call

#### Scenario: Edit reply updates the message

- GIVEN a reply emitted with `editMessageId` set
- WHEN the pipeline emits it
- THEN the port edits the existing message instead of sending a new one

### Requirement: Per-Owner State Machine

The system MUST persist, per owner, a state machine with values `idle`, `awaiting_setup`, `awaiting_category`, `awaiting_registration`, `awaiting_movement_selection`, the pending amount-conflict question (exact state value is a design decision), `awaiting_preview` (quick-capture preview), and `awaiting_delete_confirmation` (delete gate). `awaiting_registration` stays distinct from `awaiting_category` (correction of an already-registered movement) — the two MUST NOT be conflated. Transitions MUST be explicit and testable: registration when owner has no categories → `awaiting_setup`; assignment to "otro" → `awaiting_category`; resolved answer or completed setup → `idle`; an answer that is a new registration during `awaiting_category` MUST remain in the registration path without corrupting the pending correction; a registration with a null amount or an unresolvable category intent → `awaiting_registration` (see registration-collection); a completed or abandoned collection → `idle`; a quick-capture parse match in `idle` → `awaiting_preview` (payload `{amount, note, category, type, saveToken}`); preview `✅ Guardar` → registers and `idle`, `✏️ Corregir` → `idle` with a capture prompt; a delete request in `idle` → `awaiting_delete_confirmation` with the resolved target id persisted; `🗑 Borrar` → deletes and `idle`, `❌ Cancelar` or any new message → `idle` with nothing deleted. The pending movement for a correction MUST be persisted so it survives a restart. The pending amount-conflict question MUST be persisted with the same abandonment and restart semantics as `awaiting_category`. The `awaiting_registration` collect payload, the `awaiting_preview` payload, and the `awaiting_delete_confirmation` target MUST be persisted with the same restart semantics, and a corrupt payload MUST recover without registering or deleting anything. With the brain active, a `resolve` answer MUST act ONLY on the persisted payload — a bare affirmation or a resolve with no matching payload value abandons the question with a clear reply and is NOT reprocessed as a registration (phantom guard); the deterministic fallback (brain null/absent) keeps today's behavior: a reply matching a presented amount resolves it, and any other text abandons it (nothing registers from the conflicting message) and is processed as a new registration.
(Previously: the state machine had `idle`, `awaiting_setup`, `awaiting_category`, `awaiting_registration`, the amount-conflict question, and `awaiting_movement_selection`; there were no `awaiting_preview` or `awaiting_delete_confirmation` states.)

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

#### Scenario: Capture enters preview

- GIVEN a quick-capture parse match in `idle`
- WHEN the message is processed
- THEN the owner transitions to `awaiting_preview` and the parsed payload is persisted

#### Scenario: Guardar registers and returns to idle

- GIVEN an owner in `awaiting_preview`
- WHEN they tap `✅ Guardar`
- THEN the movement registers with the previewed facts and the owner returns to `idle`

#### Scenario: Delete request enters confirmation

- GIVEN an owner in `idle` requests a delete
- WHEN the target resolves
- THEN the owner enters `awaiting_delete_confirmation` with the target id persisted
- AND nothing is deleted yet

#### Scenario: Cancelar abandons without deleting

- GIVEN an owner in `awaiting_delete_confirmation`
- WHEN they tap `❌ Cancelar`
- THEN the owner returns to `idle` and the target movement is untouched

#### Scenario: Delete target survives restart

- GIVEN an owner in `awaiting_delete_confirmation`
- WHEN the process restarts
- THEN the target id and the state are still present

### Requirement: Bot Commands

The system MUST recognize and handle these owner commands: `registrar categoria: X`, `renombrar categoria: X a: Y`, `asociar palabra: P a categoria: X`, `listar categorias`, `configurar categorias`, `menu`, and `ayuda`. A rename MUST cascade to existing movements (see movement-categories). The `menu` command MUST render the five-button main menu and `ayuda` MUST render the static help (see bot-main-menu). The system MUST register the owner-visible command list via `setMyCommands` at startup. Unrecognized commands MUST fall through to normal registration parsing.
(Previously: there was no `menu`/`ayuda` command and no `setMyCommands` registration.)

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

#### Scenario: Menu command shows actions

- GIVEN owner sends `menu`
- WHEN it is processed
- THEN the five-button main menu replies

#### Scenario: Commands registered on start

- GIVEN the API process starts with a valid bot token
- WHEN the bot boots
- THEN `setMyCommands` is called with the command list

### Requirement: Correction Loop (awaiting_category) and Learning

Dialog messages in `awaiting_category` MUST first route through the brain (see Dialog Controller): a `resolve` answer reassigns the pending movement; `null` intents (queries, CRUD) execute without consuming the pending; `register_expense` abandons the pending. When the brain is absent, returns `null`, or the envelope says `abandon`, the deterministic rules below apply verbatim: a reply whose normalized text exactly matches an existing category name is the ANSWER; a reply that parses as an amount is a NEW registration that abandons the pending correction; any other reply MUST present the existing categories as inline buttons (closed set) without closing the state. The single-token free-text auto-create is REMOVED: no reply in `awaiting_category` MUST create a category. Before the answer/button handling, the reply MUST be checked through the punctuation-stripped guard normalization (`normalizeForMatchGuard`): a reply that normalizes to a guard word ("no", "si", with or without punctuation) MUST route to the abandon/affirmation handling and MUST NOT create a category. A valid answer (exact text or category button) MUST reassign the pending movement to that category and confirm. Correction answers MUST NOT learn keyword rules — keyword rules are created only through the explicit `asociar palabra` command.
(Previously: every `awaiting_category` message was classified by the deterministic rules alone; the brain was never involved.)
(Previously: corrections learned a keyword rule mapping the original note's first significant word to the answered category, and every non-answer text was treated as a new registration.)
(Previously: guard sets matched without punctuation stripping, so "no." fell through to the single-token auto-create and created a phantom category.)
(Previously: a single-token non-category reply auto-created the category through the guarded path.)

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

#### Scenario: Unknown single-token answer shows buttons and never auto-creates

- GIVEN the owner is in `awaiting_category`
- WHEN they reply "Mascotas" which is not an existing category
- THEN no category is created and the existing categories render as buttons
- AND the state stays open

#### Scenario: Punctuated guard never auto-creates

- GIVEN the owner is in `awaiting_category`
- WHEN they reply "no."
- THEN no category is created and the reply routes to the abandon handling

#### Scenario: Amount during awaiting_category is a new registration

- GIVEN the owner is in `awaiting_category`
- WHEN they send "$8000 supermercado"
- THEN it is treated as a new registration, not an answer, and the pending correction is abandoned
- AND processing follows the normal registration path

#### Scenario: Multi-word non-category answer lists categories as buttons

- GIVEN the owner is in `awaiting_category`
- WHEN they reply with a multi-word text that matches no category
- THEN the bot presents the category buttons and the state stays open
- AND the movement remains safely in "otro"

### Requirement: Intent-First Message Handling

For every non-command owner message in `idle`, the system MUST run the deterministic `QuickCaptureParser` FIRST: on a parse match (amount + category resolved against the closed set) the capture preview flow runs and `interpret` MUST NOT be invoked for that message; on a miss, the system MUST invoke the bot brain's `interpret` as the FALLBACK for uncaptured intents and MUST route on the returned intent: `register_expense` runs the existing registration flow (with the brain's amount/category/note; a null amount enters `awaiting_registration` per registration-collection); `query`/`query_recent`/`query_balance`/`query_month` execute the deterministic query executor and answer from real data (an honest redirect replies only when the query fails or the type is unresolvable); `associate_keyword` redirects to the `asociar palabra` command; `help` replies with help; `off_topic` replies with an expense-scoped redirect and MUST NOT be answered as general chat; `greeting` replies with a warm expense-scoped greeting and MUST NOT close any open dialog; `correct_amount` is reserved and replies with deterministic help in `idle`; `correct_category` runs the movement-correction flow (see movement-correction); `mark_paid` runs the movement-lifecycle executor to transition a referenced PENDING EXPENSE to PAID, and `delete_expense` runs it to resolve a referenced expense and OPEN the confirmation gate (see bot-expense-lifecycle) — lifecycle intents MUST NOT enter the registration path and delete MUST NOT execute without confirmation. The setup gate (owner with no categories) MUST take precedence over the parser and `interpret`: such messages go straight to `awaiting_setup` with no parser and no brain call. The state machine MUST remain authoritative — the LLM MUST never decide state transitions, MUST never pick a delete target silently, and MUST never infer the planned type. `interpret` MUST NOT be invoked for commands or the setup flow; for dialog-state messages (`awaiting_category`, `awaiting_amount_confirmation`, `awaiting_registration`) it MUST be invoked with dialog context and the envelope's `dialog_action` routes the message (see Dialog Controller), with today's deterministic rules as the fallback when the brain is null/absent. When `interpret` returns `null` in `idle`, the system MUST behave exactly as today.
(Previously: every non-command `idle` message invoked `interpret` first; there was no deterministic capture fast path, and `delete_expense` executed immediately on the resolved target.)

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

#### Scenario: Setup gate precedes the parser and the brain

- GIVEN an owner with no categories sends "$2500 cafe"
- WHEN the message is processed
- THEN the owner enters `awaiting_setup` and neither the parser nor `interpret` is invoked

#### Scenario: Brain null behaves as today

- GIVEN `GROQ_API_KEY` unset or a brain result of `null`
- WHEN a message is processed in `idle`
- THEN the behavior is identical to today (deterministic parse, otro + correction, or help)

#### Scenario: Dialog answers route through the brain

- GIVEN a message in `awaiting_category`, `awaiting_amount_confirmation`, or `awaiting_registration`
- WHEN it is processed
- THEN `interpret` is invoked with dialog context and the envelope's `dialog_action` routes the message
- AND the deterministic rules apply only as the fallback (brain null/absent/abandon)

#### Scenario: Capture fast path skips the brain

- GIVEN owner text "30000 gym" that parses against the closed set
- WHEN it is processed in `idle`
- THEN the preview flow runs and `interpret` is not invoked

#### Scenario: Parser miss falls back to the brain

- GIVEN owner text that does not parse
- WHEN it is processed in `idle`
- THEN `interpret` is invoked for the uncaptured intent

#### Scenario: Delete intent opens the confirmation gate

- GIVEN owner text classified `delete_expense`
- WHEN it is processed in `idle`
- THEN the delete target resolves, the confirmation gate opens, and nothing is deleted yet

### Requirement: Guarded Category Creation Funnel

Every bot-side category creation path — `correct_category` target auto-create, `create_category` intent (including `then_reassign`), setup-list entries, and the `registrar categoria:` command — MUST funnel through the guarded `CategoryService.createCategory`. The dialog single-token auto-create MUST NOT exist: `awaiting_category` and `awaiting_registration` answers resolve ONLY against the closed category set or the category buttons and MUST NEVER create a category (see conversational-categories). A name rejected by the reserved or duplicate-variant guards MUST produce a redirect reply, MUST NOT create any category, and MUST leave the pending correction (when one exists) open with the movement in "otro".
(Previously: the dialog single-token auto-create was one of the funneled creation paths.)

#### Scenario: registrar command redirected

- GIVEN owner sends "registrar categoria: previsto"
- WHEN it is processed
- THEN no category is created and a redirect reply teaches "previsto: monto nota"

#### Scenario: Dialog answers never auto-create

- GIVEN an owner in `awaiting_category` replies "Mascotas" (not existing, not reserved)
- WHEN it is processed
- THEN no category is created, the category buttons render, and the pending correction stays open

#### Scenario: then_reassign gated

- GIVEN an owner in `awaiting_category` sends "creá gastos fijos y guardalo ahí"
- WHEN the brain returns `create_category` with `then_reassign: true`
- THEN no category is created and no reassignment occurs (a redirect replies instead)

#### Scenario: Setup entry gated

- GIVEN an owner in `awaiting_setup` replies "Cafe, gastos fijos"
- WHEN it is processed
- THEN "Cafe" is created and "gastos fijos" is rejected with a redirect (no category for it)

### Requirement: Planned Expense Registration (`previsto:` prefix)

The system MUST parse a `previsto:` prefix at arrival, alongside the `compartido:` prefix, and MUST register the movement as a `PENDING` EXPENSE through the existing create path. Planned expenses are INDIVIDUAL by design: `previsto:` MUST NOT compose with `compartido:` — a message combining both prefixes (in either order) MUST be rejected with an educational redirect and MUST NOT create anything, start a dialog, or change the bot state. The prefix MUST work on the brain-absent path. A `previsto:` registration MUST NOT trigger any savings split. The deterministic prefix MUST be authoritative: PENDING MUST be produced ONLY by the `previsto:` prefix or by the explicit Previsto button in the capture preview (see quick-capture); the brain MUST NOT signal planned status (the `planned` flag is removed from the envelope contract) — the type is a button decision, never an inference. A `PENDING` registration MUST always persist as INDIVIDUAL, even when a shared signal leaks in.
(Previously: a brain `planned: true` flag without the prefix could register a PENDING EXPENSE, so the LLM could decide the planned type.)

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

#### Scenario: Prefix wins over a REAL classification

- GIVEN the brain classifies a REAL expense and the text carries "previsto: 2500 alquiler"
- WHEN it is processed
- THEN the PENDING EXPENSE registers anyway (deterministic prefix authoritative)

#### Scenario: Brain never decides the planned type

- GIVEN a `register_expense` envelope mentioning a future expense with no `previsto:` prefix and no Previsto button
- WHEN it is processed
- THEN the movement registers as a REAL expense
- AND PENDING results only from the prefix or the Previsto button