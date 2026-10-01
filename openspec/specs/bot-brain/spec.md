# Bot Brain Specification

## Purpose

The bot brain is the conversational LLM surface of the Telegram bot. It interprets every conversational message into a strict intent envelope and, after deterministic execution, writes the reply from the ACTUAL executed result (reply-after-action, zero hallucination by construction). It replaces the extraction-only `NoteInterpreter` port, reusing its Groq transport, `normalizeAmountString`, degrade-to-null policy, and env contract verbatim. Every brain failure degrades to the deterministic flow — the brain never blocks the bot.

## Requirements

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

The brain MUST validate the LLM JSON with a zod schema `{intent, amount, category, note, dialog_action, then_reassign, shared}` where `intent` is one of `register_expense`, `correct_amount`, `correct_category`, `query`, `query_recent`, `query_balance`, `query_month`, `query_planned`, `create_category`, `delete_category`, `rename_category`, `associate_keyword`, `create_savings_rule`, `mark_paid`, `delete_expense`, `capabilities`, `help`, `off_topic`, `greeting`; `amount` accepts number or string and normalizes via `normalizeAmountString` to a positive finite number or `null`; `category` is a trimmed string of at most 60 chars or `null`; `note` is a trimmed string of at most 200 chars or `null`; `dialog_action` is one of `resolve`, `abandon`, or `null`; `then_reassign` is a boolean flag used only with `create_category`; `shared` is an optional boolean used only with `register_expense`. The schema MUST NOT accept a `planned` field: the planned type is a deterministic button decision (see quick-capture) and the brain MUST NOT infer it — a response carrying `planned` MUST degrade to `null`. The call MUST use `temperature: 0` and `response_format: json_object`. A `register_expense` envelope with a non-null amount MUST satisfy `amount > 0` and finite. A `register_expense` envelope with `amount: null` MUST remain valid — it drives the `awaiting_registration` collection entry. A `mark_paid` or `delete_expense` envelope MUST carry its reference cues in `category` and/or `amount` and MUST NOT carry a movement id — the bot resolves the target deterministically against real data; `delete_expense` MUST NOT delete anything by itself: it opens the confirmation gate (see bot-expense-lifecycle).
(Previously: the schema accepted a `planned` flag that could materialize PENDING, and `delete_expense` executed immediately on the resolved target.)

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

#### Scenario: Planned field rejected

- GIVEN a Groq response `{"intent":"register_expense","amount":2500,"planned":true}`
- WHEN the payload is validated
- THEN `null` is returned and the deterministic flow applies

#### Scenario: Greeting intent decodes

- GIVEN a Groq response `{"intent":"greeting"}`
- WHEN the payload is validated
- THEN the envelope carries intent `greeting`

#### Scenario: Null-amount register remains valid

- GIVEN a Groq response `{"intent":"register_expense","amount":null,"note":"gym"}`
- WHEN the payload is validated
- THEN the envelope carries `register_expense` with amount null and routes to collection

#### Scenario: Lifecycle intent decodes

- GIVEN a Groq response `{"intent":"mark_paid","category":"Alquiler"}`
- WHEN the payload is validated
- THEN the envelope carries intent `mark_paid` with the category reference cue

#### Scenario: Shared flag decodes with register_expense

- GIVEN a Groq response `{"intent":"register_expense","amount":2000,"shared":true}`
- WHEN the payload is validated
- THEN the envelope carries `shared: true`

### Requirement: Reply-After-Action Contract

