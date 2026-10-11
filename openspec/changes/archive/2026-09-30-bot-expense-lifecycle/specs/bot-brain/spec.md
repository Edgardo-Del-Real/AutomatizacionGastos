# Delta for Bot Brain

## MODIFIED Requirements

### Requirement: Interpret Envelope Contract

The brain MUST validate the LLM JSON with a zod schema `{intent, amount, category, note, dialog_action, then_reassign, planned}` where `intent` is one of `register_expense`, `correct_amount`, `correct_category`, `query`, `query_recent`, `query_balance`, `query_month`, `query_planned`, `create_category`, `delete_category`, `rename_category`, `associate_keyword`, `create_savings_rule`, `mark_paid`, `delete_expense`, `capabilities`, `help`, `off_topic`, `greeting`; `amount` accepts number or string and normalizes via `normalizeAmountString` to a positive finite number or `null`; `category` is a trimmed string of at most 60 chars or `null`; `note` is a trimmed string of at most 200 chars or `null`; `dialog_action` is one of `resolve`, `abandon`, or `null`; `then_reassign` is a boolean flag used only with `create_category`; `planned` is a boolean flag used only with `register_expense` (mirror of `shared`). A `planned` registration is never shared: the bot MUST persist a PENDING expense as `INDIVIDUAL` even when the envelope also carries `shared: true`. The call MUST use `temperature: 0` and `response_format: json_object`. A `register_expense` envelope with a non-null amount MUST satisfy `amount > 0` and finite. A `register_expense` envelope with `amount: null` MUST remain valid — it drives the `awaiting_registration` collection entry. A `mark_paid` or `delete_expense` envelope MUST carry its reference cues in `category` and/or `amount` and MUST NOT carry a movement id — the bot resolves the target deterministically against real data.
(Previously: the schema accepted no `mark_paid` or `delete_expense` intents.)

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

### Requirement: Intent Taxonomy

`register_expense` MUST drive the executed registration flow (amount, category suggestion, note) — with `amount: null` entering the `awaiting_registration` collection dialog (see registration-collection) instead of dead-ending. `query`, `query_recent`, `query_balance`, `query_month`, and `query_planned` MUST be classified for deterministic execution — the query executor exists and answers from real data, and the planned executor answers the owner's next-month planned total (see planned-fixed-expenses). `associate_keyword` MUST redirect to the explicit `asociar palabra` command. `create_savings_rule` MUST redirect to the explicit `registrar ahorro: <palabra> al <X>%` command (`associate_keyword` precedent). `help` MUST produce help. `off_topic` MUST produce an expense-scoped redirect and MUST NEVER be answered as general chat. `greeting` MUST produce a warm expense-scoped greeting and MUST NOT close any open dialog — this deliberately REVERSES the previous "off_topic never chats" contract for greeting-classified messages only; `off_topic` remains strictly redirect-only. Messages carrying an expense signal (expense verb, `$`, or an amount token) MUST be biased to `register_expense` even when the amount is missing. `correct_category` MUST drive the movement-correction flow (matcher + reassign, see movement-correction). `correct_amount` MUST be accepted by the schema but stays reserved in `idle`; in dialog states the `dialog_action` field routes the message. `mark_paid` MUST drive the movement-lifecycle executor to transition a referenced PENDING EXPENSE to PAID through `MovementService.markMovementPaid`, and `delete_expense` MUST drive it to delete a referenced expense through `ExpenseService.deleteExpense` (see bot-expense-lifecycle); neither intent MUST create a category or register a movement.
(Previously: the taxonomy had no planned-query classification, no `greeting` intent, and no lifecycle intents; every non-expense signal including "hola" fell to `off_topic` and was never answered as chat.)

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

#### Scenario: Delete-expense intent activates the lifecycle executor

- GIVEN an envelope with `intent:"delete_expense"` carrying an amount reference
- WHEN the bot processes it
- THEN the movement-lifecycle executor deletes the referenced expense and replies once

### Requirement: Category Suggestion Contract

The brain MAY return a category suggestion and MAY set the `planned` flag. Neither MUST create, imply, or auto-create anything: the bot MUST resolve the category against the owner's category list exact-first via `normalizeForMatch` and then via the tolerant plural fold (`normalizeForMatchTolerant`), so folded variants such as "cafes"→"Cafe" and "Otros"→"otro" resolve; a suggestion that folds to "otro" MUST be treated as no suggestion, and any unresolved suggestion MUST fall back to "otro"; the `planned` flag is materialized only by the deterministic guarded registration path, never by the brain. A planned registration is always INDIVIDUAL: when the envelope carries both `planned: true` and `shared: true`, the bot MUST persist the PENDING expense as `INDIVIDUAL` (planned wins).
(Previously: resolution was exact `normalizeForMatch` comparison only; "Otros" never resolved to "otro" on the idle path.)

