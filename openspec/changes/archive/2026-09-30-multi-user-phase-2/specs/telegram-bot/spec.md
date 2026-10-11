# Delta for Telegram Bot

## ADDED Requirements

### Requirement: Shared Registration via Prefix

The system MUST register a movement as SHARED when its normalized note starts with the prefix `compartido:` (case-insensitive). The prefix MUST be authoritative and deterministic — it MUST work without the bot brain. The prefix MUST be stripped from the stored note. When the brain is present and returns `shared: true` on a `register_expense` envelope, the movement MUST ALSO register as SHARED. When both signals disagree, the prefix MUST win.

#### Scenario: Prefix registers shared without brain

- GIVEN `GROQ_API_KEY` is unset and owner text "compartido: $2000 super"
- WHEN the message is processed
- THEN a SHARED movement registers under the sender's ownerId with note "super"

#### Scenario: Prefix wins over the brain flag

- GIVEN owner text "compartido: $2000 super" and a brain envelope with `shared: false`
- WHEN the message is processed
- THEN the movement registers as SHARED (prefix is authoritative)

#### Scenario: Brain shared flag without prefix

- GIVEN owner text "$2000 super" (no prefix) and a brain envelope with `shared: true`
- WHEN the message is processed
- THEN the movement registers as SHARED

#### Scenario: No signal registers individual

- GIVEN owner text "$2000 super" (no prefix) and a brain envelope without a shared flag
- WHEN the message is processed
- THEN the movement registers as INDIVIDUAL

## MODIFIED Requirements

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

The system MUST record every processed `message` in `ProcessedMessage` under `(chatId, messageId)` and MUST skip, without error or reply, any message whose key already exists. Recording MUST happen AFTER the chat gate: unknown chats MUST NOT be recorded. Deduplication MUST be per `(chatId, messageId)` after the sender's owner has been resolved.
(Previously: dedup applied before owner resolution; ordering relative to the gate was unspecified.)

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