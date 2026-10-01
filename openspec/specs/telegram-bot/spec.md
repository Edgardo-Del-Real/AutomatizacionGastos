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

### Requirement: Owner Filtering

The system MUST identify the sender by `message.from.id` and MUST resolve it to a household member's `ownerId` via the household registry. A chatId with a matching member MUST proceed under that member's ownerId; any other chatId MUST NOT produce a movement and MUST NOT receive a reply. When `HOUSEHOLD_MEMBERS` is unset (single-user degraded mode), the system MUST process only when `from.id` equals `TELEGRAM_OWNER_CHAT_ID`, attributing to ownerId `default`.
(Previously: only `TELEGRAM_OWNER_CHAT_ID` was accepted and everything attributed to a single owner.)

#### Scenario: Member chat proceeds under its owner

- GIVEN a `message` whose `from.id` matches Rita's chatId in the registry
- WHEN it is processed
- THEN the message proceeds and attributes to Rita's ownerId

#### Scenario: Partner chat proceeds under its owner

- GIVEN a `message` whose `from.id` matches Edgardo's chatId in the registry
- WHEN it is processed
- THEN the message proceeds and attributes to Edgardo's ownerId

#### Scenario: Unknown chat ignored silently

- GIVEN a `message` whose `from.id` matches no household member
- WHEN it is processed
- THEN no movement is created and no reply is sent

#### Scenario: Single-user degraded mode

- GIVEN `HOUSEHOLD_MEMBERS` unset and `from.id` equals `TELEGRAM_OWNER_CHAT_ID`
- WHEN it is processed
- THEN the message proceeds and attributes to ownerId `default`

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

### Requirement: Movement Parsing, Classification and Categorization

The system MUST NOT parse free text as a movement: capture starts ONLY from a menu tap that persists a capture type (`awaiting_capture`), and the next message MUST be parsed as `monto+nota` (`{amount, note}`) with NO prefixes, NO category in the message, and NO keyword inference. The movement type (REAL/PENDING/INGRESO/COMPARTIDO) MUST come from the menu tap, NEVER from text or the LLM. The category MUST come ONLY from the preview buttons (see quick-capture). The deterministic amount MUST be authoritative; a message in `awaiting_capture` with no parseable amount MUST re-prompt and MUST NOT register anything. The bot MUST NOT invoke the LLM for capture, and keyword rules MUST NOT be consulted by any bot path (the data stays intact for the dashboard).
(Previously: free text in `idle` was parsed deterministic-first with keyword category inference, fell back to the brain for registration, entered collection dialogs on null amounts or unresolvable categories, and asked amount-conflict questions.)

#### Scenario: Menu type plus monto+nota registers

- GIVEN an owner tapped `➕ Nuevo gasto` and sends "14000 pasaje", then chooses "Transporte"
- WHEN `✅ Guardar` executes
- THEN a REAL EXPENSE registers with amount 14000, note "pasaje", category "Transporte", and zero LLM calls occur

#### Scenario: No amount re-prompts

- GIVEN an owner in `awaiting_capture` sends "pasaje"
- WHEN the message is processed
- THEN a clear re-prompt asks for the amount and nothing registers

#### Scenario: Idle capture-shaped text never captures

- GIVEN an owner in `idle` sends "14000 pasaje"
- WHEN the message is processed
- THEN an educational redirect teaches ➕ Nuevo gasto and no movement is created

#### Scenario: Keyword rules unused by the bot

- GIVEN the owner has keyword rules associated with categories
- WHEN any capture or idle message is processed
- THEN no keyword rule is consulted or matched by the bot

### Requirement: Movement Persistence and Error Tolerance

The system MUST persist each valid message as a movement (currency `ARS`, classified type, extracted note, timestamp, resolved owner, assigned category, visibility per the shared-prefix/brain-flag rules) through the movement service. A movement-creation failure MUST be logged and MUST NOT stop subsequent messages or crash the polling loop.
(Previously: category was never set, replies did not exist, and visibility did not exist.)

#### Scenario: Movement persisted for the resolved owner

- GIVEN a member's message resolves to Edgardo's ownerId
- WHEN the movement is created
- THEN it is stored under Edgardo's ownerId

#### Scenario: Persistence failure tolerated

