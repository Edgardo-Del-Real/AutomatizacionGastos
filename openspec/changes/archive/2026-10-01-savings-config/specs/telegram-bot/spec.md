# Delta for Telegram Bot

## RENAMED Requirements

### Requirement: Savings Rule Command → Savings Rule Commands

(Reason: the savings command surface grows from a single define-rule command to three — define, list, and delete.)
(Migration: tests and docs referencing "Savings Rule Command" update to the plural; behavior changes are in the MODIFIED block below.)

## MODIFIED Requirements

### Requirement: Bot Commands

The system MUST recognize and handle these owner commands: `menu`, `ayuda`, `listar categorias`, `configurar categorias`, `registrar ahorro: <palabra> al <X>%`, `listar ahorros`, and `borrar ahorro: <palabra>` (see savings). The text category CRUD commands `registrar categoria:`, `renombrar categoria:`, and `asociar palabra:` MUST NOT be recognized as commands — a message carrying them MUST reply with an educational redirect to the `🗂 Administrar categorías` button and MUST NOT create or rename anything. The `menu` command MUST render the eight-button main menu and `ayuda` MUST render the static help (see bot-main-menu). The system MUST register the owner-visible command list via `setMyCommands` at startup. Unrecognized commands MUST fall through to idle free-text routing (see bot-free-text-routing), never to capture.
(Previously: the recognized list covered only `menu`, `ayuda`, `listar categorias`, `configurar categorias`, and `registrar ahorro:`.)

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

### Requirement: Savings Rule Commands

The system MUST recognize `registrar ahorro: <palabra> al <X>%`, `listar ahorros`, and `borrar ahorro: <palabra>` as owner commands (semantics per the savings capability): the first MUST create or upsert the rule with a confirmation reply, the second MUST list the owner's rules, and the third MUST delete the rule with a confirmation reply. A malformed or out-of-range percent MUST be rejected with a validation error and MUST NOT store a rule. Deleting a keyword with no stored rule MUST reply gracefully. Unrecognized commands MUST still fall through to normal registration parsing.
(Previously: only `registrar ahorro: <palabra> al <X>%` was recognized as the single savings command.)

#### Scenario: Define a savings rule

- GIVEN owner sends "registrar ahorro: entrenuts al 10%"
- WHEN it is processed
- THEN the rule is created or upserted and a confirmation is sent

#### Scenario: Invalid percent rejected

- GIVEN owner sends "registrar ahorro: entrenuts al 0%"
- WHEN it is processed
- THEN a validation error replies and no rule is stored

#### Scenario: List savings rules

- GIVEN owner sends "listar ahorros"
- WHEN it is processed
- THEN a reply lists the owner's rules (or a clear empty reply)

#### Scenario: Delete a savings rule

- GIVEN owner sends "borrar ahorro: entrenuts"
- WHEN it is processed
- THEN the rule is deleted and a confirmation replies

#### Scenario: Delete of an unknown keyword replies gracefully

- GIVEN owner sends "borrar ahorro: gym" with no stored rule
- WHEN it is processed
- THEN a graceful "no existe" reply is sent and nothing changes

#### Scenario: Unrecognized command falls through

- GIVEN owner text that is not a recognized command
- WHEN it is processed
- THEN it is treated as a normal registration

### Requirement: Per-Owner State Machine

