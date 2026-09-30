# Delta for Telegram Bot

## MODIFIED Requirements

### Requirement: Movement Parsing, Classification and Categorization

The system MUST reuse the shared parser for amount/note extraction and MUST classify `INCOME`/`EXPENSE` per the existing deterministic rules. Categorization MUST be deterministic-first: the shared category matcher runs before the bot brain, and user-authored keyword rules MUST beat brain suggestions. The bot brain MUST be invoked for every non-command `idle` message (see Intent-First Message Handling); on a keyword miss it supplies the category suggestion and participates in the amount rules below. A brain-suggested category MUST be used only when it resolves against an owner category — exact match via `normalizeForMatch` first, then the tolerant plural fold via `normalizeForMatchTolerant` (so "Otros"→"otro" and "cafes"→"Cafe" resolve). When the brain signals a category that does NOT resolve, the system MUST enter the registration-collection dialog (`awaiting_registration`) and ask the owner for the category with the amount persisted — the brain MUST NEVER auto-create categories and the movement MUST NOT register in "otro" on a non-resolving signaled category. When the brain signals no category (`null`), the movement falls to "otro" and the existing `awaiting_category` correction follows. The deterministic amount MUST be authoritative: when the deterministic amount is absent but the brain returns a valid amount, the system MUST register the movement directly with the brain amount. When both amounts exist and differ, the system MUST NOT register anything silently and MUST ask the owner which amount is correct (see Amount-Conflict Question) — EXCEPT the "mil" stance: when the deterministic amount is a bare integer token and the message contains a prose-number word ("mil", "k", or a Spanish number word such as "quinientos", "doscientos", "cien"), the brain amount MUST win directly with NO conflict question. Note precedence: the deterministic note MUST win; the brain note MUST be used only when the deterministic note is absent (gap rescue); the system MUST NOT conflict-ask about notes. When the brain is unavailable or returns `null`, the system MUST behave exactly as today: a keyword miss falls to "otro" + correction, and a message with no parseable amount is replied to with help text.
(Previously: the note interpreter was invoked only on a keyword miss or amount-parse failure and never on a keyword match; both amounts differing always asked the owner; no note precedence rule existed; brain-suggested categories matched exact `normalizeForMatch` only.)

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

- GIVEN owner text matching no keyword rule and a brain suggestion that resolves against an owner category
- WHEN the message is processed
- THEN a movement registers with the brain category and a success reply is sent
- AND no correction round-trip occurs

#### Scenario: Folded brain suggestion resolves

- GIVEN owner text "gaste en otros" with a brain suggestion "Otros" and an owner category "otro"
- WHEN the message is processed
- THEN the movement registers in "otro" and no correction round-trip occurs

#### Scenario: Keyword miss with unknown brain category

- GIVEN owner text matching no keyword rule and a brain suggestion not in the owner's category list
- WHEN the message is processed
- THEN the registration-collection dialog opens asking for the category with the amount persisted
- AND no category is auto-created
- AND the movement is NOT registered in "otro" without asking

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

### Requirement: Setup Flow (awaiting_setup)

When an owner with no categories sends a valid registration, the system MUST reply asking for their categories, enter the owner's `awaiting_setup` state, and treat the next non-empty text reply as the category list (newline- or comma-separated). Creating the listed categories MUST also create the "otro" fallback and MUST reply with a confirmation. A later re-run of `configurar categorias` MUST append new categories rather than overwrite. The `configurar categorias` question MUST list the owner's existing categories (dynamic listing, never fixed text). Before the plain category-list split, the setup reply MUST be parsed for batch commands — `borrar categoria: X`, `renombrar categoria: X a: Y`, and `registrar categoria: X` MUST execute through the guarded CategoryService operations and MUST NOT be created as literal categories; only remaining plain tokens become categories.
(Previously: the setup question was fixed text and every comma/newline token was created as a literal category, so batch commands like "borrar categoría: no" became phantom categories.)

#### Scenario: First registration triggers setup

