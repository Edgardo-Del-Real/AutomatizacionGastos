# Delta for Telegram Bot

## MODIFIED Requirements

### Requirement: Movement Parsing, Classification and Categorization

The system MUST NOT parse free text as a movement: capture starts ONLY from a menu tap that persists a capture type (`awaiting_capture`), and the next message MUST be parsed as `monto+nota` (`{amount, note}`) with NO prefixes, NO category in the message, and NO keyword inference. The movement type (REAL/PENDING/INGRESO/COMPARTIDO) MUST come from the menu tap, NEVER from text or the LLM. The category MUST come ONLY from the preview buttons (see quick-capture). The deterministic amount MUST be authoritative; a message in `awaiting_capture` with no parseable amount MUST re-prompt and MUST NOT register anything. The bot MUST NOT invoke the LLM for capture, and keyword rules MUST NOT be consulted by any bot path (the data stays intact for the dashboard).
(Previously: free text in `idle` was parsed deterministic-first with keyword category inference, fell back to the brain for registration, entered collection dialogs on null amounts or unresolvable categories, and asked amount-conflict questions.)

#### Scenario: Menu type plus monto+nota registers

- GIVEN an owner tapped `➕ Nuevo gasto` and sends "14000 pasaje", then chooses "Transporte"
- WHEN `✅ Guardar` executes
- THEN a REAL EXPENSE registers with amount 14000, note "pasaje", category "Transporte", and zero LLM calls occur

#### Scenario: No amount re-prompts

- GIVEN an owner in `awaiting_capture` sends "pasaje"
- WHEN the message is processed
- THEN a clear re-prompt asks for the amount and nothing registers

#### Scenario: Idle capture-shaped text never captures

- GIVEN an owner in `idle` sends "14000 pasaje"
- WHEN the message is processed
- THEN an educational redirect teaches ➕ Nuevo gasto and no movement is created

#### Scenario: Keyword rules unused by the bot

- GIVEN the owner has keyword rules associated with categories
- WHEN any capture or idle message is processed
- THEN no keyword rule is consulted or matched by the bot

### Requirement: Success and Help Reply Content

The system MUST reply to a successfully saved movement with a confirmation carrying amount, note, and category from the fixed `reply-text.ts` template (no LLM). A query-classified idle message MUST be answered from the executed query result (LLM-written from the executed result or the fixed query template). A greeting-classified idle message MUST reply with a warm, expense-scoped greeting followed by the main menu. A capture-shaped idle text, a legacy-prefix message, or any unresolvable message MUST reply with the educational redirect or "no puedo resolver eso" plus the main menu (see bot-free-text-routing). A reply MUST NOT be sent for non-owner, edited, empty, or deduplicated messages.
(Previously: registration confirmations were LLM-written with the fixed fallback, off-topic and query messages received redirects, greetings never closed dialogs, and the help reply taught prefixes.)

#### Scenario: Save confirmation carries the facts

- GIVEN an owner saves "$2500 cafe" in "Cafe"
- WHEN the movement is created
- THEN a confirmation with amount, note, and category is sent from the fixed template with no LLM call

#### Scenario: Query gets an executed answer

- GIVEN an owner message classified `query_balance` and a successful executor run
- WHEN the message is processed
- THEN the reply answers with the owner's real summary

#### Scenario: Greeting greets and shows the menu

- GIVEN an owner message classified `greeting`
- WHEN the message is processed
- THEN a warm greeting replies followed by the main menu

#### Scenario: Unresolvable gets the fallback plus menu

- GIVEN an owner message that is neither query, greeting, capture-shaped, nor legacy-prefix
- WHEN the message is processed
- THEN "no puedo resolver eso" replies followed by the main menu

### Requirement: Setup Flow (awaiting_setup)

