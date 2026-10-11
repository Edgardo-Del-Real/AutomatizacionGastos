# Delta for Bot Brain

## MODIFIED Requirements

### Requirement: Bot Brain Port

The system MUST expose a `BotBrain` port with `interpret(message: string, context?: InterpretContext): Promise<ConversationEnvelope | null>` and `reply(executionResult: ExecutionResult): Promise<string | null>`, where `ConversationEnvelope` carries an intent and optional `amount`/`note`, `InterpretContext` carries the owner context, and `ExecutionResult` carries ONLY the executed facts. The port MUST be the only LLM surface the bot consumes and MUST be implemented by the Groq client (reusing the transport from the previous interpreter). The port MUST be used ONLY for idle query/greeting classification and query replies — never for capture or editing.
(Previously: the envelope carried intent, amount, category suggestion, note, `dialog_action`, `then_reassign`, and `planned`, and the port drove capture and editing fallbacks.)

#### Scenario: Valid interpretation

- GIVEN a conversational message and a Groq response that passes validation
- WHEN `interpret(message)` is invoked
- THEN a `ConversationEnvelope` with a query/greeting/off_topic intent is returned

#### Scenario: Missing key means no brain

- GIVEN `GROQ_API_KEY` is unset
- WHEN the bot is constructed
- THEN no brain is constructed and `interpret`/`reply` are never invoked

### Requirement: Interpret Envelope Contract

The brain MUST validate the LLM JSON with a zod schema `{intent, amount, note}` where `intent` is one of `query`, `query_recent`, `query_balance`, `query_month`, `query_planned`, `greeting`, `off_topic`, `help`; `amount` accepts number or string and normalizes via `normalizeAmountString` to a positive finite number or `null`; `note` is a trimmed string of at most 200 chars or `null`. The schema MUST NOT accept `register_expense`, `correct_category`, `create_category`, `mark_paid`, `delete_expense`, `dialog_action`, `shared`, `planned`, or `then_reassign` — a response carrying any of them MUST degrade to `null`. The call MUST use `temperature: 0` and `response_format: json_object`.
(Previously: the schema accepted 18 intents including registration, correction, lifecycle, category CRUD, and savings-rule creation, plus `dialog_action`, `then_reassign`, and `shared`.)

#### Scenario: Envelope decodes strict JSON

- GIVEN a Groq response `{"intent":"query_balance"}`
- WHEN the payload is validated
- THEN intent is `query_balance`

#### Scenario: Unknown intent degrades

- GIVEN a Groq response whose intent is not in the taxonomy
- WHEN the payload is validated
- THEN `null` is returned

#### Scenario: Capture intent degrades

- GIVEN a Groq response `{"intent":"register_expense","amount":2500,"category":"Cafe"}`
- WHEN the payload is validated
- THEN `null` is returned and the deterministic idle routing applies

#### Scenario: Planned field rejected

- GIVEN a Groq response `{"intent":"register_expense","amount":2500,"planned":true}`
- WHEN the payload is validated
- THEN `null` is returned

#### Scenario: Greeting intent decodes

- GIVEN a Groq response `{"intent":"greeting"}`
- WHEN the payload is validated
- THEN the envelope carries intent `greeting`

### Requirement: Reply-After-Action Contract

The brain's `reply` MUST receive ONLY the executed result — `{intent, ok, action, ...query facts}` — and MUST produce a reply asserting nothing absent from that result. A greeting result MUST produce a warm, expense-scoped greeting. A query result MUST produce the answer from the executed query facts. The reply MUST be warm voseo, at most 2 sentences, with no markdown. A reply failure or `null` MUST leave the caller on the fixed `reply-text.ts` template carrying the same facts.
(Previously: the executed result carried registration, savings-split, planned-query, and collection-question facts.)

#### Scenario: Query reply reflects only executed facts