- GIVEN an owner with no categories sends "$2500 cafe"
- WHEN it is processed
- THEN the owner enters `awaiting_setup`
- AND a message asking for categories is sent
- AND the registration is not persisted yet

#### Scenario: Reply creates categories

- GIVEN the owner is in `awaiting_setup`
- WHEN they reply "Cafe\nTransporte"
- THEN categories "Cafe" and "Transporte" and "otro" are created
- AND a confirmation is sent
- AND the owner returns to `idle`

#### Scenario: Re-run appends

- GIVEN an owner with categories in `idle`
- WHEN they run `configurar categorias`
- THEN the bot asks again, and a reply of "Salud" appends "Salud" without removing existing categories

#### Scenario: Setup question lists existing categories

- GIVEN an owner with categories runs `configurar categorias`
- WHEN the setup question is sent
- THEN it lists the existing category names instead of fixed text

#### Scenario: Batch delete executes, never creates a literal

- GIVEN an owner in `awaiting_setup` replies "borrar categoria: no"
- WHEN it is processed
- THEN the "no" category is deleted through the category service
- AND no literal "borrar categoria: no" category is created

### Requirement: Correction Loop (awaiting_category) and Learning

Dialog messages in `awaiting_category` MUST first route through the brain (see Dialog Controller): a `resolve` answer reassigns the pending movement; `null` intents (queries, CRUD) execute without consuming the pending; `register_expense` abandons the pending. When the brain is absent, returns `null`, or the envelope says `abandon`, the deterministic rules below apply verbatim: a reply whose normalized text exactly matches an existing category name is the ANSWER; a reply that parses as an amount is a NEW registration that abandons the pending correction; a single-token reply that is not an existing category MUST auto-create that category and apply it; any other multi-word reply MUST list the existing categories without closing the state. Before the single-token auto-create, the reply MUST be checked through the punctuation-stripped guard normalization (`normalizeForMatchGuard`): a reply that normalizes to a guard word ("no", "si", with or without punctuation) MUST route to the abandon/affirmation handling and MUST NOT auto-create a category. A valid answer MUST reassign the pending movement to that category and confirm. Correction answers MUST NOT learn keyword rules — keyword rules are created only through the explicit `asociar palabra` command.
(Previously: every `awaiting_category` message was classified by the deterministic rules alone; the brain was never involved.)
(Previously: corrections learned a keyword rule mapping the original note's first significant word to the answered category, and every non-answer text was treated as a new registration.)
(Previously: guard sets matched without punctuation stripping, so "no." fell through to the single-token auto-create and created a phantom category.)

#### Scenario: Unmatched triggers correction

- GIVEN an owner registration matches no rule
- WHEN it is created as "otro"
- THEN the owner enters `awaiting_category`
- AND the bot asks for the correct category

#### Scenario: Answer reassigns without learning

- GIVEN the owner is in `awaiting_category` for note "uber viaje"
- WHEN they reply "Transporte"
- THEN the pending movement is reassigned to "Transporte"
- AND no keyword rule is created

#### Scenario: Unknown single-token answer auto-creates the category only

- GIVEN the owner is in `awaiting_category`
- WHEN they reply "Mascotas" which is not an existing category
- THEN category "Mascotas" is auto-created and the pending movement is assigned to it
- AND no keyword rule is learned

#### Scenario: Punctuated guard never auto-creates

- GIVEN the owner is in `awaiting_category`
- WHEN they reply "no."
- THEN no category is created and the reply routes to the abandon handling

#### Scenario: Amount during awaiting_category is a new registration

- GIVEN the owner is in `awaiting_category`
- WHEN they send "$8000 supermercado"
- THEN it is treated as a new registration, not an answer, and the pending correction is abandoned
- AND processing follows the normal registration path

#### Scenario: Multi-word non-category answer lists categories

- GIVEN the owner is in `awaiting_category`
- WHEN they reply with a multi-word text that matches no category
- THEN the bot lists the existing categories and the state stays open
- AND the movement remains safely in "otro"

### Requirement: Intent-First Message Handling

For every non-command owner message in `idle`, the system MUST invoke the bot brain's `interpret` before deterministic execution and MUST route on the returned intent: `register_expense` runs the existing registration flow (with the brain's amount/category/note; a null amount enters `awaiting_registration` per registration-collection); `query`/`query_recent`/`query_balance`/`query_month` execute the deterministic query executor and answer from real data (an honest redirect replies only when the query fails or the type is unresolvable); `associate_keyword` redirects to the `asociar palabra` command; `help` replies with help; `off_topic` replies with an expense-scoped redirect and MUST NOT be answered as general chat; `greeting` replies with a warm expense-scoped greeting and MUST NOT close any open dialog; `correct_amount` is reserved and replies with deterministic help in `idle`; `correct_category` runs the movement-correction flow (see movement-correction); `mark_paid` runs the movement-lifecycle executor to transition a referenced PENDING EXPENSE to PAID, and `delete_expense` runs it to delete a referenced expense (see bot-expense-lifecycle) — lifecycle intents MUST NOT enter the registration path. The setup gate (owner with no categories) MUST take precedence over `interpret`: such messages go straight to `awaiting_setup` with no brain call. The state machine MUST remain authoritative — the LLM MUST never decide state transitions. `interpret` MUST NOT be invoked for commands or the setup flow; for dialog-state messages (`awaiting_category`, `awaiting_amount_confirmation`, `awaiting_registration`) it MUST be invoked with dialog context and the envelope's `dialog_action` routes the message (see Dialog Controller), with today's deterministic rules as the fallback when the brain is null/absent. When `interpret` returns `null` in `idle`, the system MUST behave exactly as today.
(Previously: queries were answered with an honest not-supported redirect; `correct_amount` and `correct_category` were both reserved with deterministic help; `interpret` was never invoked in dialog states; there was no `greeting` intent, no lifecycle intents, and null-amount registrations dead-ended in a free-text question with no state.)

