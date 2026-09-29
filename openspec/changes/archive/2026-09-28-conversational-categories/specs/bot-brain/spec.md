# Delta for bot-brain

## MODIFIED Requirements

### Requirement: Bot Brain Port

The system MUST expose a `BotBrain` port with `interpret(message: string, context?: InterpretContext): Promise<ConversationEnvelope | null>` and `reply(executionResult: ExecutionResult): Promise<string | null>`, where `ConversationEnvelope` carries an intent, a normalized ARS amount, a category suggestion, a note, a `dialog_action`, a `then_reassign` flag, and a `planned` flag, `InterpretContext` carries the current bot state, the persisted pending payload, and the reconstructed open-question text, and `ExecutionResult` carries ONLY the executed facts. The port MUST be the only LLM surface the bot consumes, MUST replace `NoteInterpreter` as the bot's dependency, and MUST be implemented by the Groq client (reusing the transport from `GroqNoteInterpreter`).
(Previously: `interpret(message)` took no context; the envelope carried only intent, amount, category, note, and `dialog_action`.)

#### Scenario: Valid interpretation

- GIVEN a conversational message and a Groq response that passes validation
- WHEN `interpret(message)` is invoked
- THEN a `ConversationEnvelope` with intent, amount, category, note, `dialog_action`, and `planned` is returned

#### Scenario: Dialog context supplied

- GIVEN an owner in `awaiting_category` with a pending movement and an open question
- WHEN `interpret(message, { state, pending, openQuestion })` is invoked
- THEN the context is passed to the prompt and the response validates normally

#### Scenario: Missing key means no brain

- GIVEN `GROQ_API_KEY` is unset
- WHEN the bot is constructed
- THEN no brain is constructed and `interpret`/`reply` are never invoked

### Requirement: Interpret Envelope Contract

The brain MUST validate the LLM JSON with a zod schema `{intent, amount, category, note, dialog_action, then_reassign, planned}` where `intent` is one of `register_expense`, `correct_amount`, `correct_category`, `query`, `query_recent`, `query_balance`, `query_month`, `query_planned`, `create_category`, `delete_category`, `rename_category`, `associate_keyword`, `create_savings_rule`, `capabilities`, `help`, `off_topic`; `amount` accepts number or string and normalizes via `normalizeAmountString` to a positive finite number or `null`; `category` is a trimmed string of at most 60 chars or `null`; `note` is a trimmed string of at most 200 chars or `null`; `dialog_action` is one of `resolve`, `abandon`, or `null`; `then_reassign` is a boolean flag used only with `create_category`; `planned` is a boolean flag used only with `register_expense` (mirror of `shared`). The call MUST use `temperature: 0` and `response_format: json_object`. A `register_expense` envelope with a non-null amount MUST satisfy `amount > 0` and finite.
(Previously: the schema had no `planned` field.)

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

#### Scenario: Savings-rule intent decodes

- GIVEN a Groq response `{"intent":"create_savings_rule","category":"entrenuts","note":"al 10%"}`
- WHEN the payload is validated
- THEN the envelope carries intent `create_savings_rule`

#### Scenario: Planned query intent decodes

- GIVEN a Groq response `{"intent":"query_planned"}`
- WHEN the payload is validated
- THEN the envelope carries intent `query_planned`

#### Scenario: Planned flag decodes

- GIVEN a Groq response `{"intent":"register_expense","amount":2500,"planned":true}`
- WHEN the payload is validated
- THEN the envelope carries `planned: true`

### Requirement: Category Suggestion Contract

The brain MAY return a category suggestion and MAY set the `planned` flag. Neither MUST create, imply, or auto-create anything: the bot MUST resolve the category by exact `normalizeForMatch` comparison against the owner's category list and MUST fall back to "otro" when it does not resolve; the `planned` flag is materialized only by the deterministic guarded registration path, never by the brain. A suggestion normalizing to "otro" MUST be treated as no suggestion.
(Previously: only the category suggestion existed; the envelope had no `planned` flag.)

#### Scenario: Suggestion is a suggestion only

- GIVEN an LLM category suggestion
- WHEN the bot resolves it against the owner's categories
- THEN it is used only on exact normalized match, else the movement falls to "otro"

#### Scenario: Planned flag is a suggestion only

- GIVEN an envelope with `planned: true` and no `previsto:` prefix
- WHEN the registration is materialized
- THEN PENDING results only through the deterministic guarded path and the brain creates no category or status

### Requirement: Prompt Contract (category-blind, dialog-aware)

The `interpret` system prompt MUST be category-blind — it MUST NOT embed owner category names. The prompt MUST accept and embed the dialog context (state, pending payload, open-question text) when provided, and MUST include per-dialog few-shots so dialog answers classify reliably. The prompt MUST instruct: strict JSON only, never invent an amount, ARS normalization rules, category is a suggestion, off-topic never answered as chat, expense-signal bias, `dialog_action` semantics, planned-query phrasings ("previsto", "gastos fijos previstos", "cuánto voy a gastar el mes que viene") classifying as `query_planned`, conversational planned phrasings ("dejalo para el mes que viene", "lo pago el mes que viene") setting `planned: true` on `register_expense`, the `previsto:` prefix being authoritative, and the brain never creating categories or planned status. Both prompts (interpret and reply) and their dialog variants MUST be pinned by golden snapshot tests so prompt drift fails CI. When the prompts change to teach the `planned` flag (alongside `create_savings_rule`, split-reply facts, and the `planned` query), the 8 pinned golden snapshots in `bot-brain.test.ts` MUST be regenerated in the same change so CI stays green.
(Previously: the prompt had no planned-query instruction and no planned-flag teaching.)

#### Scenario: Prompt drift fails CI

- GIVEN the interpret and reply system prompts
- WHEN the golden snapshot test runs
- THEN the prompts byte-match the committed goldens

#### Scenario: Dialog prompt variant pinned

- GIVEN the `awaiting_category` dialog prompt variant with few-shots
- WHEN the golden snapshot test runs
- THEN the variant byte-matches its committed golden

#### Scenario: Prompt changes regenerate goldens in-cycle

- GIVEN the prompts change to teach the `planned` flag
- WHEN the change is implemented and tests run
- THEN all 8 golden snapshots in `bot-brain.test.ts` are regenerated in the same change and CI passes

#### Scenario: Planned-query prompt instruction pinned

- GIVEN the interpret system prompt teaches planned-query phrasings
- WHEN the golden snapshot test runs
- THEN the prompt byte-matches the committed golden

#### Scenario: Planned-flag prompt instruction pinned

- GIVEN the interpret system prompt teaches conversational planned phrasing and the `planned` flag
- WHEN the golden snapshot test runs
- THEN the prompt byte-matches the committed golden