When an owner with no categories sends a capture-shaped message, the system MUST reply asking for their categories, enter the owner's `awaiting_setup` state, and treat the next non-empty text reply as the category list (newline- or comma-separated). The setup reply MUST NOT create the "otro" fallback — "otro" is a legacy reserved row only. A later re-run of `configurar categorias` MUST append new categories rather than overwrite. The `configurar categorias` question MUST list the owner's existing categories (dynamic listing, never fixed text). Before the plain category-list split, the setup reply MUST be parsed for the legacy batch commands `borrar categoria: X`, `renombrar categoria: X a: Y`, and `registrar categoria: X`, which MUST execute through the guarded CategoryService operations and MUST NOT be created as literal categories; only remaining plain tokens become categories.
(Previously: creating the listed categories also created the "otro" fallback.)

#### Scenario: First registration triggers setup

- GIVEN an owner with no categories sends "$2500 cafe"
- WHEN it is processed
- THEN the owner enters `awaiting_setup`
- AND a message asking for categories is sent
- AND the registration is not persisted yet

#### Scenario: Reply creates categories without otro

- GIVEN the owner is in `awaiting_setup`
- WHEN they reply "Cafe\nTransporte"
- THEN categories "Cafe" and "Transporte" are created and no "otro" category is created
- AND a confirmation is sent and the owner returns to `idle`

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

### Requirement: Per-Owner State Machine

The system MUST persist, per owner, a state machine with values `idle`, `awaiting_setup`, `awaiting_capture` (payload `{type}`), `awaiting_preview` (payload `{amount, note, type, category, saveToken}`), `awaiting_category_name` (preview create-category name input), `awaiting_movement_selection` (sub-menu pick), `awaiting_category_selection` (correction reassign pick), and `awaiting_delete_confirmation` (delete gate). The states `awaiting_category`, `awaiting_registration`, and `awaiting_amount_confirmation` MUST NOT exist; a persisted payload in any of those removed states (e.g. from a rollback) MUST recover to `idle` without registering or deleting anything. Transitions MUST be explicit and testable: a type menu tap in any flow state → abandon the pending flow and enter `awaiting_capture` with the tapped type; `awaiting_capture` + parsed `monto+nota` → `awaiting_preview`; preview `➕ Crear categoría` → `awaiting_category_name`, and a created name → back to `awaiting_preview` with the category selected; preview `✅ Guardar` → registers and `idle` + menu, `✏️ Corregir` → `awaiting_capture` with a capture prompt; a delete pick in the expense admin → `awaiting_delete_confirmation` with the resolved target id persisted; `🗑 Borrar` → deletes and `idle` + menu, `❌ Cancelar` or any new message → `idle` with nothing deleted; completed setup → `idle`. Every persisted payload MUST survive a restart, and a corrupt payload MUST recover without registering or deleting anything.
(Previously: the state machine had `awaiting_category`, `awaiting_registration`, and `awaiting_amount_confirmation`; capture entered `awaiting_preview` directly from idle free text; reopening the menu never changed state.)

#### Scenario: Menu tap enters awaiting_capture

- GIVEN an owner in `idle` taps `➕ Ingreso`
- WHEN the callback is processed
- THEN the owner transitions to `awaiting_capture` with type INGRESO and a capture prompt replies

#### Scenario: Capture enters preview

- GIVEN an owner in `awaiting_capture` with a parsed "2500 alquiler"
- WHEN the message is processed
- THEN the owner transitions to `awaiting_preview` and the parsed payload is persisted

#### Scenario: Guardar registers and returns to menu

- GIVEN an owner in `awaiting_preview` with a selected category
- WHEN they tap `✅ Guardar`
- THEN the movement registers with the previewed facts, the owner returns to `idle`, and the menu replies

#### Scenario: Menu tap supersedes the preview

- GIVEN an owner in `awaiting_preview` with an unsaved preview
- WHEN they tap a main-menu button
- THEN the preview abandons and the new flow starts fresh

#### Scenario: Removed dialog payload recovers to idle

- GIVEN `pendingNote` holds a payload for `awaiting_registration` or `awaiting_category` (leftover from a previous version)
- WHEN any message is processed
- THEN the state recovers to `idle` with a clear reply and nothing registers

#### Scenario: Delete request enters confirmation

