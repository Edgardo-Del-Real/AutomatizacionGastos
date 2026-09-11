# Delta for Telegram Bot

## MODIFIED Requirements

### Requirement: Update Filtering

The system MUST process only `message` updates. `edited_message`, channel posts, service/status updates, and group-chat messages MUST be ignored entirely — never recorded, never creating movements, never triggering a reply. A `message` without text MUST NOT create a movement or reply.
(Previously: filtering was inbound-only with no reply consideration.)

**Feature: Filtering**
#### Scenario: Edited message ignored
  - Given an `edited_message` update
  - When it is processed
  - Then no movement is created and nothing is recorded
  - And no reply is sent
#### Scenario: Non-text message
  - Given a `message` update with a photo and no text
  - When it is processed
  - Then no movement is created
  - And no reply is sent
#### Scenario: Group chat ignored
  - Given a `message` update in a group chat
  - When it is processed
  - Then no movement is created
  - And no reply is sent

### Requirement: Owner Filtering

The system MUST identify the sender by `message.from.id` and MUST process only when it equals `TELEGRAM_OWNER_CHAT_ID`. Any other sender MUST NOT produce a movement and MUST NOT receive a reply.
(Previously: non-owner senders were skipped silently; replies did not exist.)

**Feature: Owner filtering**
#### Scenario: Owner message proceeds
  - Given a `message` whose `from.id` equals `TELEGRAM_OWNER_CHAT_ID`
  - When it is processed
  - Then the message proceeds to parsing
#### Scenario: Non-owner message skipped silently
  - Given a `message` whose `from.id` differs from `TELEGRAM_OWNER_CHAT_ID`
  - When it is processed
  - Then no movement is created
  - And no reply is sent

### Requirement: Message Deduplication

The system MUST record every processed `message` in `ProcessedMessage` under `(chatId, messageId)` and MUST skip, without error or reply, any message whose key already exists.
(Previously: duplicates were skipped silently; no reply existed.)

**Feature: Deduplication**
#### Scenario: Duplicate update skipped
  - Given a message already recorded with the same `(chatId, messageId)`
  - When the same message arrives again
  - Then it is skipped, no movement is created, and no reply is sent
#### Scenario: Same id in different chats
  - Given two messages with the same `messageId` from different chats
  - When both are processed
  - Then both are recorded and processed

### Requirement: Movement Parsing, Classification and Categorization

The system MUST reuse the shared parser for amount/note extraction, MUST classify `INCOME`/`EXPENSE` per existing rules, and MUST assign a category from the owner's category set via the shared category matcher. A message with no parseable amount MUST NOT create a movement; it MUST be replied to with help text.
(Previously: parsed and classified only, with no category and no reply.)

**Feature: Parsing and categorization**
#### Scenario: Keyword classification
  - Given owner text "Recibí $50000 de sueldo"
  - When the message is processed
  - Then an `INCOME` movement is created
  - And it is assigned a matched category when one applies, else "otro"
#### Scenario: No amount
  - Given owner text with no parseable number
  - When the message is processed
  - Then no movement is created
  - And a help reply is sent
#### Scenario: Defaults to expense
  - Given owner text "$2000 supermercado"
  - When the message is processed
  - Then an `EXPENSE` movement is created
  - And it is assigned a matched category when one applies, else "otro"

### Requirement: Movement Persistence and Error Tolerance

The system MUST persist each valid message as a movement (currency `ARS`, classified type, extracted note, timestamp, owner, assigned category) through the movement service. A movement-creation failure MUST be logged and MUST NOT stop subsequent messages or crash the polling loop.
(Previously: category was never set and replies did not exist.)

**Feature: Persistence and tolerance**
#### Scenario: Categorized movement persisted
  - Given owner text matching an owner category
  - When the message is processed
  - Then a movement with that category is created for the owner
#### Scenario: Persistence failure tolerated
  - Given a valid message whose movement creation fails
  - When the message is processed
  - Then the failure is logged and remaining messages still process

## ADDED Requirements

### Requirement: Reply Channel (Bidirectional)

The system MUST expose an injectable reply port that sends a text message back to the sender chat. The reply port MUST be wired to the Telegram bot's reply mechanism in production and to a recording stub in offline tests. A reply failure MUST be logged and MUST NOT stop the polling loop or crash processing.

**Feature: Reply channel**
#### Scenario: Successful reply wired
  - Given a processed owner message that requires a reply
  - When the pipeline emits a reply
  - Then the reply text is sent to the owner chat
#### Scenario: Reply failure tolerated
  - Given the Telegram API fails to send a reply
  - When the pipeline attempts the reply
  - Then the failure is logged and processing continues

### Requirement: Success and Help Reply Content

The system MUST reply to a successfully registered movement with a confirmation that includes the amount, the note, and the assigned category. The system MUST reply to an unparseable message with help text. A reply MUST NOT be sent for non-owner, edited, empty, or deduplicated messages.

**Feature: Reply content**
#### Scenario: Success confirmation
  - Given an owner registers "$2500 cafe"
  - When the movement is created
  - Then a confirmation with amount, note, and category is sent
#### Scenario: Unparseable gets help
  - Given owner text with no parseable amount
  - When the message is processed
  - Then a help reply is sent and no movement is created

### Requirement: Setup Flow (awaiting_setup)

