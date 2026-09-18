# Delta for Bot Brain

## ADDED Requirements

### Requirement: Dialog Action Contract

The brain MUST classify a dialog-state message with `dialog_action` in its envelope: `resolve` when the message answers the open question (an exact category name for `awaiting_category`, a presented amount for `awaiting_amount_confirmation`), `abandon` when the message explicitly abandons the dialog, and `null` otherwise. A `resolve` classification MUST NOT invent amounts or categories beyond the message's own content — the controller acts ONLY on the persisted payload. A bare affirmation ("si") that matches no presented value MUST NOT classify as `resolve`.

#### Scenario: Resolve classified for an exact category answer

- GIVEN an owner in `awaiting_category` asked for a category
- WHEN the message is "Transporte" and the category exists
- THEN the envelope carries `dialog_action: "resolve"`

#### Scenario: Abandon classified for an explicit out

- GIVEN an owner in `awaiting_category`
- WHEN the message is "no, dejalo"
- THEN the envelope carries `dialog_action: "abandon"`

#### Scenario: Null for a query during a dialog

- GIVEN an owner in `awaiting_category` with an open question
- WHEN the message is "decime los últimos movimientos"
- THEN the envelope carries `dialog_action: null` and a query intent

#### Scenario: Bare affirmation never resolves

- GIVEN an owner in `awaiting_amount_confirmation` with presented amounts 5000 and 4800
- WHEN the message is "si"
- THEN `dialog_action` is NOT `resolve` and no amount is invented

## MODIFIED Requirements

### Requirement: Bot Brain Port

The system MUST expose a `BotBrain` port with `interpret(message: string, context?: InterpretContext): Promise<ConversationEnvelope | null>` and `reply(executionResult: ExecutionResult): Promise<string | null>`, where `ConversationEnvelope` carries an intent, a normalized ARS amount, a category suggestion, a note, a `dialog_action`, and a `then_reassign` flag, `InterpretContext` carries the current bot state, the persisted pending payload, and the reconstructed open-question text, and `ExecutionResult` carries ONLY the executed facts. The port MUST be the only LLM surface the bot consumes, MUST replace `NoteInterpreter` as the bot's dependency, and MUST be implemented by the Groq client (reusing the transport from `GroqNoteInterpreter`).
(Previously: `interpret(message)` took no context; the envelope carried only intent, amount, category, and note.)

#### Scenario: Valid interpretation

- GIVEN a conversational message and a Groq response that passes validation
- WHEN `interpret(message)` is invoked
- THEN a `ConversationEnvelope` with intent, amount, category, note, and `dialog_action` is returned

#### Scenario: Dialog context supplied

- GIVEN an owner in `awaiting_category` with a pending movement and an open question
- WHEN `interpret(message, { state, pending, openQuestion })` is invoked
- THEN the context is passed to the prompt and the response validates normally

#### Scenario: Missing key means no brain

- GIVEN `GROQ_API_KEY` is unset
- WHEN the bot is constructed
- THEN no brain is constructed and `interpret`/`reply` are never invoked

### Requirement: Interpret Envelope Contract

The brain MUST validate the LLM JSON with a zod schema `{intent, amount, category, note, dialog_action, then_reassign}` where `intent` is one of `register_expense`, `correct_amount`, `correct_category`, `query`, `query_recent`, `query_balance`, `query_month`, `create_category`, `delete_category`, `rename_category`, `associate_keyword`, `capabilities`, `help`, `off_topic`; `amount` accepts number or string and normalizes via `normalizeAmountString` to a positive finite number or `null`; `category` is a trimmed string of at most 60 chars or `null`; `note` is a trimmed string of at most 200 chars or `null`; `dialog_action` is one of `resolve`, `abandon`, or `null`; `then_reassign` is a boolean flag used only with `create_category`. The call MUST use `temperature: 0` and `response_format: json_object`. A `register_expense` envelope with a non-null amount MUST satisfy `amount > 0` and finite.
(Previously: schema was `{intent, amount, category, note}` with no `dialog_action`, no `then_reassign`, and a narrower intent taxonomy.)

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

### Requirement: Intent Taxonomy

`register_expense` MUST drive the executed registration flow (amount, category suggestion, note). `query`, `query_recent`, `query_balance`, and `query_month` MUST be classified for deterministic execution — the query executor exists and answers from real data. `associate_keyword` MUST redirect to the explicit `asociar palabra` command. `help` MUST produce help. `off_topic` MUST produce an expense-scoped redirect and MUST NEVER be answered as general chat. Messages carrying an expense signal (expense verb, `$`, or an amount token) MUST be biased to `register_expense` even when the amount is missing. `correct_category` MUST drive the movement-correction flow (matcher + reassign, see movement-correction). `correct_amount` MUST be accepted by the schema but stays reserved in `idle`; in dialog states the `dialog_action` field routes the message.
(Previously: queries were classified with an honest redirect because no executor existed; `correct_amount` and `correct_category` were both reserved with deterministic dialog resolution.)

#### Scenario: Off-topic redirects, never chats

- GIVEN an envelope with `intent:"off_topic"`
- WHEN the bot processes it
- THEN the reply is an expense-scoped redirect
- AND no movement is created

#### Scenario: Expense-signal bias in the prompt

- GIVEN the interpret system prompt and few-shots
- WHEN the golden snapshot test runs
- THEN the prompt still biases expense-signal messages to `register_expense`

#### Scenario: Query intent executes real data

- GIVEN an envelope with `intent:"query"` and `query_type:"recent"`
- WHEN the bot processes it
- THEN the deterministic query executor answers with the owner's real movements

#### Scenario: Correct-category activates the correction flow

- GIVEN an envelope with `intent:"correct_category"` carrying a category and a movement reference
- WHEN the bot processes it
- THEN the movement-correction matcher runs and reassigns or asks

### Requirement: Prompt Contract (category-blind, dialog-aware)

The `interpret` system prompt MUST be category-blind — it MUST NOT embed owner category names. The prompt MUST accept and embed the dialog context (state, pending payload, open-question text) when provided, and MUST include per-dialog few-shots so dialog answers classify reliably. The prompt MUST instruct: strict JSON only, never invent an amount, ARS normalization rules, category is a suggestion, off-topic never answered as chat, expense-signal bias, and `dialog_action` semantics. Both prompts (interpret and reply) and their dialog variants MUST be pinned by golden snapshot tests so prompt drift fails CI.
(Previously: the prompt accepted only an optional owner-categories context that this slice never passed; no dialog context and no dialog few-shots.)

#### Scenario: Prompt drift fails CI

- GIVEN the interpret and reply system prompts
- WHEN the golden snapshot test runs
- THEN the prompts byte-match the committed goldens

#### Scenario: Dialog prompt variant pinned

- GIVEN the `awaiting_category` dialog prompt variant with few-shots
- WHEN the golden snapshot test runs
- THEN the variant byte-matches its committed golden

## Pre-Existing Drift (informational)

- Canonical `bot-brain` "Intent Taxonomy" and "Interpret Envelope Contract" pin an honest query redirect and a narrower intent taxonomy; live `bot-brain.ts` already ships `query`, `query_type`, `new_name`, `create_category`, `delete_category`, `rename_category`, `capabilities`. This delta reconciles the schema and taxonomy to the live contract.
- Canonical `bot-brain` "Bot Brain Port" still names `NoteInterpreter` as the replaced dependency; the interpreter was already removed.