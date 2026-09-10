# Delta for money-movements

> Delta decision: the WhatsApp-scoped "Webhook Income Detection" requirement is re-scoped to the Telegram transport via a RENAMED (heading) + MODIFIED (transport-neutral wording) split — deliberately NOT REMOVED+ADDED — so classification semantics and scenario lineage are preserved verbatim at archive time.

## RENAMED Requirements

### Requirement: Webhook Income Detection → Message Income Detection

(Reason: the WhatsApp webhook transport is replaced by the Telegram bot; the requirement name must not imply a transport.)
(Migration: update name references in specs, tasks, and tests; classification behavior is unchanged.)

## MODIFIED Requirements

### Requirement: Message Income Detection

The system MUST classify an inbound message as `INCOME` when its normalized note matches any keyword (`ingreso|cobro|sueldo|venta|recibí|depósito`, case-insensitive) OR the amount is prefixed with `+`; otherwise it MUST classify as `EXPENSE`.
(Previously: "Webhook Income Detection" — wording was "The webhook MUST classify a message"; scenario triggers referenced the webhook transport.)

#### Scenario: Keyword match

- GIVEN message "Recibí $50000 de sueldo"
- WHEN the system processes the message
- THEN the movement type is `INCOME`

#### Scenario: Plus-prefixed amount

- GIVEN message "+5000" with no keyword
- WHEN the system processes the message
- THEN the movement type is `INCOME`

#### Scenario: No signal defaults to expense

- GIVEN message "$2000 supermercado"
- WHEN the system processes the message
- THEN the movement type is `EXPENSE`

#### Scenario: Ambiguous message is conservative

- GIVEN a message with money amounts but no income signal
- WHEN the system processes the message
- THEN the movement type is `EXPENSE` (no false income)