The brain's `reply` MUST receive ONLY the executed result — `{intent, ok, action, amount, category, note, gross_amount, net_amount, savings_amount, planned_month, planned_total}` with `action` one of `registered | asked_amount | asked_category | asked_registration | redirected | none` — and MUST produce a reply asserting nothing absent from that result. When a savings split applied, `gross_amount`, `net_amount`, and `savings_amount` MUST carry the executed facts and the reply MUST confirm the split. A planned-query result MUST carry `planned_month` and `planned_total`, and the reply MUST confirm the next-month planned total from those facts. An `asked_registration` result MUST carry the open question (which field is being asked: amount or category) and the reply MUST ask exactly that grounded question, never inventing facts. The reply MUST be warm voseo, at most 2 sentences, with no markdown. A reply failure or `null` MUST leave the caller on the fixed `reply-text.ts` template carrying the same facts.
(Previously: the executed result carried no planned facts and no `asked_registration` action; collection questions had no reply surface.)

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

#### Scenario: Split result confirms gross, net, and savings

- GIVEN an execution result with `action:"registered"`, `gross_amount:1000`, `net_amount:900`, and `savings_amount:100`
- WHEN `reply(result)` is invoked
- THEN the reply confirms the net income of 900 and the 100 saved
- AND the reply contains no amount absent from the result

#### Scenario: Planned query reply reflects executed facts

- GIVEN an execution result `{intent:"query_planned", ok:true, action:"none", planned_month:"2026-09", planned_total:4000}`
- WHEN `reply(result)` is invoked
- THEN the reply confirms 4000 for 2026-09 and contains no fact absent from the result

#### Scenario: Collection question asks only the open field

- GIVEN an execution result `{intent:"register_expense", ok:false, action:"asked_registration", amount:null, category:null, note:"gym"}`
- WHEN `reply(result)` is invoked
- THEN the reply asks the amount (or the category when that is the open field)
- AND the reply invents no amount and no category

### Requirement: Intent Taxonomy

`register_expense` MUST drive the executed registration flow (amount, category suggestion, note) — with `amount: null` entering the `awaiting_registration` collection dialog (see registration-collection) instead of dead-ending. `query`, `query_recent`, `query_balance`, `query_month`, and `query_planned` MUST be classified for deterministic execution — the query executor exists and answers from real data, and the planned executor answers the owner's next-month planned total (see planned-fixed-expenses). `associate_keyword` MUST redirect to the explicit `asociar palabra` command. `create_savings_rule` MUST redirect to the explicit `registrar ahorro: <palabra> al <X>%` command (`associate_keyword` precedent). `help` MUST produce help. `off_topic` MUST produce an expense-scoped redirect and MUST NEVER be answered as general chat. `greeting` MUST produce a warm expense-scoped greeting and MUST NOT close any open dialog — this deliberately REVERSES the previous "off_topic never chats" contract for greeting-classified messages only; `off_topic` remains strictly redirect-only. Messages carrying an expense signal (expense verb, `$`, or an amount token) MUST be biased to `register_expense` even when the amount is missing. `correct_category` MUST drive the movement-correction flow (matcher + reassign, see movement-correction). `correct_amount` MUST be accepted by the schema but stays reserved in `idle`; in dialog states the `dialog_action` field routes the message. `mark_paid` MUST drive the movement-lifecycle executor to transition a referenced PENDING EXPENSE to PAID through `MovementService.markMovementPaid`, and `delete_expense` MUST drive it to resolve a referenced expense through `ExpenseService.deleteExpense` and OPEN the confirmation gate (see bot-expense-lifecycle); neither intent MUST create a category or register a movement, and `delete_expense` MUST NOT delete without the owner's explicit `🗑 Borrar` confirmation. The brain is the FALLBACK surface: the deterministic `QuickCaptureParser` runs first in `idle`, and the brain is invoked only for intents the parser did not capture; the brain MUST NOT decide state transitions, MUST NOT pick a delete target silently, and MUST NOT infer the planned type.
(Previously: the taxonomy had no planned-query classification, no `greeting` intent, and no lifecycle intents; every non-expense signal including "hola" fell to `off_topic` and was never answered as chat. The brain was invoked for every `idle` message and `delete_expense` executed immediately.)

#### Scenario: Off-topic redirects, never chats