When an owner with no categories sends a valid registration, the system MUST reply asking for their categories, enter the owner's `awaiting_setup` state, and treat the next non-empty text reply as the category list (newline- or comma-separated). Creating the listed categories MUST also create the "otro" fallback and MUST reply with a confirmation. A later re-run of `configurar categorias` MUST append new categories rather than overwrite.

**Feature: Setup flow**
#### Scenario: First registration triggers setup
  - Given an owner with no categories sends "$2500 cafe"
  - When it is processed
  - Then the owner enters `awaiting_setup`
  - And a message asking for categories is sent
  - And the registration is not persisted yet
#### Scenario: Reply creates categories
  - Given the owner is in `awaiting_setup`
  - When they reply "Cafe\nTransporte"
  - Then categories "Cafe" and "Transporte" and "otro" are created
  - And a confirmation is sent
  - And the owner returns to `idle`
#### Scenario: Re-run appends
  - Given an owner with categories in `idle`
  - When they run `configurar categorias`
  - Then the bot asks again, and a reply of "Salud" appends "Salud" without removing existing categories

### Requirement: Correction Loop (awaiting_category) and Learning

When a movement is assigned to "otro", the system MUST reply asking for the correct category, enter `awaiting_category`, and remember the pending movement. In `awaiting_category`, a reply that is a single category name is treated as the ANSWER; any other text (including one that parses as an amount) is treated as a NEW registration. A valid answer MUST reassign the pending movement to that category, learn a keyword rule mapping the original note's first significant word to that category, and confirm. An unknown single-word answer MUST auto-create that category, apply it, and learn the rule.

**Feature: Correction loop**
#### Scenario: Unmatched triggers correction
  - Given an owner registration matches no rule
  - When it is created as "otro"
  - Then the owner enters `awaiting_category`
  - And the bot asks for the correct category
#### Scenario: Answer reassigns and learns
  - Given the owner is in `awaiting_category` for note "uber viaje"
  - When they reply "Transporte"
  - Then the pending movement is reassigned to "Transporte"
  - And a keyword rule is learned mapping "uber" to "Transporte"
#### Scenario: Unknown answer auto-creates
  - Given the owner is in `awaiting_category`
  - When they reply "Mascotas" which is not an existing category
  - Then category "Mascotas" is auto-created
  - And the pending movement is assigned to it
  - And the keyword rule is learned
#### Scenario: Amount during awaiting_category is a new registration
  - Given the owner is in `awaiting_category`
  - When they send "$8000 supermercado"
  - Then it is treated as a new registration, not an answer
  - And processing follows the normal registration path (possibly re-entering the correction loop)

### Requirement: Per-Owner State Machine

The system MUST persist, per owner, a state machine with values `idle`, `awaiting_setup`, and `awaiting_category`. Transitions MUST be explicit and testable: registration when owner has no categories → `awaiting_setup`; assignment to "otro" → `awaiting_category`; resolved answer or completed setup → `idle`; an answer that is a new registration during `awaiting_category` MUST remain in the registration path without corrupting the pending correction. The pending movement for a correction MUST be persisted so it survives a restart.

**Feature: State transitions**
#### Scenario: Idle to setup
  - Given an owner in `idle` with no categories
  - When a valid registration is processed
  - Then the owner transitions to `awaiting_setup`
#### Scenario: Setup back to idle
  - Given an owner in `awaiting_setup`
  - When a category list is provided
  - Then the owner transitions back to `idle`
#### Scenario: Correction to idle
  - Given an owner in `awaiting_category`
  - When a valid answer is given
  - Then the owner transitions back to `idle`
#### Scenario: Pending correction survives restart
  - Given an owner in `awaiting_category` with a pending movement
  - When the process restarts
  - Then the pending movement and state are still present

### Requirement: Bot Commands

The system MUST recognize and handle these owner commands: `registrar categoria: X`, `renombrar categoria: X a: Y`, `asociar palabra: P a categoria: X`, `listar categorias`, and `configurar categorias`. A rename MUST cascade to existing movements (see movement-categories). Unrecognized commands MUST fall through to normal registration parsing.

**Feature: Commands**
#### Scenario: Create category
  - Given owner sends "registrar categoria: Salud"
  - When it is processed
  - Then category "Salud" is created (unless it exists) and a confirmation is sent
#### Scenario: Rename category
  - Given owner sends "renombrar categoria: Cafe a: Cafeteria"
  - When it is processed
  - Then the category and its referenced movements are renamed and a confirmation is sent
#### Scenario: Associate keyword
  - Given owner sends "asociar palabra: uber a categoria: Transporte"
  - When it is processed
  - Then the keyword rule is attached and a confirmation is sent
#### Scenario: List categories
  - Given owner sends "listar categorias"
  - When it is processed
  - Then a reply lists all owner categories
#### Scenario: Unrecognized command falls through
  - Given owner text that is not a command
  - When it is processed
  - Then it is treated as a normal registration

### Requirement: Offline Testability (Reply + Middleware)

The system MUST be drivable offline for reply logic. The offline test harness MUST record outbound reply payloads instead of throwing on network calls, so that reply behavior is asserted without touching the Telegram network. The reply feature and this middleware change MUST be implemented together in the same test-driven cycle.

**Feature: Offline reply testing**
#### Scenario: Offline reply is recorded
  - Given the offline bot harness with a recording middleware
  - When `bot.handleUpdate` processes an update that triggers a reply
  - Then the reply payload is captured and asserted with no network call
#### Scenario: Both land together
  - Given the reply feature is added
  - When tests run
  - Then the recording middleware exists in the same change, so reply tests pass offline