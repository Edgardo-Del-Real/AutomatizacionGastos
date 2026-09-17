# Delta for Telegram Bot

## ADDED Requirements

### Requirement: Intent-First Message Handling

For every non-command owner message in `idle`, the system MUST invoke the bot brain's `interpret` before deterministic execution and MUST route on the returned intent: `register_expense` runs the existing registration flow (with the brain's amount/category/note); `query_recent`/`query_balance`/`query_month` reply with an honest not-supported redirect; `associate_keyword` redirects to the `asociar palabra` command; `help` replies with help; `off_topic` replies with an expense-scoped redirect and MUST NOT be answered as general chat; `correct_amount`/`correct_category` are reserved and reply with deterministic help in `idle`. The setup gate (owner with no categories) MUST take precedence over `interpret`: such messages go straight to `awaiting_setup` with no brain call. The state machine MUST remain authoritative — the LLM MUST never decide state transitions. `interpret` MUST NOT be invoked for commands, the setup flow, or dialog-state messages (`awaiting_setup`, `awaiting_category`, `awaiting_amount_confirmation`), whose classification stays deterministic. When `interpret` returns `null`, the system MUST behave exactly as today.

#### Scenario: Register intent runs the existing flow

- GIVEN a brain envelope `{intent:"register_expense", amount:5000, category:"Supermercado", note:"gaste en el super"}`
- WHEN the message is processed in `idle`
- THEN the registration flow runs with amount 5000 and category "Supermercado"

#### Scenario: Keyword rule beats the brain suggestion

- GIVEN owner text matching a user-authored keyword rule and a brain category suggestion
- WHEN the message is processed
- THEN the movement registers with the matched keyword category and the brain suggestion is ignored

#### Scenario: Query intent redirects honestly

- GIVEN owner text "cuánto gasté" classified `query_balance`
- WHEN the message is processed
- THEN no movement is created and the reply says balance queries are not supported yet

#### Scenario: Off-topic redirects

- GIVEN owner text classified `off_topic`
- WHEN the message is processed
- THEN the reply is an expense-scoped redirect and no movement is created

#### Scenario: Setup gate precedes the brain

- GIVEN an owner with no categories sends "$2500 cafe"
- WHEN the message is processed
- THEN the owner enters `awaiting_setup` and `interpret` is not invoked

#### Scenario: Brain null behaves as today

- GIVEN `GROQ_API_KEY` unset or a brain result of `null`
- WHEN a message is processed in `idle`
- THEN the behavior is identical to today (deterministic parse, otro + correction, or help)

#### Scenario: Dialog answers stay deterministic

- GIVEN a message in `awaiting_category` or `awaiting_amount_confirmation`
- WHEN it is processed
- THEN classification uses the deterministic rules and `interpret` is not invoked

### Requirement: LLM Branch Replies with Fixed Fallback

For conversational outcomes — registration success, correction offer/done, otro kept, category not found, amount conflict, amount-confirmation abandonment, help, and redirects — the system MUST invoke the brain's `reply` with the executed result ONLY and MUST send the returned text verbatim. The `reply` call MUST be skipped for commands and the setup flow. When the brain is absent, `reply` returns `null`, or the reply fails, the system MUST send the fixed `reply-text.ts` template carrying the same executed facts.

#### Scenario: Reply sent verbatim

- GIVEN a registered movement with executed facts and a brain reply string
- WHEN the outcome is a registration success
- THEN the brain reply string is sent verbatim to the owner

#### Scenario: Reply failure falls back fixed

- GIVEN the brain returns `null` for `reply`
- WHEN the outcome is a registration success
- THEN the fixed success template with the same amount, note, and category is sent

#### Scenario: Commands and setup skip the reply call

- GIVEN a command or a setup-flow message
- WHEN it is processed
- THEN the brain's `reply` is not invoked

## MODIFIED Requirements

### Requirement: Movement Parsing, Classification and Categorization

The system MUST reuse the shared parser for amount/note extraction and MUST classify `INCOME`/`EXPENSE` per the existing deterministic rules. Categorization MUST be deterministic-first: the shared category matcher runs before the bot brain, and user-authored keyword rules MUST beat brain suggestions. The bot brain MUST be invoked for every non-command `idle` message (see Intent-First Message Handling); on a keyword miss it supplies the category suggestion and participates in the amount rules below. A brain-suggested category MUST be used only when it exactly matches an owner category via `normalizeForMatch`; otherwise the movement MUST be created in "otro" and the existing `awaiting_category` correction MUST follow — the brain MUST NEVER auto-create categories. The deterministic amount MUST be authoritative: when the deterministic amount is absent but the brain returns a valid amount, the system MUST register the movement directly with the brain amount. When both amounts exist and differ, the system MUST NOT register anything silently and MUST ask the owner which amount is correct (see Amount-Conflict Question) — EXCEPT the "mil" stance: when the deterministic amount is a bare integer token and the message contains a prose-number word ("mil", "k", or a Spanish number word such as "quinientos", "doscientos", "cien"), the brain amount MUST win directly with NO conflict question. Note precedence: the deterministic note MUST win; the brain note MUST be used only when the deterministic note is absent (gap rescue); the system MUST NOT conflict-ask about notes. When the brain is unavailable or returns `null`, the system MUST behave exactly as today: a keyword miss falls to "otro" + correction, and a message with no parseable amount is replied to with help text.
(Previously: the note interpreter was invoked only on a keyword miss or amount-parse failure and never on a keyword match; both amounts differing always asked the owner; no note precedence rule existed.)