#### Scenario: Suggestion is a suggestion only

- GIVEN an LLM category suggestion
- WHEN the bot resolves it against the owner's categories
- THEN it is used only on resolution, else the movement falls to "otro"

#### Scenario: Folded suggestion resolves

- GIVEN the brain suggests "Otros" and the owner has the "otro" category
- WHEN the bot resolves the suggestion
- THEN it resolves to "otro" and no phantom category is created

#### Scenario: Planned flag is a suggestion only

- GIVEN an envelope with `planned: true` and no `previsto:` prefix
- WHEN the registration is materialized
- THEN PENDING results only through the deterministic guarded path and the brain creates no category or status

#### Scenario: Planned registration is never shared

- GIVEN an envelope carrying both `planned: true` and `shared: true`
- WHEN the registration is materialized
- THEN the PENDING expense persists as `INDIVIDUAL` (the shared signal is discarded)

### Requirement: Prompt Contract (category-blind, dialog-aware)

The `interpret` system prompt MUST be category-blind — it MUST NOT embed owner category names. The prompt MUST accept and embed the dialog context (state, pending payload, open-question text) when provided, and MUST include per-dialog few-shots so dialog answers classify reliably. The prompt MUST instruct: strict JSON only, never invent an amount, ARS normalization rules, category is a suggestion, off-topic never answered as chat, greeting classified as `greeting` (warm reply; dialogs stay open), expense-signal bias, `dialog_action` semantics, planned-query phrasings ("previsto", "gastos fijos previstos", "cuánto voy a gastar el mes que viene") classifying as `query_planned`, conversational planned phrasings ("dejalo para el mes que viene", "lo pago el mes que viene") setting `planned: true` on `register_expense`, the `previsto:` prefix being authoritative, and the brain never creating categories or planned status. The prompt MUST also include a sentence stating that category suggestions resolve against the owner's categories and that "otro" is the fallback category, and MUST teach the `mark_paid` and `delete_expense` intents (with few-shots) so conversational lifecycle phrasings ("ya lo pagué", "pásalo a pagado", "borra ese gasto") classify to them. The prompt MUST also teach the `awaiting_registration` dialog: `resolve` when the message answers the open field (an amount for the amount question, a category name for the category question), `abandon` on explicit outs, `null` otherwise — and MUST teach that `register_expense` with `amount: null` starts collection rather than dead-ending. Both prompts (interpret and reply) and their dialog variants MUST be pinned by golden snapshot tests so prompt drift fails CI. When the prompts change to teach the `planned` flag, `greeting`, the `awaiting_registration` dialog (alongside `create_savings_rule`, split-reply facts, the `planned` query, the category-resolution hint, and the lifecycle intents), the pinned golden snapshots in `bot-brain.test.ts` MUST be regenerated in the same change so CI stays green.
(Previously: the prompt had no planned-query instruction, no planned-flag teaching, no `greeting` classification, no `awaiting_registration` dialog teaching, and no category-resolution hint or lifecycle intent teaching.)

#### Scenario: Prompt drift fails CI

- GIVEN the interpret and reply system prompts
- WHEN the golden snapshot test runs
- THEN the prompts byte-match the committed goldens

#### Scenario: Dialog prompt variant pinned

- GIVEN the `awaiting_category` dialog prompt variant with few-shots
- WHEN the golden snapshot test runs
- THEN the variant byte-matches its committed golden

#### Scenario: Prompt changes regenerate goldens in-cycle

- GIVEN the prompts change to teach `planned`, `greeting`, the `awaiting_registration` dialog, the category-resolution hint, and the lifecycle intents
- WHEN the change is implemented and tests run
- THEN all pinned golden snapshots in `bot-brain.test.ts` are regenerated in the same change and CI passes

#### Scenario: Planned-query prompt instruction pinned

- GIVEN the interpret system prompt teaches planned-query phrasings
- WHEN the golden snapshot test runs
- THEN the prompt byte-matches the committed golden

#### Scenario: Planned-flag prompt instruction pinned

- GIVEN the interpret system prompt teaches conversational planned phrasing and the `planned` flag
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