- GIVEN a valid message whose movement creation fails
- WHEN the message is processed
- THEN the failure is logged and remaining messages still process

### Requirement: Configuration and Token Secrecy

The system MUST require `TELEGRAM_BOT_TOKEN` with no default. When `HOUSEHOLD_MEMBERS` is set, member chatIds MUST be validated as positive integers. When unset, `TELEGRAM_OWNER_CHAT_ID` MUST be a positive integer. WhatsApp env vars MUST NOT exist. The token MUST never be logged, including any `api.telegram.org` URL containing it, and household chatIds MUST NOT be logged.
(Previously: only `TELEGRAM_OWNER_CHAT_ID` defined the sole owner chat.)

#### Scenario: Missing token fails fast

- GIVEN `TELEGRAM_BOT_TOKEN` is unset
- WHEN the API starts
- THEN startup fails with a clear configuration error

#### Scenario: Token never logged

- GIVEN an error involving the Telegram API
- WHEN it is logged
- THEN the log contains no token and no `bot<token>` URL

#### Scenario: Malformed household chatId fails fast

- GIVEN `HOUSEHOLD_MEMBERS` contains a non-integer chatId
- WHEN the API starts
- THEN startup fails with a clear configuration error

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

### Requirement: Success and Help Reply Content

The system MUST reply to a successfully saved movement with a confirmation carrying amount, note, and category from the fixed `reply-text.ts` template (no LLM). A query-classified idle message MUST be answered from the executed query result (LLM-written from the executed result or the fixed query template). A greeting-classified idle message MUST reply with a warm, expense-scoped greeting followed by the main menu. A capture-shaped idle text, a legacy-prefix message, or any unresolvable message MUST reply with the educational redirect or "no puedo resolver eso" plus the main menu (see bot-free-text-routing). A reply MUST NOT be sent for non-owner, edited, empty, or deduplicated messages.
(Previously: registration confirmations were LLM-written with the fixed fallback, off-topic and query messages received redirects, greetings never closed dialogs, and the help reply taught prefixes.)

#### Scenario: Save confirmation carries the facts

- GIVEN an owner saves "$2500 cafe" in "Cafe"
- WHEN the movement is created
- THEN a confirmation with amount, note, and category is sent from the fixed template with no LLM call

#### Scenario: Query gets an executed answer

- GIVEN an owner message classified `query_balance` and a successful executor run
- WHEN the message is processed
- THEN the reply answers with the owner's real summary

#### Scenario: Greeting greets and shows the menu

- GIVEN an owner message classified `greeting`
- WHEN the message is processed
- THEN a warm greeting replies followed by the main menu

#### Scenario: Unresolvable gets the fallback plus menu

- GIVEN an owner message that is neither query, greeting, capture-shaped, nor legacy-prefix
- WHEN the message is processed
- THEN "no puedo resolver eso" replies followed by the main menu

### Requirement: Setup Flow (awaiting_setup)

When an owner with no categories sends a capture-shaped message, the system MUST reply asking for their categories, enter the owner's `awaiting_setup` state, and treat the next non-empty text reply as the category list (newline- or comma-separated). The setup reply MUST NOT create the "otro" fallback — "otro" is a legacy reserved row only. A later re-run of `configurar categorias` MUST append new categories rather than overwrite. The `configurar categorias` question MUST list the owner's existing categories (dynamic listing, never fixed text). Before the plain category-list split, the setup reply MUST be parsed for the legacy batch commands `borrar categoria: X`, `renombrar categoria: X a: Y`, and `registrar categoria: X`, which MUST execute through the guarded CategoryService operations and MUST NOT be created as literal categories; only remaining plain tokens become categories.
(Previously: creating the listed categories also created the "otro" fallback.)

#### Scenario: First registration triggers setup

- GIVEN an owner with no categories sends "$2500 cafe"
- WHEN it is processed
- THEN the owner enters `awaiting_setup`
- AND a message asking for categories is sent
- AND the registration is not persisted yet

#### Scenario: Reply creates categories without otro

- GIVEN the owner is in `awaiting_setup`
- WHEN they reply "Cafe\nTransporte"
- THEN categories "Cafe" and "Transporte" are created and no "otro" category is created
- AND a confirmation is sent and the owner returns to `idle`

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