#### Scenario: Keyword classification

- GIVEN owner text "Recibí $50000 de sueldo"
- WHEN the message is processed
- THEN an `INCOME` movement is created
- AND it is assigned a matched category when one applies, else "otro"

#### Scenario: Matched keyword rule wins over the brain suggestion

- GIVEN owner text matching a user-authored keyword rule
- WHEN the message is processed
- THEN the movement registers with the matched category
- AND the brain category suggestion is ignored

#### Scenario: Keyword miss with resolvable brain category

- GIVEN owner text matching no keyword rule and a brain suggestion that exactly matches an owner category
- WHEN the message is processed
- THEN a movement registers with the brain category and a success reply is sent
- AND no correction round-trip occurs

#### Scenario: Keyword miss with unknown brain category

- GIVEN owner text matching no keyword rule and a brain suggestion not in the owner's category list
- WHEN the message is processed
- THEN the movement registers in "otro"
- AND the `awaiting_category` correction is offered
- AND no category is auto-created

#### Scenario: Amount rescued by the brain

- GIVEN owner text "compre mercaderia" with no deterministic amount and a brain amount of 5000
- WHEN the message is processed
- THEN a movement registers directly with amount 5000 and a success reply is sent

#### Scenario: No amount and brain null

- GIVEN owner text with no deterministic amount and a brain result of `null`
- WHEN the message is processed
- THEN no movement is created
- AND a help reply is sent

#### Scenario: Conflicting amounts ask the owner

- GIVEN a deterministic amount of 5000 and a brain amount of 4800 on a keyword miss with no prose-number word
- WHEN the message is processed
- THEN no movement is registered
- AND the bot asks which amount is correct

#### Scenario: "5 mil" stance registers the brain amount

- GIVEN owner text "gaste 5 mil en el super" (bare digit 5, prose "mil") and a brain amount of 5000
- WHEN the message is processed
- THEN a movement registers directly with 5000
- AND no conflict question is asked and no `awaiting_amount_confirmation` state is entered

#### Scenario: Deterministic note wins over the brain note

- GIVEN a deterministic note "cafe" and a brain note "cafe con leche"
- WHEN the message is processed
- THEN the movement registers with the deterministic note "cafe"

#### Scenario: Brain note fills the gap

- GIVEN no deterministic note and a brain note "mercaderia"
- WHEN the message is processed
- THEN the movement registers with the brain note "mercaderia"

#### Scenario: No brain configured degrades to today

- GIVEN `GROQ_API_KEY` is unset
- WHEN a keyword-miss or amountless message is processed
- THEN the behavior is identical to today (otro + correction, or help reply)

### Requirement: Success and Help Reply Content

The system MUST reply to a successfully registered movement with a confirmation that includes the amount, the note, and the assigned category; the confirmation MUST be the brain's `reply` text when the brain is available and returns one, and MUST fall back to the fixed success template carrying the same facts. The system MUST reply to an unparseable message with help text (brain-written or fixed). The system MUST reply to off-topic and query messages with expense-scoped redirects — never as general chat and never as executed queries. A reply MUST NOT be sent for non-owner, edited, empty, or deduplicated messages.
(Previously: success, help, and all other replies were fixed `reply-text.ts` templates only; no redirect replies existed.)

#### Scenario: Success confirmation

- GIVEN an owner registers "$2500 cafe"
- WHEN the movement is created
- THEN a confirmation with amount, note, and category is sent (brain-written from the executed result or the fixed template)

#### Scenario: Unparseable gets help

- GIVEN owner text with no parseable amount and a brain result of `null`
- WHEN the message is processed
- THEN a help reply is sent and no movement is created

#### Scenario: Off-topic gets a redirect, never a chat answer

- GIVEN an owner message classified `off_topic`
- WHEN the message is processed
- THEN an expense-scoped redirect reply is sent
- AND no movement is created and no general-chat answer is produced

#### Scenario: Query gets an honest redirect

- GIVEN an owner message classified `query_recent`
- WHEN the message is processed
- THEN a redirect stating the query is not supported yet is sent

## Pre-Existing Drift (informational)

- Canonical `note-interpretation` "Amount Precedence and Product Rules" says "When only the deterministic amount exists, the interpreter amount MUST be ignored"; the implementation compares the amounts (equal → proceed, differ → conflict). Superseded by this change's bot-brain migration.
- Canonical `telegram-bot` "Movement Parsing, Classification and Categorization" still names "the note interpreter"; this delta migrates the surface to the bot brain.