# Bot Brain Specification

## Purpose

The bot brain is the conversational LLM surface of the Telegram bot. It interprets every conversational message into a strict intent envelope and, after deterministic execution, writes the reply from the ACTUAL executed result (reply-after-action, zero hallucination by construction). It replaces the extraction-only `NoteInterpreter` port, reusing its Groq transport, `normalizeAmountString`, degrade-to-null policy, and env contract verbatim. Every brain failure degrades to the deterministic flow — the brain never blocks the bot.

## Requirements

### Requirement: Bot Brain Port

The system MUST expose a `BotBrain` port with `interpret(message: string): Promise<ConversationEnvelope | null>` and `reply(executionResult: ExecutionResult): Promise<string | null>`, where `ConversationEnvelope` carries an intent, a normalized ARS amount, a category suggestion, and a note, and `ExecutionResult` carries ONLY the executed facts. The port MUST be the only LLM surface the bot consumes, MUST replace `NoteInterpreter` as the bot's dependency, and MUST be implemented by the Groq client (reusing the transport from `GroqNoteInterpreter`).

#### Scenario: Valid interpretation

- GIVEN a conversational message and a Groq response that passes validation
- WHEN `interpret(message)` is invoked
- THEN a `ConversationEnvelope` with intent, amount, category, and note is returned

#### Scenario: Missing key means no brain

- GIVEN `GROQ_API_KEY` is unset
- WHEN the bot is constructed
- THEN no brain is constructed and `interpret`/`reply` are never invoked

### Requirement: Interpret Envelope Contract

The brain MUST validate the LLM JSON with a zod schema `{intent, amount, category, note}` where `intent` is one of `register_expense`, `correct_amount`, `correct_category`, `query_recent`, `query_balance`, `query_month`, `associate_keyword`, `help`, `off_topic`; `amount` accepts number or string and normalizes via `normalizeAmountString` to a positive finite number or `null`; `category` is a trimmed string of at most 60 chars or `null`; `note` is a trimmed string of at most 200 chars or `null`. The call MUST use `temperature: 0` and `response_format: json_object`. A `register_expense` envelope with a non-null amount MUST satisfy `amount > 0` and finite.

#### Scenario: Envelope decodes strict JSON

- GIVEN a Groq response `{"intent":"register_expense","amount":"5 mil","category":"Supermercado","note":"gaste en el super"}`
- WHEN the payload is validated
- THEN intent is `register_expense` and amount normalizes to 5000

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

`register_expense` MUST drive the executed registration flow (amount, category suggestion, note). `query_recent`, `query_balance`, and `query_month` MUST be classified with an honest redirect — no executor exists this slice. `associate_keyword` MUST redirect to the explicit `asociar palabra` command. `help` MUST produce help. `off_topic` MUST produce an expense-scoped redirect and MUST NEVER be answered as general chat. Messages carrying an expense signal (expense verb, `$`, or an amount token) MUST be biased to `register_expense` even when the amount is missing. `correct_amount` and `correct_category` MUST be accepted by the schema but are reserved: dialog-state resolution stays deterministic this slice.

#### Scenario: Off-topic redirects, never chats

- GIVEN an envelope with `intent:"off_topic"`
- WHEN the bot processes it
- THEN the reply is an expense-scoped redirect
- AND no movement is created

#### Scenario: Expense-signal bias in the prompt

- GIVEN the interpret system prompt and few-shots
- WHEN the golden snapshot test runs
- THEN the prompt still biases expense-signal messages to `register_expense`

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

### Requirement: Prompt Contract (category-blind, Fase-2-ready)

The `interpret` system prompt MUST be category-blind — it MUST NOT embed owner category names. The prompt MAY accept an optional context field (owner categories) that a later phase fills; this slice MUST pass no context. The prompt MUST instruct: strict JSON only, never invent an amount, ARS normalization rules, category is a suggestion, off-topic never answered as chat, and expense-signal bias. Both prompts (interpret and reply) MUST be pinned by golden snapshot tests so prompt drift fails CI.

#### Scenario: Prompt drift fails CI

- GIVEN the interpret and reply system prompts
- WHEN the golden snapshot test runs
- THEN the prompts byte-match the committed goldens

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