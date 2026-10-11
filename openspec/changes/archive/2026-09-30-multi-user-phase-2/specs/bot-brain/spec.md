# Delta for Bot Brain

## ADDED Requirements

### Requirement: Shared Flag Contract

A `register_expense` envelope MAY carry a `shared` boolean. `shared: true` MUST signal a SHARED registration; `shared: false` or absent MUST signal INDIVIDUAL. The flag is a SIGNAL only — the deterministic `compartido:` prefix in the message text is authoritative and wins over the flag when both are present.

#### Scenario: Shared flag signals shared

- GIVEN a Groq response `{"intent":"register_expense","amount":2000,"note":"super","shared":true}`
- WHEN the payload is validated
- THEN the envelope carries `shared: true`

#### Scenario: Absent flag means individual

- GIVEN a Groq response `{"intent":"register_expense","amount":2000,"note":"super"}`
- WHEN the payload is validated
- THEN the envelope carries `shared: false` (or absent)

#### Scenario: Invalid shared value degrades

- GIVEN a Groq response with `shared: "yes"`
- WHEN the payload is validated
- THEN `null` is returned (schema mismatch degrades to deterministic flow)

## MODIFIED Requirements

### Requirement: Interpret Envelope Contract

The brain MUST validate the LLM JSON with a zod schema `{intent, amount, category, note, dialog_action, then_reassign, shared}` where `intent` is one of `register_expense`, `correct_amount`, `correct_category`, `query`, `query_recent`, `query_balance`, `query_month`, `create_category`, `delete_category`, `rename_category`, `associate_keyword`, `capabilities`, `help`, `off_topic`; `amount` accepts number or string and normalizes via `normalizeAmountString` to a positive finite number or `null`; `category` is a trimmed string of at most 60 chars or `null`; `note` is a trimmed string of at most 200 chars or `null`; `dialog_action` is one of `resolve`, `abandon`, or `null`; `then_reassign` is a boolean flag used only with `create_category`; `shared` is an optional boolean used only with `register_expense`. The call MUST use `temperature: 0` and `response_format: json_object`. A `register_expense` envelope with a non-null amount MUST satisfy `amount > 0` and finite.
(Previously: schema was `{intent, amount, category, note, dialog_action, then_reassign}` with no `shared` flag.)

#### Scenario: Envelope decodes strict JSON

- GIVEN a Groq response `{"intent":"register_expense","amount":"5 mil","category":"Supermercado","note":"gaste en el super"}`
- WHEN the payload is validated
- THEN intent is `register_expense` and amount normalizes to 5000

#### Scenario: Mixed-intent envelope decodes

- GIVEN a Groq response `{"intent":"create_category","category":"Gastos Hormiga","then_reassign":true}`
- WHEN the payload is validated
- THEN the envelope carries the category and `then_reassign: true`

#### Scenario: Unknown intent degrades

- GIVEN a Groq response whose intent is not in the taxonomy
- WHEN the payload is validated
- THEN `null` is returned

#### Scenario: Shared flag decodes with register_expense

- GIVEN a Groq response `{"intent":"register_expense","amount":2000,"shared":true}`
- WHEN the payload is validated
- THEN the envelope carries `shared: true`