### Requirement: Per-Owner State Machine

The system MUST persist, per owner, a state machine with values `idle`, `awaiting_setup`, `awaiting_capture` (payload `{type}`), `awaiting_preview` (payload `{amount, note, type, category, saveToken, savings?}`), `awaiting_category_name` (preview create-category name input), `awaiting_movement_selection` (sub-menu pick), `awaiting_category_selection` (correction reassign pick), `awaiting_delete_confirmation` (delete gate), `awaiting_savings_rule` (savings sub-menu rule text input), `awaiting_savings_percent` ("Otro" percent input), and `awaiting_savings_delete` (savings rule delete gate). The states `awaiting_category`, `awaiting_registration`, and `awaiting_amount_confirmation` MUST NOT exist; a persisted payload in any of those removed states (e.g. from a rollback) MUST recover to `idle` without registering or deleting anything. Transitions MUST be explicit and testable: a type menu tap in any flow state → abandon the pending flow and enter `awaiting_capture` with the tapped type; `awaiting_capture` + parsed `monto+nota` → `awaiting_preview`; preview `➕ Crear categoría` → `awaiting_category_name`, and a created name → back to `awaiting_preview` with the category selected; preview `✅ Guardar` → registers and `idle` + menu, `✏️ Corregir` → `awaiting_capture` with a capture prompt; the INGRESO confirmation `[Otro]` → `awaiting_savings_percent`, and a valid percent → back to `awaiting_preview` with the override persisted; a delete pick in the expense admin → `awaiting_delete_confirmation` with the resolved target id persisted; `🗑 Borrar` → deletes and `idle` + menu, `❌ Cancelar` or any new message → `idle` with nothing deleted; the savings sub-menu create → `awaiting_savings_rule`, and a parsed rule text → rule defined and `idle` + menu; a savings rule delete pick → `awaiting_savings_delete` with the rule id persisted, and confirm → rule deleted and `idle` + menu, cancel → `idle` with nothing deleted; completed setup → `idle`. Every persisted payload MUST survive a restart, and a corrupt payload MUST recover without registering or deleting anything.
(Previously: the state machine had no savings states, the `awaiting_preview` payload carried no `savings` field, and the removed-state recovery list was unchanged.)

#### Scenario: Menu tap enters awaiting_capture

- GIVEN an owner in `idle` taps `➕ Ingreso`
- WHEN the callback is processed
- THEN the owner transitions to `awaiting_capture` with type INGRESO and a capture prompt replies

#### Scenario: Capture enters preview

- GIVEN an owner in `awaiting_capture` with a parsed "2500 alquiler"
- WHEN the message is processed
- THEN the owner transitions to `awaiting_preview` and the parsed payload is persisted

#### Scenario: Guardar registers and returns to menu

- GIVEN an owner in `awaiting_preview` with a selected category
- WHEN they tap `✅ Guardar`
- THEN the movement registers with the previewed facts, the owner returns to `idle`, and the menu replies

#### Scenario: Menu tap supersedes the preview

- GIVEN an owner in `awaiting_preview` with an unsaved preview
- WHEN they tap a main-menu button
- THEN the preview abandons and the new flow starts fresh

#### Scenario: Removed dialog payload recovers to idle

- GIVEN `pendingNote` holds a payload for `awaiting_registration` or `awaiting_category` (leftover from a previous version)
- WHEN any message is processed
- THEN the state recovers to `idle` with a clear reply and nothing registers

#### Scenario: Delete request enters confirmation

- GIVEN an owner in the expense admin picks a target
- WHEN the pick is processed
- THEN the owner enters `awaiting_delete_confirmation` with the target id persisted
- AND nothing is deleted yet

#### Scenario: Cancelar abandons without deleting

- GIVEN an owner in `awaiting_delete_confirmation`
- WHEN they tap `❌ Cancelar`
- THEN the owner returns to `idle`, the menu replies, and the target movement is untouched

#### Scenario: Delete target survives restart

- GIVEN an owner in `awaiting_delete_confirmation`
- WHEN the process restarts
- THEN the target id and the state are still present

#### Scenario: Otro percent input returns to the confirmation

- GIVEN an INGRESO preview owner taps `[Otro]`
- WHEN they reply "15"
- THEN the confirmation re-renders with savings at 15% and the override is persisted