- GIVEN an owner in the expense admin picks a target
- WHEN the pick is processed
- THEN the owner enters `awaiting_delete_confirmation` with the target id persisted
- AND nothing is deleted yet

#### Scenario: Cancelar abandons without deleting

- GIVEN an owner in `awaiting_delete_confirmation`
- WHEN they tap `❌ Cancelar`
- THEN the owner returns to `idle`, the menu replies, and the target movement is untouched

#### Scenario: Delete target survives restart

- GIVEN an owner in `awaiting_delete_confirmation`
- WHEN the process restarts
- THEN the target id and the state are still present

### Requirement: Bot Commands

The system MUST recognize and handle these owner commands: `menu`, `ayuda`, `listar categorias`, `configurar categorias`, and `registrar ahorro: <palabra> al <X>%` (see savings). The text category CRUD commands `registrar categoria:`, `renombrar categoria:`, and `asociar palabra:` MUST NOT be recognized as commands — a message carrying them MUST reply with an educational redirect to the `🗂 Administrar categorías` button and MUST NOT create or rename anything. The `menu` command MUST render the eight-button main menu and `ayuda` MUST render the static help (see bot-main-menu). The system MUST register the owner-visible command list via `setMyCommands` at startup. Unrecognized commands MUST fall through to idle free-text routing (see bot-free-text-routing), never to capture.
(Previously: `registrar categoria:`, `renombrar categoria:`, and `asociar palabra:` were recognized commands, and unrecognized commands fell through to registration parsing.)

#### Scenario: List categories

- GIVEN owner sends "listar categorias"
- WHEN it is processed
- THEN a reply lists all owner categories

#### Scenario: Text CRUD command redirects to the button flow

- GIVEN owner sends "registrar categoria: Salud"
- WHEN it is processed
- THEN an educational redirect teaches the 🗂 Administrar categorías button and no category is created

#### Scenario: Menu command shows actions

- GIVEN owner sends `menu`
- WHEN it is processed
- THEN the eight-button main menu replies

#### Scenario: Unrecognized command routes to idle classification

- GIVEN owner text that is not a recognized command
- WHEN it is processed
- THEN it is routed through idle free-text routing and never starts capture

#### Scenario: Commands registered on start

- GIVEN the API process starts with a valid bot token
- WHEN the bot boots
- THEN `setMyCommands` is called with the trimmed command list

### Requirement: Intent-First Message Handling

For every non-command owner message in `idle`, the system MUST run the idle classifier (see bot-free-text-routing): deterministic pre-checks first (legacy-prefix and capture-shaped text → educational redirect + menu, zero LLM), then the bot brain for query | greeting | off_topic classification. `query`/`query_recent`/`query_balance`/`query_month`/`query_planned` MUST execute the deterministic query executor and answer from real data (an honest redirect replies only when the query fails or the type is unresolvable); `greeting` MUST reply with a warm expense-scoped greeting plus the menu; `off_topic` or a brain-null result MUST reply "no puedo resolver eso" plus the menu. In `awaiting_capture`, the message MUST be parsed as `monto+nota` with no brain call. The setup gate (owner with no categories) MUST take precedence over idle routing. The state machine MUST remain authoritative — the LLM MUST never decide state transitions, capture types, categories, or destructive actions.
(Previously: every non-command idle message ran the deterministic capture parser first and then the brain, with register/correct/lifecycle/category intents driving execution.)

#### Scenario: Query intent executes and answers from real data

- GIVEN owner text "cuánto gasté" classified `query_balance`
- WHEN the message is processed
- THEN no movement is created and the balance query executor answers with the owner's real summary

#### Scenario: Greeting replies warm and shows the menu

- GIVEN owner text "hola" classified `greeting`
- WHEN the message is processed
- THEN a warm greeting replies followed by the main menu

#### Scenario: Off-topic gets the fallback plus menu

- GIVEN owner text classified `off_topic`
- WHEN the message is processed
- THEN "no puedo resolver eso" replies, no movement is created, and the menu follows

#### Scenario: Capture-shaped text redirects without the LLM