- GIVEN an envelope with `intent:"off_topic"`
- WHEN the bot processes it
- THEN the reply is an expense-scoped redirect
- AND no movement is created

#### Scenario: Greeting replies warm and keeps dialogs alive

- GIVEN an envelope with `intent:"greeting"` while an `awaiting_registration` dialog is open
- WHEN the bot processes it
- THEN a warm greeting replies and the open dialog and its payload stay intact

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

#### Scenario: Savings-rule intent redirects to the command

- GIVEN an envelope with `intent:"create_savings_rule"`
- WHEN the bot processes it
- THEN the bot redirects to the explicit `registrar ahorro: <palabra> al <X>%` command and executes nothing itself

#### Scenario: Planned query intent executes real data

- GIVEN an envelope with `intent:"query_planned"`
- WHEN the bot processes it
- THEN the deterministic executor answers with the owner's next-month planned total

#### Scenario: Mark-paid intent activates the lifecycle executor

- GIVEN an envelope with `intent:"mark_paid"` carrying a category reference
- WHEN the bot processes it
- THEN the movement-lifecycle executor marks the referenced PENDING expense PAID and replies once

#### Scenario: Delete-expense intent opens the confirmation gate

- GIVEN an envelope with `intent:"delete_expense"` carrying an amount reference
- WHEN the bot processes it
- THEN the lifecycle executor resolves the referenced expense and the confirmation gate opens
- AND nothing is deleted yet

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

The brain MAY return a category suggestion. It MUST NOT create, imply, or auto-create anything: the bot MUST resolve the category against the owner's category list exact-first via `normalizeForMatch` and then via the tolerant plural fold (`normalizeForMatchTolerant`), so folded variants such as "cafes"→"Cafe" and "Otros"→"otro" resolve; a suggestion that folds to "otro" MUST be treated as no suggestion, and any unresolved suggestion MUST fall back to "otro". The brain MUST NOT signal planned status: PENDING is produced ONLY by the deterministic `previsto:` prefix or the Previsto button (see quick-capture), never by the brain.
(Previously: the brain could set a `planned` flag that the guarded registration path materialized into PENDING; resolution was exact `normalizeForMatch` comparison only, so "Otros" never resolved to "otro" on the idle path.)

#### Scenario: Suggestion is a suggestion only

- GIVEN an LLM category suggestion
- WHEN the bot resolves it against the owner's categories
- THEN it is used only on resolution, else the movement falls to "otro"

#### Scenario: Folded suggestion resolves

- GIVEN the brain suggests "Otros" and the owner has the "otro" category
- WHEN the bot resolves the suggestion
- THEN it resolves to "otro" and no phantom category is created

#### Scenario: Brain never signals planned

- GIVEN a `register_expense` envelope mentioning a future expense with no `previsto:` prefix and no Previsto button
- WHEN the registration is materialized
- THEN it registers as a REAL expense and no PENDING status results from the brain

### Requirement: Prompt Contract (category-blind, dialog-aware)