- GIVEN an execution result `{intent:"query_balance", ok:true, action:"answered", balance:600}`
- WHEN `reply(result)` is invoked
- THEN the reply confirms the balance and contains no fact absent from the result

#### Scenario: Greeting reply is warm and short

- GIVEN a greeting execution result
- WHEN `reply(result)` is invoked
- THEN the reply is a warm expense-scoped greeting of at most 2 sentences

### Requirement: Intent Taxonomy

`query`, `query_recent`, `query_balance`, `query_month`, and `query_planned` MUST be classified for deterministic execution — the query executor answers from real data (see bot-reports-menu). `greeting` MUST produce a warm expense-scoped greeting followed by the menu and MUST NOT start or modify any flow. `off_topic` MUST produce the deterministic "no puedo resolver eso" reply plus the menu. `help` MUST produce the static help. The taxonomy is the three-intent classification surface (query vs greeting vs off_topic); capture-shaped text and legacy prefixes are handled deterministically BEFORE the brain (see bot-free-text-routing). The brain MUST NEVER register, correct, mark paid, delete, or create categories — those flows are button-driven and LLM-free.
(Previously: the taxonomy included register_expense, correct_category, correct_amount, category CRUD, associate_keyword, create_savings_rule, mark_paid, delete_expense, and capabilities, with expense-signal bias toward register_expense.)

#### Scenario: Query intent executes real data

- GIVEN an envelope with `intent:"query_recent"`
- WHEN the bot processes it
- THEN the deterministic query executor answers with the owner's real movements

#### Scenario: Off-topic gets the fallback plus menu

- GIVEN an envelope with `intent:"off_topic"`
- WHEN the bot processes it
- THEN "no puedo resolver eso" replies, no movement is created, and the menu follows

#### Scenario: Greeting replies warm and shows the menu

- GIVEN an envelope with `intent:"greeting"`
- WHEN the bot processes it
- THEN a warm greeting replies followed by the main menu

#### Scenario: Brain never drives editing flows

- GIVEN any envelope
- WHEN the bot processes it
- THEN no movement is registered, corrected, marked paid, or deleted by the brain

### Requirement: Prompt Contract (three-intent)

The `interpret` system prompt MUST teach the three-intent taxonomy only: query (with query-type phrasings), greeting, and off_topic. The prompt MUST instruct: strict JSON only, never invent amounts, off-topic never answered as general chat, and the brain never creating categories, never inferring capture types, and never deciding destructive actions. The prompt MUST be pinned by golden snapshot tests so prompt drift fails CI. When the prompts are trimmed, all pinned golden snapshots MUST be regenerated in the same change.
(Previously: the prompt was category-blind and dialog-aware, teaching register/correct/lifecycle intents, dialog actions, planned phrasings, and the fallback-first framing.)

#### Scenario: Prompt drift fails CI

- GIVEN the interpret and reply system prompts
- WHEN the golden snapshot test runs
- THEN the prompts byte-match the committed goldens

#### Scenario: Prompt trimming regenerates goldens in-cycle

- GIVEN the prompts are trimmed to the three-intent taxonomy
- WHEN the change is implemented and tests run
- THEN all pinned golden snapshots are regenerated in the same change and CI passes

## REMOVED Requirements

### Requirement: Dialog Action Contract

(Reason: the dialog states are removed, so no `dialog_action` classification exists; flows are button-driven.)
(Migration: none — deterministic button chains replace dialog resolution.)

### Requirement: Shared Flag Contract

(Reason: the `shared` flag is gone from the envelope; shared captures use the 👥 Compartido menu button with type COMPARTIDO.)
(Migration: quick-capture Type Selection by Menu.)

### Requirement: Category Suggestion Contract

(Reason: the trimmed envelope carries no category field and capture/editing never use the LLM — suggestions no longer exist.)
(Migration: categories are button-chosen (see conversational-categories); the "LLM never creates" ceiling remains covered by the intent taxonomy and the Suggester Ceiling requirement.)