- GIVEN owner text "14000 pasaje" in `idle`
- WHEN the message is processed
- THEN an educational redirect teaches ➕ Nuevo gasto and `interpret` is never invoked

#### Scenario: Setup gate precedes idle routing

- GIVEN an owner with no categories sends "$2500 cafe"
- WHEN the message is processed
- THEN the owner enters `awaiting_setup` and neither the parser nor `interpret` is invoked

#### Scenario: Capture message in awaiting_capture skips the brain

- GIVEN an owner in `awaiting_capture` sends "30000 gym"
- WHEN the message is processed
- THEN the preview flow runs and `interpret` is not invoked

#### Scenario: Brain null degrades to the deterministic fallback

- GIVEN `GROQ_API_KEY` unset or a brain result of `null`
- WHEN a non-capture-shaped message is processed in `idle`
- THEN "no puedo resolver eso" plus the menu replies and nothing captures

### Requirement: LLM Branch Replies with Fixed Fallback

The LLM reply surface MUST be limited to query answers and greeting replies: the brain's `reply` MAY be invoked for a query execution result or a greeting, and the returned text MUST be sent verbatim. Registration, correction, mark-paid, delete, and category admin outcomes MUST use the fixed `reply-text.ts` templates and MUST NOT invoke the LLM. The `reply` call MUST be skipped for commands, the setup flow, capture prompts, and previews. When the brain is absent, `reply` returns `null`, or the reply fails, the system MUST send the fixed template carrying the same executed facts.
(Previously: the brain's `reply` covered registration success, correction, amount conflict, help, and redirects.)

#### Scenario: Query reply sent from the executed result

- GIVEN an executed query result and a brain reply string
- WHEN the outcome is a query answer
- THEN the brain reply string is sent verbatim to the owner

#### Scenario: Capture confirmation uses the fixed template

- GIVEN a saved movement
- WHEN the confirmation is sent
- THEN the fixed template with amount, note, and category is sent and the LLM is never invoked

#### Scenario: Commands and setup skip the reply call

- GIVEN a command or a setup-flow message
- WHEN it is processed
- THEN the brain's `reply` is not invoked

### Requirement: Savings Split on Income Registration

When an INGRESO-type movement registers (from the ➕ Ingreso menu button) and its note matches a savings-rule keyword, the system MUST register the INCOME with the NET amount and a SAVINGS movement in the "ahorro" category in a single transaction (semantics per the savings capability), and the confirmation reply MUST report the gross, net, and savings amounts. A COMPARTIDO-typed capture MUST NOT trigger a split. An INGRESO matching no rule MUST register whole. Shared incomes are legacy-only after the redesign; a pre-existing shared income keeps the SHARED inheritance behavior (see savings). The `sin ahorro`/`con X%` overrides are REMOVED — such text in `idle` gets an educational redirect and never alters a split.
(Previously: the split triggered on keyword-matched income free text, overrides applied per message, and shared incomes came from the `compartido:` prefix.)

#### Scenario: Ingreso split applied on registration

- GIVEN rule "entrenuts" at 10% and an owner taps ➕ Ingreso then sends "cobro sueldo de entrenuts 1000"
- WHEN the preview saves with a chosen category
- THEN INCOME 900 and SAVINGS 100 in "ahorro" are created in one transaction
- AND the confirmation reports 1000 gross, 900 net, and 100 saved

#### Scenario: Compartido never splits

- GIVEN capture type COMPARTIDO with a note matching a savings rule
- WHEN the preview saves
- THEN a single SHARED EXPENSE registers and no SAVINGS movement is created

#### Scenario: No rule registers whole

- GIVEN an INGRESO matching no savings rule
- WHEN the preview saves
- THEN a single whole INCOME movement is created and the reply is the standard confirmation

#### Scenario: Legacy shared income keeps SHARED savings

- GIVEN a shared income registered before the redesign with a matching rule
- WHEN the split applies to it
- THEN its SAVINGS movement inherits SHARED visibility like the net INCOME

### Requirement: Planned Expense Registration (Gasto previsto button)

The system MUST register a PENDING EXPENSE ONLY through the `📅 Gasto previsto` menu button: the tap persists capture type PENDING, the next `monto+nota` opens the preview, and saving registers a `PENDING` EXPENSE through the existing create path. Planned expenses are INDIVIDUAL by design: a PENDING capture MUST NEVER compose with COMPARTIDO. The `previsto:` prefix is REMOVED: a message starting with `previsto:` in `idle` MUST reply with an educational redirect teaching the 📅 button and MUST NOT create anything, start a dialog, or change the bot state. A PENDING registration MUST NOT trigger any savings split. The type MUST NOT be signaled by the LLM — PENDING results ONLY from the menu button.
(Previously: the `previsto:` prefix parsed at arrival registered the PENDING EXPENSE, and the brain's `planned` flag was rejected.)

#### Scenario: Button registers a planned expense

- GIVEN an owner tapped `📅 Gasto previsto` and sends "2500 alquiler", then chooses a category
- WHEN `✅ Guardar` executes
- THEN a PENDING EXPENSE of 2500 is created and a confirmation replies

#### Scenario: Legacy previsto prefix redirects

- GIVEN owner text "previsto: 2500 alquiler"
- WHEN it is processed
- THEN the educational redirect teaches the 📅 Gasto previsto button, no movement is created, and the state stays untouched

#### Scenario: Brain never decides the planned type

- GIVEN a query-classified message mentioning a future expense with no 📅 button tap
- WHEN it is processed
- THEN no PENDING movement results

### Requirement: Guarded Category Creation Funnel

Every bot-side category-creation path — the preview `➕ Crear categoría` flow, the `🗂 Administrar categorías` create flow, and setup-list entries — MUST funnel through the guarded `CategoryService.createCategory`. Dialog auto-creation MUST NOT exist: capture previews and correction reassigns resolve ONLY against the closed category set or the category buttons and MUST NEVER create a category. A name rejected by the reserved or duplicate-variant guards MUST produce a redirect reply, MUST NOT create any category, and MUST leave the current flow open without a selection.
(Previously: the funnel also covered the `correct_category` target auto-create, the `create_category` intent with `then_reassign`, and the `registrar categoria:` command.)

#### Scenario: Preview create funnels through the guarded path

- GIVEN an owner in `awaiting_category_name` replies "Gimnasio"
- WHEN it is processed
- THEN "Gimnasio" is created through `CategoryService.createCategory` and the preview re-renders with it selected

#### Scenario: Preview and picks never auto-create

- GIVEN a preview category row or a correction reassign row
- WHEN any category button or text is processed
- THEN no category is created beyond the explicit ➕ or admin flows

## REMOVED Requirements

### Requirement: Correction Loop (awaiting_category) and Learning

(Reason: the `awaiting_category` state is removed — category is mandatory at the preview, so no movement falls to "otro" and no correction loop exists.)
(Migration: category changes for past movements go through 🧾 Administrar gastos → ✏️ Corregir categoría (see movement-correction).)

### Requirement: Dialog Controller (Brain-Routed Dialogs)

(Reason: the dialog states (`awaiting_category`, `awaiting_amount_confirmation`, `awaiting_registration`) are removed; every flow is button-driven.)
(Migration: deterministic button chains in quick-capture and bot-manage-expenses replace brain-routed dialog resolution.)

### Requirement: Mixed-Intent Create + Reassign (then_reassign)

(Reason: the brain no longer creates categories; creation is button-driven via preview ➕ and the category admin.)
(Migration: none — the preview ➕ flow covers create-and-select.)

### Requirement: Registration Overrides

(Reason: the `sin ahorro`/`con X%` text overrides are legacy prefixes and are removed with the prefix surface.)
(Migration: savings splits always follow the rule; legacy override text gets an educational redirect (see bot-free-text-routing).)

### Requirement: Shared Registration via Prefix

(Reason: the `compartido:` prefix is removed; shared captures now use the 👥 Compartido menu button with type COMPARTIDO.)
(Migration: shared movement creation is a menu-chosen capture type (see quick-capture).)