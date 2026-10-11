# Delta for Bot Brain

## MODIFIED Requirements

### Requirement: Interpret Envelope Contract

The brain MUST validate the LLM JSON with a zod schema `{intent, amount, category, note, dialog_action, then_reassign}` where `intent` is one of `register_expense`, `correct_amount`, `correct_category`, `query`, `query_recent`, `query_balance`, `query_month`, `query_planned`, `create_category`, `delete_category`, `rename_category`, `associate_keyword`, `create_savings_rule`, `capabilities`, `help`, `off_topic`; `amount` accepts number or string and normalizes via `normalizeAmountString` to a positive finite number or `null`; `category` is a trimmed string of at most 60 chars or `null`; `note` is a trimmed string of at most 200 chars or `null`; `dialog_action` is one of `resolve`, `abandon`, or `null`; `then_reassign` is a boolean flag used only with `create_category`. The call MUST use `temperature: 0` and `response_format: json_object`. A `register_expense` envelope with a non-null amount MUST satisfy `amount > 0` and finite.
(Previously: the intent taxonomy had no `query_planned`.)

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

### Requirement: Reply-After-Action Contract

The brain's `reply` MUST receive ONLY the executed result — `{intent, ok, action, amount, category, note, gross_amount, net_amount, savings_amount, planned_month, planned_total}` with `action` one of `registered | asked_amount | asked_category | redirected | none` — and MUST produce a reply asserting nothing absent from that result. When a savings split applied, `gross_amount`, `net_amount`, and `savings_amount` MUST carry the executed facts and the reply MUST confirm the split. A planned-query result MUST carry `planned_month` and `planned_total`, and the reply MUST confirm the next-month planned total from those facts. The reply MUST be warm voseo, at most 2 sentences, with no markdown. A reply failure or `null` MUST leave the caller on the fixed `reply-text.ts` template carrying the same facts.
(Previously: the executed result carried no planned facts.)

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

### Requirement: Intent Taxonomy

`register_expense` MUST drive the executed registration flow (amount, category suggestion, note). `query`, `query_recent`, `query_balance`, `query_month`, and `query_planned` MUST be classified for deterministic execution — the query executor exists and answers from real data, and the planned executor answers the owner's next-month planned total (see planned-fixed-expenses). `associate_keyword` MUST redirect to the explicit `asociar palabra` command. `create_savings_rule` MUST redirect to the explicit `registrar ahorro: <palabra> al <X>%` command (`associate_keyword` precedent). `help` MUST produce help. `off_topic` MUST produce an expense-scoped redirect and MUST NEVER be answered as general chat. Messages carrying an expense signal (expense verb, `$`, or an amount token) MUST be biased to `register_expense` even when the amount is missing. `correct_category` MUST drive the movement-correction flow (matcher + reassign, see movement-correction). `correct_amount` MUST be accepted by the schema but stays reserved in `idle`; in dialog states the `dialog_action` field routes the message.
(Previously: the taxonomy had no planned-query classification.)

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

#### Scenario: Savings-rule intent redirects to the command

- GIVEN an envelope with `intent:"create_savings_rule"`
- WHEN the bot processes it
- THEN the bot redirects to the explicit `registrar ahorro: <palabra> al <X>%` command and executes nothing itself

#### Scenario: Planned query intent executes real data

- GIVEN an envelope with `intent:"query_planned"`
- WHEN the bot processes it
- THEN the deterministic executor answers with the owner's next-month planned total

### Requirement: Prompt Contract (category-blind, dialog-aware)

The `interpret` system prompt MUST be category-blind — it MUST NOT embed owner category names. The prompt MUST accept and embed the dialog context (state, pending payload, open-question text) when provided, and MUST include per-dialog few-shots so dialog answers classify reliably. The prompt MUST instruct: strict JSON only, never invent an amount, ARS normalization rules, category is a suggestion, off-topic never answered as chat, expense-signal bias, `dialog_action` semantics, and planned-query phrasings ("previsto", "gastos fijos previstos", "cuánto voy a gastar el mes que viene") classifying as `query_planned`. Both prompts (interpret and reply) and their dialog variants MUST be pinned by golden snapshot tests so prompt drift fails CI. When the prompts change to teach `create_savings_rule`, split-reply facts, and the `planned` query, the 8 pinned golden snapshots in `bot-brain.test.ts` MUST be regenerated in the same change so CI stays green.
(Previously: the prompt had no planned-query instruction.)

#### Scenario: Prompt drift fails CI

- GIVEN the interpret and reply system prompts
- WHEN the golden snapshot test runs
- THEN the prompts byte-match the committed goldens

#### Scenario: Dialog prompt variant pinned

- GIVEN the `awaiting_category` dialog prompt variant with few-shots
- WHEN the golden snapshot test runs
- THEN the variant byte-matches its committed golden

#### Scenario: Prompt changes regenerate goldens in-cycle

- GIVEN the prompts change to add `create_savings_rule`, split-reply facts, and the `planned` query
- WHEN the change is implemented and tests run
- THEN all 8 golden snapshots in `bot-brain.test.ts` are regenerated in the same change and CI passes

#### Scenario: Planned-query prompt instruction pinned

- GIVEN the interpret system prompt teaches planned-query phrasings
- WHEN the golden snapshot test runs
- THEN the prompt byte-matches the committed golden