The `interpret` system prompt MUST be category-blind — it MUST NOT embed owner category names. The prompt MUST accept and embed the dialog context (state, pending payload, open-question text) when provided, and MUST include per-dialog few-shots so dialog answers classify reliably. The prompt MUST instruct: strict JSON only, never invent an amount, ARS normalization rules, category is a suggestion, off-topic never answered as chat, greeting classified as `greeting` (warm reply; dialogs stay open), expense-signal bias, `dialog_action` semantics, planned-query phrasings ("previsto", "gastos fijos previstos", "cuánto voy a gastar el mes que viene") classifying as `query_planned`, the `previsto:` prefix being authoritative, and the brain never creating categories, never inferring the planned type, and never deciding destructive actions. The prompt MUST also state that the brain is a FALLBACK: deterministic quick capture runs first, category suggestions resolve against the owner's categories ("otro" is the fallback), and `delete_expense` always requires the owner's button confirmation before anything is deleted. The prompt MUST teach the `mark_paid` and `delete_expense` intents (with few-shots) so conversational lifecycle phrasings ("ya lo pagué", "pásalo a pagado", "borra ese gasto") classify to them. The prompt MUST also teach the `awaiting_registration` dialog: `resolve` when the message answers the open field (an amount for the amount question, a category name for the category question), `abandon` on explicit outs, `null` otherwise — and MUST teach that `register_expense` with `amount: null` starts collection rather than dead-ending. Both prompts (interpret and reply) and their dialog variants MUST be pinned by golden snapshot tests so prompt drift fails CI. When the prompts change to remove the `planned` flag teaching and teach the fallback role, the delete-confirmation gate, and the closed-set category rule (alongside `create_savings_rule`, split-reply facts, the `planned` query, the category-resolution hint, and the lifecycle intents), the pinned golden snapshots in `bot-brain.test.ts` MUST be regenerated in the same change so CI stays green.
(Previously: the prompt taught conversational planned phrasings setting `planned: true` on `register_expense`, had no fallback-first framing, and taught lifecycle intents as immediately executing.)

#### Scenario: Prompt drift fails CI

- GIVEN the interpret and reply system prompts
- WHEN the golden snapshot test runs
- THEN the prompts byte-match the committed goldens

#### Scenario: Dialog prompt variant pinned

- GIVEN the `awaiting_category` dialog prompt variant with few-shots
- WHEN the golden snapshot test runs
- THEN the variant byte-matches its committed golden

#### Scenario: Prompt changes regenerate goldens in-cycle

- GIVEN the prompts change to remove `planned` teaching and teach the fallback role, the delete-confirmation gate, and the closed-set category rule
- WHEN the change is implemented and tests run
- THEN all pinned golden snapshots in `bot-brain.test.ts` are regenerated in the same change and CI passes

#### Scenario: Planned-query prompt instruction pinned

- GIVEN the interpret system prompt teaches planned-query phrasings
- WHEN the golden snapshot test runs
- THEN the prompt byte-matches the committed golden

#### Scenario: No-planned-inference and delete-gate teaching pinned

- GIVEN the interpret system prompt teaches that the brain never infers the planned type and that deletes always confirm
- WHEN the golden snapshot test runs
- THEN the prompt byte-matches the committed golden

#### Scenario: Greeting and collection teaching pinned

- GIVEN the interpret system prompt teaches `greeting` and the `awaiting_registration` dialog
- WHEN the golden snapshot test runs
- THEN the prompt byte-matches the committed golden

#### Scenario: Category-resolution hint and lifecycle teaching pinned

- GIVEN the interpret system prompt teaches the category-resolution hint and the `mark_paid`/`delete_expense` intents
- WHEN the golden snapshot test runs
- THEN the prompt byte-matches the committed golden

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

The brain MUST classify a dialog-state message with `dialog_action` in its envelope: `resolve` when the message answers the open question (an exact category name for `awaiting_category`, a presented amount for `awaiting_amount_confirmation`, an amount or a category name for `awaiting_registration` per the open field), `abandon` when the message explicitly abandons the dialog, and `null` otherwise. A `resolve` classification MUST NOT invent amounts or categories beyond the message's own content — the controller acts ONLY on the persisted payload. A bare affirmation ("si") that matches no presented value MUST NOT classify as `resolve`.

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

#### Scenario: Resolve classified for a collection amount answer

- GIVEN an owner in `awaiting_registration` asked for the amount
- WHEN the message is "5000"
- THEN the envelope carries `dialog_action: "resolve"` with amount 5000

#### Scenario: Resolve classified for a collection category answer

- GIVEN an owner in `awaiting_registration` asked for the category
- WHEN the message is "Transporte"
- THEN the envelope carries `dialog_action: "resolve"` with the category answer

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

