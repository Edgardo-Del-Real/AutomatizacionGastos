# Note Interpretation Specification

## Purpose

Deterministic parsing stays authoritative for Telegram note ingestion. The note interpreter is an optional enhancement layer — Groq provider, `openai/gpt-oss-20b` model, JSON mode, Node `fetch`, no new dependencies — that suggests a category on keyword miss and rescues an amount when deterministic parsing fails. Every interpreter failure degrades to today's deterministic behavior.

## Requirements

### Requirement: Note Interpreter Port

The system MUST expose a `NoteInterpreter` port with `interpret(note): Promise<InterpretedNote | null>`, where `InterpretedNote` carries a normalized ARS amount, a category suggestion (`string | null`), and an optional product. The port MUST be the only interpreter surface the bot consumes; the Groq client MUST implement it.

#### Scenario: Valid interpretation

- GIVEN a note and an interpreter response that passes validation
- WHEN `interpret(note)` is invoked
- THEN an `InterpretedNote` with amount, category, and product is returned

#### Scenario: Missing key means no interpreter

- GIVEN `GROQ_API_KEY` is unset
- WHEN the bot is constructed
- THEN no interpreter is constructed and `interpret` is never invoked

### Requirement: Degrade-to-Null Contract

The interpreter MUST return `null` — and MUST NOT throw to the caller — on every failure class: HTTP error, HTTP 429, timeout, non-JSON response, zod schema mismatch, and invalid or missing amount. A `null` result MUST leave the caller on today's deterministic flow.

#### Scenario: Provider error degrades

- GIVEN the provider responds with HTTP 429 or an HTTP error
- WHEN `interpret(note)` is invoked
- THEN `null` is returned

#### Scenario: Malformed payload degrades

- GIVEN the provider returns non-JSON or JSON failing the zod schema
- WHEN `interpret(note)` is invoked
- THEN `null` is returned

#### Scenario: Timeout degrades

- GIVEN the provider does not respond within `LLM_TIMEOUT_MS`
- WHEN `interpret(note)` is invoked
- THEN `null` is returned

### Requirement: Amount Normalization and Validation

The interpreter MUST validate the LLM JSON with a zod schema where `amount` accepts a number or string and is normalized via `normalizeAmountString` to a finite, positive number. Spanish formats (`"1.234,50"`, `"1234,50"`, `"1234.5"`) MUST normalize to the same numeric value. An invalid, non-finite, zero, or negative amount MUST reject the schema and degrade to `null`.

#### Scenario: Spanish thousand-and-cents format

- GIVEN an LLM amount `"1.234,50"`
- WHEN the payload is validated
- THEN the amount normalizes to `1234.5`

#### Scenario: Invalid amount rejected

- GIVEN an LLM amount that is `NaN`, zero, or negative
- WHEN the payload is validated
- THEN the interpretation degrades to `null`

### Requirement: Category Suggestion Contract

The interpreter MAY return a category suggestion. The suggestion MUST NOT create, imply, or auto-create any category; the bot MUST resolve it by exact `normalizeForMatch` comparison against the owner's category list and MUST fall back to "otro" when it does not resolve.

#### Scenario: Suggestion is a suggestion only

- GIVEN an LLM category suggestion
- WHEN the bot resolves it against the owner's categories
- THEN it is used only on exact normalized match, else the movement falls to "otro"

### Requirement: Deterministic-First Invocation

The system MUST invoke the interpreter only on (a) a keyword miss — to suggest a category — and (b) a deterministic amount-parse failure — to rescue an amount. It MUST NOT invoke the interpreter when a user keyword matches. `classifyMovementType` MUST remain deterministic.

#### Scenario: Matched note skips the interpreter

- GIVEN a note that matches a user-authored keyword rule
- WHEN the note is processed
- THEN the movement registers with the matched category and the interpreter is not invoked

#### Scenario: Keyword miss invokes the interpreter

- GIVEN a note that matches no keyword rule
- WHEN the note is processed
- THEN the interpreter is invoked to suggest a category

### Requirement: Amount Precedence and Product Rules

The deterministic amount MUST be authoritative. When both the parser and the interpreter produce amounts that differ, the system MUST ask the owner which is correct and MUST NOT register anything silently. When only the interpreter has an amount, the system MUST register it directly. When only the deterministic amount exists, the interpreter amount MUST be ignored.

#### Scenario: Conflict asks instead of registering

- GIVEN a deterministic amount of 5000 and an interpreter amount of 4800
- WHEN the note is processed
- THEN no movement is registered and the owner is asked which amount is correct

#### Scenario: Rescue registers the interpreter amount

- GIVEN no deterministic amount and a valid interpreter amount of 5000
- WHEN the note is processed
- THEN a movement is registered directly with 5000

### Requirement: Amount-Conflict Question Lifecycle

The pending amount-conflict question MUST follow the `awaiting_category` abandonment semantics. A reply matching one of the presented amounts MUST select it and register the movement with that amount, applying the normal category rules (resolvable interpreter category, else "otro" + `awaiting_category`). Any other reply — including a new registration — MUST abandon the pending question: nothing is registered from the conflicting message, and the new text MUST be processed as a normal registration. The pending question MUST survive a restart.

#### Scenario: Answer selects an amount

- GIVEN the bot asked which of 5000 and 4800 is correct
- WHEN the owner replies "5000"
- THEN a movement registers with 5000 and the pending question closes

#### Scenario: Abandonment discards the question

- GIVEN the bot asked which amount is correct
- WHEN the owner sends a new registration instead of an answer
- THEN the pending question is abandoned, nothing registers from the conflicting message, and the new registration is processed normally

#### Scenario: Pending question survives restart

- GIVEN an unanswered amount-conflict question
- WHEN the process restarts
- THEN the pending question and its movement context are still present

### Requirement: Environment Configuration

`GROQ_API_KEY` MUST be optional; without it the bot MUST run deterministic-only. `LLM_MODEL` MUST default to `openai/gpt-oss-20b`, `LLM_BASE_URL` MUST default to the Groq chat-completions URL, and `LLM_TIMEOUT_MS` MUST default to `5000`. All four MUST be zod-validated (key min-length when present, URL format, positive integer timeout).

#### Scenario: Invalid base URL fails startup

- GIVEN `LLM_BASE_URL` is not a valid URL
- WHEN the API starts
- THEN startup fails with a clear configuration error

### Requirement: Timeout, No-Retry, and Injectable Fetch

The interpreter MUST make a single request attempt bounded by `LLM_TIMEOUT_MS` via `AbortSignal.timeout` and MUST NOT retry. The Groq client MUST accept an injectable `fetchImpl` so unit and integration tests never reach the real endpoint.

#### Scenario: Slow provider aborts

- GIVEN the provider exceeds `LLM_TIMEOUT_MS`
- WHEN the request is made
- THEN the request aborts and the interpretation degrades to `null`

#### Scenario: Stubbed fetch in tests

- GIVEN a test harness injecting a `fetchImpl` stub
- WHEN `interpret(note)` is invoked
- THEN the stub returns canned JSON and no real network call occurs