#### Scenario: Register intent runs the existing flow

- GIVEN a brain envelope `{intent:"register_expense", amount:5000, category:"Supermercado", note:"gaste en el super"}`
- WHEN the message is processed in `idle`
- THEN the registration flow runs with amount 5000 and category "Supermercado"

#### Scenario: Keyword rule beats the brain suggestion

- GIVEN owner text matching a user-authored keyword rule and a brain category suggestion
- WHEN the message is processed
- THEN the movement registers with the matched keyword category and the brain suggestion is ignored

#### Scenario: Query intent executes and answers from real data

- GIVEN owner text "cuánto gasté" classified `query_balance`
- WHEN the message is processed
- THEN no movement is created and the balance query executor answers with the owner's real summary
- AND an honest redirect is sent only if the query execution fails

#### Scenario: Off-topic redirects

- GIVEN owner text classified `off_topic`
- WHEN the message is processed
- THEN the reply is an expense-scoped redirect and no movement is created

#### Scenario: Greeting replies warm and keeps the thread

- GIVEN owner text "hola" classified `greeting` with an open `awaiting_registration` dialog
- WHEN the message is processed
- THEN a warm greeting replies and the open dialog stays alive

#### Scenario: Lifecycle intent routes to the executor

- GIVEN owner text "ya lo pagué" classified `mark_paid`
- WHEN the message is processed in `idle`
- THEN the movement-lifecycle executor marks the referenced PENDING expense PAID and replies once

#### Scenario: Setup gate precedes the brain

- GIVEN an owner with no categories sends "$2500 cafe"
- WHEN the message is processed
- THEN the owner enters `awaiting_setup` and `interpret` is not invoked

#### Scenario: Brain null behaves as today

- GIVEN `GROQ_API_KEY` unset or a brain result of `null`
- WHEN a message is processed in `idle`
- THEN the behavior is identical to today (deterministic parse, otro + correction, or help)

#### Scenario: Dialog answers route through the brain

- GIVEN a message in `awaiting_category`, `awaiting_amount_confirmation`, or `awaiting_registration`
- WHEN it is processed
- THEN `interpret` is invoked with dialog context and the envelope's `dialog_action` routes the message
- AND the deterministic rules apply only as the fallback (brain null/absent/abandon)