The system MUST persist, per owner, a state machine with values `idle`, `awaiting_setup`, `awaiting_capture` (payload `{type}`), `awaiting_preview` (payload `{amount, note, type, category, saveToken, savings?}`), `awaiting_category_name` (preview create-category name input), `awaiting_movement_selection` (sub-menu pick), `awaiting_category_selection` (correction reassign pick), `awaiting_delete_confirmation` (delete gate), `awaiting_savings_rule` (savings sub-menu rule text input), `awaiting_savings_percent` ("Otro" percent input), and `awaiting_savings_delete` (savings rule delete gate). The states `awaiting_category`, `awaiting_registration`, and `awaiting_amount_confirmation` MUST NOT exist; a persisted payload in any of those removed states (e.g. from a rollback) MUST recover to `idle` without registering or deleting anything. Transitions MUST be explicit and testable: a type menu tap in any flow state → abandon the pending flow and enter `awaiting_capture` with the tapped type; `awaiting_capture` + parsed `monto+nota` → `awaiting_preview`; preview `➕ Crear categoría` → `awaiting_category_name`, and a created name → back to `awaiting_preview` with the category selected; preview `✅ Guardar` → registers and `idle` + menu, `✏️ Corregir` → `awaiting_capture` with a capture prompt; the INGRESO confirmation `[Otro]` → `awaiting_savings_percent`, and a valid percent → back to `awaiting_preview` with the override persisted; a delete pick in the expense admin → `awaiting_delete_confirmation` with the resolved target id persisted; `🗑 Borrar` → deletes and `idle` + menu, `❌ Cancelar` or any new message → `idle` with nothing deleted; the savings sub-menu create → `awaiting_savings_rule`, and a parsed rule text → rule defined and `idle` + menu; a savings rule delete pick → `awaiting_savings_delete` with the rule id persisted, and confirm → rule deleted and `idle` + menu, cancel → `idle` with nothing deleted; completed setup → `idle`. Every persisted payload MUST survive a restart, and a corrupt payload MUST recover without registering or deleting anything.
(Previously: the state machine had no savings states, the `awaiting_preview` payload carried no `savings` field, and the removed-state recovery list was unchanged.)

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

#### Scenario: Otro percent input returns to the confirmation

- GIVEN an INGRESO preview owner taps `[Otro]`
- WHEN they reply "15"
- THEN the confirmation re-renders with savings at 15% and the override is persisted

#### Scenario: Rule delete gate confirms

- GIVEN an owner in `awaiting_savings_delete` after picking a rule
- WHEN they confirm the delete
- THEN the rule is deleted, the owner returns to `idle`, and the menu replies

### Requirement: Savings Split on Income Registration

When an INGRESO-type movement registers (from the ➕ Ingreso menu button), the system MUST decide the split by precedence (semantics per the savings capability): a manual choice persisted in the preview payload wins for that income (percent or disabled), otherwise a matching savings-rule keyword applies, otherwise whole. A split MUST register the net INCOME keeping the preview-picked category and a SAVINGS movement in the "ahorro" category in a single transaction, and the confirmation reply MUST report the gross, net, and savings amounts. A COMPARTIDO-typed capture MUST NOT trigger a split. An INGRESO matching no rule with no manual choice MUST register whole. Shared incomes are legacy-only after the redesign; a pre-existing shared income keeps the SHARED inheritance behavior (see savings). The `sin ahorro`/`con X%` text overrides are REMOVED — such text in `idle` gets an educational redirect and never alters a split.
(Previously: the split followed only the automatic rule, both movements landed in "ahorro", and the confirmation reported gross, net, and saved.)

#### Scenario: Ingreso split applied on registration

- GIVEN rule "entrenuts" at 10% and an owner taps ➕ Ingreso then sends "cobro sueldo de entrenuts 1000" with category "Sueldo" picked and no manual choice
- WHEN the preview saves with a chosen category
- THEN INCOME 900 keeps category "Sueldo" and SAVINGS 100 in "ahorro" are created in one transaction
- AND the confirmation reports 1000 gross, 900 net, and 100 saved

#### Scenario: Manual percent wins on registration

- GIVEN rule "entrenuts" at 10% and a manual 15% choice on gross 1000
- WHEN the preview saves
- THEN INCOME 850 and SAVINGS 150 are created in one transaction

#### Scenario: Compartido never splits

- GIVEN capture type COMPARTIDO with a note matching a savings rule
- WHEN the preview saves
- THEN a single SHARED EXPENSE registers and no SAVINGS movement is created

#### Scenario: No rule registers whole

- GIVEN an INGRESO matching no savings rule with no manual choice
- WHEN the preview saves
- THEN a single whole INCOME movement is created and the reply is the standard confirmation

#### Scenario: Legacy shared income keeps SHARED savings

- GIVEN a shared income registered before the redesign with a matching rule
- WHEN the split applies to it
- THEN its SAVINGS movement inherits SHARED visibility like the net INCOME