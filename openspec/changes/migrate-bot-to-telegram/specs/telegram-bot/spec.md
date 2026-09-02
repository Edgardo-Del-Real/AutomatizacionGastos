# Telegram Bot Specification

## Purpose

Sole inbound surface for movement ingestion, via Telegram Bot API long polling (`getUpdates`). Only the owner's text messages are parsed, classified, and persisted as movements. Inbound-only (no outbound replies); only `message` updates are processed; all logic is drivable offline through `bot.handleUpdate()`.

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

The system MUST process only `message` updates. `edited_message`, channel posts, and service/status updates MUST be ignored entirely — never recorded, never creating movements. Messages from group chats MUST be ignored. A `message` without text MUST NOT create a movement.

#### Scenario: Edited message ignored

- GIVEN an `edited_message` update
- WHEN it is processed
- THEN no movement is created and nothing is recorded

#### Scenario: Non-text message

- GIVEN a `message` update with a photo and no text
- WHEN it is processed
- THEN no movement is created

#### Scenario: Group chat ignored

- GIVEN a `message` update in a group chat
- WHEN it is processed
- THEN no movement is created

### Requirement: Owner Filtering

The system MUST identify the sender by `message.from.id` and MUST create a movement only when it equals the configured `TELEGRAM_OWNER_CHAT_ID`. Any other sender MUST NOT produce a movement.

#### Scenario: Owner message proceeds

- GIVEN a `message` whose `from.id` equals `TELEGRAM_OWNER_CHAT_ID`
- WHEN it is processed
- THEN the message proceeds to parsing

#### Scenario: Non-owner message skipped

- GIVEN a `message` whose `from.id` differs from `TELEGRAM_OWNER_CHAT_ID`
- WHEN it is processed
- THEN no movement is created

### Requirement: Message Deduplication

The system MUST record every processed `message` in `ProcessedMessage` under the composite unique key `(chatId, messageId)` and MUST skip, without error, any message whose key already exists.

#### Scenario: Duplicate update skipped

- GIVEN a message already recorded with the same `(chatId, messageId)`
- WHEN the same message arrives again
- THEN it is skipped and no duplicate movement is created

#### Scenario: Same id in different chats

- GIVEN two messages with the same `messageId` from different chats
- WHEN both are processed
- THEN both are recorded and processed

### Requirement: Movement Parsing and Classification

The system MUST reuse the shared transport-agnostic parser (`features/messages/`) for amount extraction and note cleanup. It MUST classify `INCOME` when the text matches any keyword (`ingreso|cobro|sueldo|venta|recibí|depósito`, case-insensitive) or the amount is `+`-prefixed; otherwise `EXPENSE`. A message with no parseable amount MUST NOT create a movement.

#### Scenario: Keyword classification

- GIVEN owner text "Recibí $50000 de sueldo"
- WHEN the message is processed
- THEN a movement of type `INCOME` is created

#### Scenario: No amount

- GIVEN owner text with no parseable number
- WHEN the message is processed
- THEN no movement is created

#### Scenario: Defaults to expense

- GIVEN owner text "$2000 supermercado"
- WHEN the message is processed
- THEN a movement of type `EXPENSE` is created

### Requirement: Movement Persistence and Error Tolerance

The system MUST persist each valid message as a movement through the existing expense service: currency `ARS`, classified type, extracted note, current timestamp, configured owner. A movement-creation failure MUST be logged and MUST NOT stop subsequent messages.

#### Scenario: Income movement persisted

- GIVEN owner text "+5000" with no keyword
- WHEN the message is processed
- THEN an `INCOME` movement of ARS 5000 is created for the owner

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