#### Scenario: Rule delete gate confirms

- GIVEN an owner in `awaiting_savings_delete` after picking a rule
- WHEN they confirm the delete
- THEN the rule is deleted, the owner returns to `idle`, and the menu replies

### Requirement: Bot Commands

The system MUST recognize and handle these owner commands: `menu`, `ayuda`, `listar categorias`, `configurar categorias`, `registrar ahorro: <palabra> al <X>%`, `listar ahorros`, and `borrar ahorro: <palabra>` (see savings). The text category CRUD commands `registrar categoria:`, `renombrar categoria:`, and `asociar palabra:` MUST NOT be recognized as commands — a message carrying them MUST reply with an educational redirect to the `🗂 Administrar categorías` button and MUST NOT create or rename anything. The `menu` command MUST render the eight-button main menu and `ayuda` MUST render the static help (see bot-main-menu). The system MUST register the owner-visible command list via `setMyCommands` at startup. Unrecognized commands MUST fall through to idle free-text routing (see bot-free-text-routing), never to capture.
(Previously: the recognized list covered only `menu`, `ayuda`, `listar categorias`, `configurar categorias`, and `registrar ahorro:`.)

#### Scenario: List categories

- GIVEN owner sends "listar categorias"
- WHEN it is processed
- THEN a reply lists all owner categories

#### Scenario: Text CRUD command redirects to the button flow

- GIVEN owner sends "registrar categoria: Salud"
- WHEN it is processed
- THEN an educational redirect teaches the 🗂 Administrar categorías button and no category is created

#### Scenario: Menu command shows actions

- GIVEN owner sends `menu`
- WHEN it is processed
- THEN the eight-button main menu replies

#### Scenario: Unrecognized command routes to idle classification

- GIVEN owner text that is not a recognized command
- WHEN it is processed
- THEN it is routed through idle free-text routing and never starts capture

#### Scenario: Commands registered on start

- GIVEN the API process starts with a valid bot token
- WHEN the bot boots
- THEN `setMyCommands` is called with the trimmed command list

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

For every non-command owner message in `idle`, the system MUST run the idle classifier (see bot-free-text-routing): deterministic pre-checks first (legacy-prefix and capture-shaped text → educational redirect + menu, zero LLM), then the bot brain for query | greeting | off_topic classification. `query`/`query_recent`/`query_balance`/`query_month`/`query_planned` MUST execute the deterministic query executor and answer from real data (an honest redirect replies only when the query fails or the type is unresolvable); `greeting` MUST reply with a warm expense-scoped greeting plus the menu; `off_topic` or a brain-null result MUST reply "no puedo resolver eso" plus the menu. In `awaiting_capture`, the message MUST be parsed as `monto+nota` with no brain call. The setup gate (owner with no categories) MUST take precedence over idle routing. The state machine MUST remain authoritative — the LLM MUST never decide state transitions, capture types, categories, or destructive actions.
(Previously: every non-command idle message ran the deterministic capture parser first and then the brain, with register/correct/lifecycle/category intents driving execution.)

#### Scenario: Query intent executes and answers from real data

- GIVEN owner text "cuánto gasté" classified `query_balance`
- WHEN the message is processed
- THEN no movement is created and the balance query executor answers with the owner's real summary

#### Scenario: Greeting replies warm and shows the menu

- GIVEN owner text "hola" classified `greeting`
- WHEN the message is processed
- THEN a warm greeting replies followed by the main menu

#### Scenario: Off-topic gets the fallback plus menu

- GIVEN owner text classified `off_topic`
- WHEN the message is processed
- THEN "no puedo resolver eso" replies, no movement is created, and the menu follows

#### Scenario: Capture-shaped text redirects without the LLM

- GIVEN owner text "14000 pasaje" in `idle`
- WHEN the message is processed
- THEN an educational redirect teaches ➕ Nuevo gasto and `interpret` is never invoked

#### Scenario: Setup gate precedes idle routing

- GIVEN an owner with no categories sends "$2500 cafe"
- WHEN the message is processed
- THEN the owner enters `awaiting_setup` and neither the parser nor `interpret` is invoked

#### Scenario: Capture message in awaiting_capture skips the brain

