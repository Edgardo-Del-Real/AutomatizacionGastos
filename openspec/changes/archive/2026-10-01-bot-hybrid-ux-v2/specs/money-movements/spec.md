# Delta for Money Movements

## ADDED Requirements

### Requirement: Bot Movement Type by Menu Button

Movements created by the bot MUST derive `type`, `status`, and `visibility` from the menu-chosen capture type and MUST NOT derive them from message text: REAL → `EXPENSE` + `PAID` + `INDIVIDUAL`; PENDING → `EXPENSE` + `PENDING` + `INDIVIDUAL`; INGRESO → `INCOME` + `PAID` + `INDIVIDUAL`; COMPARTIDO → `EXPENSE` + `PAID` + `SHARED`. The bot MUST NOT classify a movement's type from free text; keyword income detection is NOT used by the bot (it remains only for non-bot channels).

#### Scenario: Ingreso maps to INCOME

- GIVEN an INGRESO capture saves
- WHEN the movement is persisted
- THEN its type is `INCOME`, status `PAID`, and visibility `INDIVIDUAL`

#### Scenario: Compartido maps to SHARED EXPENSE

- GIVEN a COMPARTIDO capture saves
- WHEN the movement is persisted
- THEN its type is `EXPENSE`, status `PAID`, and visibility `SHARED`

#### Scenario: PENDING maps to PENDING EXPENSE

- GIVEN a PENDING capture saves
- WHEN the movement is persisted
- THEN its type is `EXPENSE` and status `PENDING`

#### Scenario: Bot never classifies from free text

- GIVEN an owner in `idle` sends a message with an income keyword such as "cobro"
- WHEN the message is processed
- THEN no movement is created and the message routes through idle free-text routing

## MODIFIED Requirements

### Requirement: Message Income Detection

The system MUST classify an inbound NON-BOT message (webhook channel) as `INCOME` when its normalized note matches any keyword (`ingreso|cobro|sueldo|venta|recibí|depósito`, case-insensitive) OR the amount is prefixed with `+`; otherwise it MUST classify as `EXPENSE`. The Telegram bot MUST NOT use text classification — movement types for bot captures come from the menu buttons (see Bot Movement Type by Menu Button).
(Previously: the detection applied to every inbound message including the bot's free-text captures.)

#### Scenario: Keyword match

- GIVEN a webhook message "Recibí $50000 de sueldo"
- WHEN the system processes the message
- THEN the movement type is `INCOME`

#### Scenario: Plus-prefixed amount

- GIVEN a webhook message "+5000" with no keyword
- WHEN the system processes the message
- THEN the movement type is `INCOME`

#### Scenario: No signal defaults to expense

- GIVEN a webhook message "$2000 supermercado"
- WHEN the system processes the message
- THEN the movement type is `EXPENSE`

#### Scenario: Bot captures ignore the keywords

- GIVEN an INGRESO capture whose note contains no income keyword
- WHEN it is persisted
- THEN the movement is `INCOME` anyway (type comes from the menu button)