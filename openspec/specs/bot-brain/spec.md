# Bot Brain Specification

## Purpose

The bot brain is the conversational LLM surface of the Telegram bot. It interprets every conversational message into a strict intent envelope and, after deterministic execution, writes the reply from the ACTUAL executed result (reply-after-action, zero hallucination by construction). It replaces the extraction-only `NoteInterpreter` port, reusing its Groq transport, `normalizeAmountString`, degrade-to-null policy, and env contract verbatim. Every brain failure degrades to the deterministic flow — the brain never blocks the bot.

## Requirements

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

### Requirement: Reply-After-Action Contract

The brain's `reply` MUST receive ONLY the executed result — `{intent, ok, action, amount, category, note}` with `action` one of `registered | asked_amount | asked_category | redirected | none` — and MUST produce a reply asserting nothing absent from that result. The reply MUST be warm voseo, at most 2 sentences, with no markdown. A reply failure or `null` MUST leave the caller on the fixed `reply-text.ts` template carrying the same facts.

#### Scenario: Reply reflects only executed facts

- GIVEN an execution result `{intent:"register_expense", ok:true, action:"registered", amount:5000, category:"Supermercado", note:"gaste en el super"}`
- WHEN `reply(result)` is invoked
- THEN the reply confirms the registration with amount, category, and note
- AND the reply contains no fact absent from the result

#### Scenario: Redirected result never invents amounts

- GIVEN an execution result `{intent:"query_balance", ok:false, action:"redirected", amount:null, category:null, note:null}`
- WHEN `reply(result)` is invoked
- THEN the reply states the balance query is not supported yet
- AND the reply contains no amount

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

### Requirement: Degrade-to-Null Contract

`interpret` and `reply` MUST return `null` — and MUST NOT throw to the caller — on every failure class: HTTP error, HTTP 429, timeout, non-JSON response, zod schema mismatch, and invalid or missing amount. A `null` result MUST leave the caller on today's deterministic flow.

#### Scenario: Provider error degrades

- GIVEN the provider responds with HTTP 429 or an HTTP error
- WHEN `interpret(message)` is invoked
- THEN `null` is returned

#### Scenario: Timeout degrades

- GIVEN the provider does not respond within `LLM_TIMEOUT_MS`
- WHEN `interpret(message)` is invoked
- THEN `null` is returned

### Requirement: Amount Normalization and Validation

The brain MUST normalize amounts via `normalizeAmountString`, reused verbatim from the interpreter. Spanish formats (`"1.234,50"`, `"1234,50"`, `"1234.5"`, `"5 mil"`, `"5k"`) MUST normalize to the same numeric values. A non-finite, zero, or negative amount MUST reject the schema and degrade to `null`.

#### Scenario: Prose amounts normalize

- GIVEN an LLM amount `"5 mil"`
- WHEN the payload is validated
- THEN the amount normalizes to 5000

#### Scenario: Invalid amount rejected

- GIVEN an LLM amount that is `NaN`, zero, or negative
- WHEN the payload is validated
- THEN the envelope degrades to `null`

### Requirement: Category Suggestion Contract

The brain MAY return a category suggestion. The suggestion MUST NOT create, imply, or auto-create any category; the bot MUST resolve it by exact `normalizeForMatch` comparison against the owner's category list and MUST fall back to "otro" when it does not resolve. A suggestion normalizing to "otro" MUST be treated as no suggestion.

#### Scenario: Suggestion is a suggestion only

- GIVEN an LLM category suggestion
- WHEN the bot resolves it against the owner's categories
- THEN it is used only on exact normalized match, else the movement falls to "otro"

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

### Requirement: Environment Configuration

`GROQ_API_KEY` MUST be optional; without it the bot MUST run deterministic-only. `LLM_MODEL` MUST default to `openai/gpt-oss-20b`, `LLM_BASE_URL` MUST default to the Groq chat-completions URL, and `LLM_TIMEOUT_MS` MUST default to `5000`. All four MUST be zod-validated (key min-length when present, URL format, positive integer timeout).

#### Scenario: Invalid base URL fails startup

- GIVEN `LLM_BASE_URL` is not a valid URL
- WHEN the API starts
- THEN startup fails with a clear configuration error

### Requirement: Timeout, No-Retry, and Injectable Fetch

The brain MUST make a single request attempt per call, bounded by `LLM_TIMEOUT_MS` via `AbortSignal.timeout`, and MUST NOT retry. The Groq client MUST accept an injectable `fetchImpl` so unit and integration tests never reach the real endpoint.

#### Scenario: Slow provider aborts

- GIVEN the provider exceeds `LLM_TIMEOUT_MS`
- WHEN a brain call is made
- THEN the request aborts and the call degrades to `null`

#### Scenario: Stubbed fetch in tests

- GIVEN a test harness injecting a `fetchImpl` stub
- WHEN `interpret(message)` is invoked
- THEN the stub returns canned JSON and no real network call occurs

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