- GIVEN an owner in `awaiting_capture` sends "30000 gym"
- WHEN the message is processed
- THEN the preview flow runs and `interpret` is not invoked

#### Scenario: Brain null degrades to the deterministic fallback

- GIVEN `GROQ_API_KEY` unset or a brain result of `null`
- WHEN a non-capture-shaped message is processed in `idle`
- THEN "no puedo resolver eso" plus the menu replies and nothing captures

### Requirement: LLM Branch Replies with Fixed Fallback

The LLM reply surface MUST be limited to query answers and greeting replies: the brain's `reply` MAY be invoked for a query execution result or a greeting, and the returned text MUST be sent verbatim. Registration, correction, mark-paid, delete, and category admin outcomes MUST use the fixed `reply-text.ts` templates and MUST NOT invoke the LLM. The `reply` call MUST be skipped for commands, the setup flow, capture prompts, and previews. When the brain is absent, `reply` returns `null`, or the reply fails, the system MUST send the fixed template carrying the same executed facts.
(Previously: the brain's `reply` covered registration success, correction, amount conflict, help, and redirects.)

#### Scenario: Query reply sent from the executed result

- GIVEN an executed query result and a brain reply string
- WHEN the outcome is a query answer
- THEN the brain reply string is sent verbatim to the owner

#### Scenario: Capture confirmation uses the fixed template

- GIVEN a saved movement
- WHEN the confirmation is sent
- THEN the fixed template with amount, note, and category is sent and the LLM is never invoked

#### Scenario: Commands and setup skip the reply call

- GIVEN a command or a setup-flow message
- WHEN it is processed
- THEN the brain's `reply` is not invoked

### Requirement: Savings Rule Commands

The system MUST recognize `registrar ahorro: <palabra> al <X>%`, `listar ahorros`, and `borrar ahorro: <palabra>` as owner commands (semantics per the savings capability): the first MUST create or upsert the rule with a confirmation reply, the second MUST list the owner's rules, and the third MUST delete the rule with a confirmation reply. A malformed or out-of-range percent MUST be rejected with a validation error and MUST NOT store a rule. Deleting a keyword with no stored rule MUST reply gracefully. Unrecognized commands MUST still fall through to normal registration parsing.
(Previously: only `registrar ahorro: <palabra> al <X>%` was recognized as the single savings command.)

#### Scenario: Define a savings rule

- GIVEN owner sends "registrar ahorro: entrenuts al 10%"
- WHEN it is processed
- THEN the rule is created or upserted and a confirmation is sent

#### Scenario: Invalid percent rejected

- GIVEN owner sends "registrar ahorro: entrenuts al 0%"
- WHEN it is processed
- THEN a validation error replies and no rule is stored

#### Scenario: List savings rules

- GIVEN owner sends "listar ahorros"
- WHEN it is processed
- THEN a reply lists the owner's rules (or a clear empty reply)

#### Scenario: Delete a savings rule

- GIVEN owner sends "borrar ahorro: entrenuts"
- WHEN it is processed
- THEN the rule is deleted and a confirmation replies

#### Scenario: Delete of an unknown keyword replies gracefully

- GIVEN owner sends "borrar ahorro: gym" with no stored rule
- WHEN it is processed
- THEN a graceful "no existe" reply is sent and nothing changes

#### Scenario: Unrecognized command falls through

- GIVEN owner text that is not a recognized command
- WHEN it is processed
- THEN it is treated as a normal registration

### Requirement: Savings Split on Income Registration

When an INGRESO-type movement registers (from the ➕ Ingreso menu button), the system MUST decide the split by precedence (semantics per the savings capability): a manual choice persisted in the preview payload wins for that income (percent or disabled), otherwise a matching savings-rule keyword applies, otherwise whole. A split MUST register the net INCOME keeping the preview-picked category and a SAVINGS movement in the "ahorro" category in a single transaction, and the confirmation reply MUST report the gross, net, and savings amounts. A COMPARTIDO-typed capture MUST NOT trigger a split. An INGRESO matching no rule with no manual choice MUST register whole. Shared incomes are legacy-only after the redesign; a pre-existing shared income keeps the SHARED inheritance behavior (see savings). The `sin ahorro`/`con X%` text overrides are REMOVED — such text in `idle` gets an educational redirect and never alters a split.
(Previously: the split followed only the automatic rule, both movements landed in "ahorro", and the confirmation reported gross, net, and saved.)

#### Scenario: Ingreso split applied on registration

- GIVEN rule "entrenuts" at 10% and an owner taps ➕ Ingreso then sends "cobro sueldo de entrenuts 1000" with category "Sueldo" picked and no manual choice
- WHEN the preview saves with a chosen category
- THEN INCOME 900 keeps category "Sueldo" and SAVINGS 100 in "ahorro" are created in one transaction
- AND the confirmation reports 1000 gross, 900 net, and 100 saved

#### Scenario: Manual percent wins on registration

- GIVEN rule "entrenuts" at 10% and a manual 15% choice on gross 1000
- WHEN the preview saves
- THEN INCOME 850 and SAVINGS 150 are created in one transaction

#### Scenario: Compartido never splits

- GIVEN capture type COMPARTIDO with a note matching a savings rule
- WHEN the preview saves
- THEN a single SHARED EXPENSE registers and no SAVINGS movement is created

#### Scenario: No rule registers whole

- GIVEN an INGRESO matching no savings rule with no manual choice
- WHEN the preview saves
- THEN a single whole INCOME movement is created and the reply is the standard confirmation

#### Scenario: Legacy shared income keeps SHARED savings

- GIVEN a shared income registered before the redesign with a matching rule
- WHEN the split applies to it
- THEN its SAVINGS movement inherits SHARED visibility like the net INCOME

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

### Requirement: Planned Expense Registration (Gasto previsto button)

The system MUST register a PENDING EXPENSE ONLY through the `📅 Gasto previsto` menu button: the tap persists capture type PENDING, the next `monto+nota` opens the preview, and saving registers a `PENDING` EXPENSE through the existing create path. Planned expenses are INDIVIDUAL by design: a PENDING capture MUST NEVER compose with COMPARTIDO. The `previsto:` prefix is REMOVED: a message starting with `previsto:` in `idle` MUST reply with an educational redirect teaching the 📅 button and MUST NOT create anything, start a dialog, or change the bot state. A PENDING registration MUST NOT trigger any savings split. The type MUST NOT be signaled by the LLM — PENDING results ONLY from the menu button.
(Previously: the `previsto:` prefix parsed at arrival registered the PENDING EXPENSE, and the brain's `planned` flag was rejected.)

#### Scenario: Button registers a planned expense

- GIVEN an owner tapped `📅 Gasto previsto` and sends "2500 alquiler", then chooses a category
- WHEN `✅ Guardar` executes
- THEN a PENDING EXPENSE of 2500 is created and a confirmation replies

#### Scenario: Legacy previsto prefix redirects

- GIVEN owner text "previsto: 2500 alquiler"
- WHEN it is processed
- THEN the educational redirect teaches the 📅 Gasto previsto button, no movement is created, and the state stays untouched

#### Scenario: Brain never decides the planned type

- GIVEN a query-classified message mentioning a future expense with no 📅 button tap
- WHEN it is processed
- THEN no PENDING movement results

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

Every bot-side category-creation path — the preview `➕ Crear categoría` flow, the `🗂 Administrar categorías` create flow, and setup-list entries — MUST funnel through the guarded `CategoryService.createCategory`. Dialog auto-creation MUST NOT exist: capture previews and correction reassigns resolve ONLY against the closed category set or the category buttons and MUST NEVER create a category. A name rejected by the reserved or duplicate-variant guards MUST produce a redirect reply, MUST NOT create any category, and MUST leave the current flow open without a selection.
(Previously: the funnel also covered the `correct_category` target auto-create, the `create_category` intent with `then_reassign`, and the `registrar categoria:` command.)

#### Scenario: Preview create funnels through the guarded path

- GIVEN an owner in `awaiting_category_name` replies "Gimnasio"
- WHEN it is processed
- THEN "Gimnasio" is created through `CategoryService.createCategory` and the preview re-renders with it selected

#### Scenario: Preview and picks never auto-create

- GIVEN a preview category row or a correction reassign row
- WHEN any category button or text is processed
- THEN no category is created beyond the explicit ➕ or admin flows