### Requirement: Dialog Controller (Brain-Routed Dialogs)

For every non-command owner message in a dialog state (`awaiting_category`, `awaiting_amount_confirmation`, `awaiting_registration`), the system MUST invoke the bot brain's `interpret(body, { state, pending, openQuestion })` BEFORE the deterministic dialog rules and MUST route on the envelope's `dialog_action`: `resolve` → deterministic resolution from the persisted payload ONLY (reassign the pending movement to the answered category, register the chosen amount, or resolve the collected amount/category per registration-collection); `abandon` or brain null/absent → today's D6 rules verbatim (for `awaiting_registration`: clear the collect payload, reply, nothing registers); `null` → intent routing with the pending untouched (queries and CRUD execute; `register_expense` abandons the dialog and registers the new message, replying exactly once with a single merged message carrying the abandon fact and the registration outcome — never two contradictory replies). Commands MUST still be handled before any state logic, in every state. Queries and CRUD intents during dialogs MUST NOT consume the pending. Phantom guard: a `resolve` answer MUST act ONLY on the persisted payload — no valid payload → abandon with a clear reply, nothing registers, and no amount is ever fabricated.
(Previously: the dialog controller covered only `awaiting_category` and `awaiting_amount_confirmation`; `awaiting_registration` did not exist.)
(Previously: register-during-dialog sent two contradictory replies: an abandon message followed by the registration confirmation.)

#### Scenario: Query in dialog answers without consuming the pending

- GIVEN an owner in `awaiting_category` with a pending movement asks "decime los últimos movimientos"
- WHEN the brain returns `dialog_action: null` with a query intent
- THEN the recent-query executor answers with real data
- AND the pending movement and `awaiting_category` state stay intact

#### Scenario: Resolve answer reassigns the pending movement

- GIVEN an owner in `awaiting_category` with a pending movement replies "Transporte"
- WHEN the brain returns `dialog_action: "resolve"`
- THEN the pending movement is reassigned to "Transporte" and the owner returns to `idle`

#### Scenario: Resolve answer registers the chosen amount

- GIVEN an owner in `awaiting_amount_confirmation` with presented amounts 5000 and 4800 replies "5000"
- WHEN the brain returns `dialog_action: "resolve"`
- THEN a movement registers with 5000 from the persisted payload and the question closes

#### Scenario: Phantom guard blocks a bare affirmation

- GIVEN an owner in `awaiting_amount_confirmation` with presented amounts 5000 and 4800 replies "si"
- WHEN the brain returns `dialog_action: "resolve"` with no matching payload amount
- THEN nothing registers, the question abandons with a clear reply, and no amount is fabricated

#### Scenario: New registration during a dialog abandons the pending and replies once

- GIVEN an owner in `awaiting_category` sends "$8000 supermercado"
- WHEN the brain returns `dialog_action: null` with `register_expense`
- THEN the pending correction is abandoned, the new message follows the normal registration path, and exactly one merged reply is sent

#### Scenario: CRUD during a dialog does not consume the pending

- GIVEN an owner in `awaiting_category` with a pending movement sends "creá una categoría mascotas"
- WHEN the brain returns `dialog_action: null` with `create_category`
- THEN the category is created, the pending movement stays intact, and the state stays open

#### Scenario: Brain absent in a dialog degrades to D6

- GIVEN `GROQ_API_KEY` is unset and an owner in `awaiting_category` replies with a multi-word non-category text
- WHEN the message is processed
- THEN the bot lists the existing categories and the state stays open (today's rules verbatim)

#### Scenario: Collection resolve follows the cascade

- GIVEN an owner in `awaiting_registration` asked for the category replies "Transporte"
- WHEN the brain returns `dialog_action: "resolve"`
- THEN the category cascade resolves "Transporte" from the persisted payload and the registration completes

#### Scenario: Collection abandon clears the payload

- GIVEN an owner in `awaiting_registration` with a persisted payload replies "no, dejalo"
- WHEN the brain returns `dialog_action: "abandon"`
- THEN the collect payload clears, a clear reply is sent, and nothing registers