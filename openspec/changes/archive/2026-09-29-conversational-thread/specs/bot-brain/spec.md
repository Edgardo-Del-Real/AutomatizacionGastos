# Delta for bot-brain

## MODIFIED Requirements

### Requirement: Interpret Envelope Contract

The brain MUST validate the LLM JSON with a zod schema `{intent, amount, category, note, dialog_action, then_reassign, planned}` where `intent` is one of `register_expense`, `correct_amount`, `correct_category`, `query`, `query_recent`, `query_balance`, `query_month`, `query_planned`, `create_category`, `delete_category`, `rename_category`, `associate_keyword`, `create_savings_rule`, `capabilities`, `help`, `off_topic`, `greeting`; `amount` accepts number or string and normalizes via `normalizeAmountString` to a positive finite number or `null`; `category` is a trimmed string of at most 60 chars or `null`; `note` is a trimmed string of at most 200 chars or `null`; `dialog_action` is one of `resolve`, `abandon`, or `null`; `then_reassign` is a boolean flag used only with `create_category`; `planned` is a boolean flag used only with `register_expense` (mirror of `shared`). A `planned` registration is never shared: the bot MUST persist a PENDING expense as `INDIVIDUAL` even when the envelope also carries `shared: true`. The call MUST use `temperature: 0` and `response_format: json_object`. A `register_expense` envelope with a non-null amount MUST satisfy `amount > 0` and finite. A `register_expense` envelope with `amount: null` MUST remain valid — it drives the `awaiting_registration` collection entry.
(Previously: the schema had no `planned` field and no `greeting` intent; a null-amount `register_expense` was valid but dead-ended with no collection entry.)

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

`register_expense` MUST drive the executed registration flow (amount, category suggestion, note) — with `amount: null` entering the `awaiting_registration` collection dialog (see registration-collection) instead of dead-ending. `query`, `query_recent`, `query_balance`, `query_month`, and `query_planned` MUST be classified for deterministic execution — the query executor exists and answers from real data, and the planned executor answers the owner's next-month planned total (see planned-fixed-expenses). `associate_keyword` MUST redirect to the explicit `asociar palabra` command. `create_savings_rule` MUST redirect to the explicit `registrar ahorro: <palabra> al <X>%` command (`associate_keyword` precedent). `help` MUST produce help. `off_topic` MUST produce an expense-scoped redirect and MUST NEVER be answered as general chat. `greeting` MUST produce a warm expense-scoped greeting and MUST NOT close any open dialog — this deliberately REVERSES the previous "off_topic never chats" contract for greeting-classified messages only; `off_topic` remains strictly redirect-only. Messages carrying an expense signal (expense verb, `$`, or an amount token) MUST be biased to `register_expense` even when the amount is missing. `correct_category` MUST drive the movement-correction flow (matcher + reassign, see movement-correction). `correct_amount` MUST be accepted by the schema but stays reserved in `idle`; in dialog states the `dialog_action` field routes the message.
(Previously: the taxonomy had no planned-query classification and no `greeting` intent; every non-expense signal including "hola" fell to `off_topic` and was never answered as chat.)

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

### Requirement: Prompt Contract (category-blind, dialog-aware)

The `interpret` system prompt MUST be category-blind — it MUST NOT embed owner category names. The prompt MUST accept and embed the dialog context (state, pending payload, open-question text) when provided, and MUST include per-dialog few-shots so dialog answers classify reliably. The prompt MUST instruct: strict JSON only, never invent an amount, ARS normalization rules, category is a suggestion, off-topic never answered as chat, greeting classified as `greeting` (warm reply; dialogs stay open), expense-signal bias, `dialog_action` semantics, planned-query phrasings ("previsto", "gastos fijos previstos", "cuánto voy a gastar el mes que viene") classifying as `query_planned`, conversational planned phrasings ("dejalo para el mes que viene", "lo pago el mes que viene") setting `planned: true` on `register_expense`, the `previsto:` prefix being authoritative, and the brain never creating categories or planned status. The prompt MUST also teach the `awaiting_registration` dialog: `resolve` when the message answers the open field (an amount for the amount question, a category name for the category question), `abandon` on explicit outs, `null` otherwise — and MUST teach that `register_expense` with `amount: null` starts collection rather than dead-ending. Both prompts (interpret and reply) and their dialog variants MUST be pinned by golden snapshot tests so prompt drift fails CI. When the prompts change to teach the `planned` flag, `greeting`, and the `awaiting_registration` dialog (alongside `create_savings_rule`, split-reply facts, and the `planned` query), the pinned golden snapshots in `bot-brain.test.ts` MUST be regenerated in the same change so CI stays green.
(Previously: the prompt had no planned-query instruction, no planned-flag teaching, no `greeting` classification, and no `awaiting_registration` dialog teaching.)

#### Scenario: Prompt drift fails CI

- GIVEN the interpret and reply system prompts
- WHEN the golden snapshot test runs
- THEN the prompts byte-match the committed goldens

#### Scenario: Dialog prompt variant pinned

- GIVEN the `awaiting_category` dialog prompt variant with few-shots
- WHEN the golden snapshot test runs
- THEN the variant byte-matches its committed golden

#### Scenario: Prompt changes regenerate goldens in-cycle

- GIVEN the prompts change to teach `planned`, `greeting`, and the `awaiting_registration` dialog
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