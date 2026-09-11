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

The system MUST reuse the shared parser for amount/note extraction, MUST classify `INCOME`/`EXPENSE` per existing rules, and MUST assign a category from the owner's category set via the shared category matcher. A message with no parseable amount MUST NOT create a movement; it MUST be replied to with help text.
(Previously: parsed and classified only, with no category and no reply.)

#### Scenario: Keyword classification

- GIVEN owner text "Recibí $50000 de sueldo"
- WHEN the message is processed
- THEN an `INCOME` movement is created
- AND it is assigned a matched category when one applies, else "otro"

#### Scenario: No amount

- GIVEN owner text with no parseable number
- WHEN the message is processed
- THEN no movement is created
- AND a help reply is sent

#### Scenario: Defaults to expense

- GIVEN owner text "$2000 supermercado"
- WHEN the message is processed
- THEN an `EXPENSE` movement is created
- AND it is assigned a matched category when one applies, else "otro"

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

The system MUST reply to a successfully registered movement with a confirmation that includes the amount, the note, and the assigned category. The system MUST reply to an unparseable message with help text. A reply MUST NOT be sent for non-owner, edited, empty, or deduplicated messages.

#### Scenario: Success confirmation

- GIVEN an owner registers "$2500 cafe"
- WHEN the movement is created
- THEN a confirmation with amount, note, and category is sent

#### Scenario: Unparseable gets help

- GIVEN owner text with no parseable amount
- WHEN the message is processed
- THEN a help reply is sent and no movement is created

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

When a movement is assigned to "otro", the system MUST reply asking for the correct category, enter `awaiting_category`, and remember the pending movement. In `awaiting_category`, a reply that is a single category name is treated as the ANSWER; any other text (including one that parses as an amount) is treated as a NEW registration. A valid answer MUST reassign the pending movement to that category, learn a keyword rule mapping the original note's first significant word to that category, and confirm. An unknown single-word answer MUST auto-create that category, apply it, and learn the rule.

#### Scenario: Unmatched triggers correction

- GIVEN an owner registration matches no rule
- WHEN it is created as "otro"
- THEN the owner enters `awaiting_category`
- AND the bot asks for the correct category

#### Scenario: Answer reassigns and learns

- GIVEN the owner is in `awaiting_category` for note "uber viaje"
- WHEN they reply "Transporte"
- THEN the pending movement is reassigned to "Transporte"
- AND a keyword rule is learned mapping "uber" to "Transporte"

#### Scenario: Unknown answer auto-creates

- GIVEN the owner is in `awaiting_category`
- WHEN they reply "Mascotas" which is not an existing category
- THEN category "Mascotas" is auto-created
- AND the pending movement is assigned to it
- AND the keyword rule is learned

#### Scenario: Amount during awaiting_category is a new registration

- GIVEN the owner is in `awaiting_category`
- WHEN they send "$8000 supermercado"
- THEN it is treated as a new registration, not an answer
- AND processing follows the normal registration path (possibly re-entering the correction loop)

### Requirement: Per-Owner State Machine

The system MUST persist, per owner, a state machine with values `idle`, `awaiting_setup`, and `awaiting_category`. Transitions MUST be explicit and testable: registration when owner has no categories → `awaiting_setup`; assignment to "otro" → `awaiting_category`; resolved answer or completed setup → `idle`; an answer that is a new registration during `awaiting_category` MUST remain in the registration path without corrupting the pending correction. The pending movement for a correction MUST be persisted so it survives a restart.

#### Scenario: Idle to setup

- GIVEN an owner in `idle` with no categories
- WHEN a valid registration is processed
- THEN the owner transitions to `awaiting_setup`

#### Scenario: Setup back to idle

- GIVEN an owner in `awaiting_setup`
- WHEN a category list is provided
- THEN the owner transitions back to `idle`

#### Scenario: Correction to idle

- GIVEN an owner in `awaiting_category`
- WHEN a valid answer is given
- THEN the owner transitions back to `idle`

#### Scenario: Pending correction survives restart

- GIVEN an owner in `awaiting_category` with a pending movement
- WHEN the process restarts
- THEN the pending movement and state are still present

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