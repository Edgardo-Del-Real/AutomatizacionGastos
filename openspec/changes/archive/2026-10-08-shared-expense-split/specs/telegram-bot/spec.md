# Delta for Telegram Bot

## MODIFIED Requirements

### Requirement: Per-Owner State Machine

The system MUST persist, per owner, a state machine with values `idle`, `awaiting_setup`, `awaiting_capture` (payload `{type}`), `awaiting_preview` (payload `{amount, note, type, category, saveToken, savings?, sharedPercent?}`), `awaiting_category_name` (preview create-category name input), `awaiting_movement_selection` (sub-menu pick), `awaiting_category_selection` (correction reassign pick), `awaiting_delete_confirmation` (delete gate), `awaiting_savings_rule` (savings sub-menu rule text input), `awaiting_savings_percent` ("Otro" percent input), `awaiting_shared_percent` ("Otro" shared percent input), and `awaiting_savings_delete` (savings rule delete gate). The states `awaiting_category`, `awaiting_registration`, and `awaiting_amount_confirmation` MUST NOT exist; a persisted payload in any of those removed states (e.g. from a rollback) MUST recover to `idle` without registering or deleting anything. Transitions MUST be explicit and testable: a type menu tap in any flow state → abandon the pending flow and enter `awaiting_capture` with the tapped type; `awaiting_capture` + parsed `monto+nota` → `awaiting_preview`; preview `➕ Crear categoría` → `awaiting_category_name`, and a created name → back to `awaiting_preview` with the category selected; preview `✅ Guardar` → registers and `idle` + menu, `✏️ Corregir` → `awaiting_capture` with a capture prompt; the INGRESO confirmation `[Otro]` → `awaiting_savings_percent`, and a valid percent → back to `awaiting_preview` with the override persisted; the partner-present COMPARTIDO confirmation `[Otro]` → `awaiting_shared_percent`, and a valid percent `1..99` → back to `awaiting_preview` with `sharedPercent` persisted; a delete pick in the expense admin → `awaiting_delete_confirmation` with the resolved target id persisted; `🗑 Borrar` → deletes and `idle` + menu, `❌ Cancelar` or any new message → `idle` with nothing deleted; the savings sub-menu create → `awaiting_savings_rule`, and a parsed rule text → rule defined and `idle` + menu; a savings rule delete pick → `awaiting_savings_delete` with the rule id persisted, and confirm → rule deleted and `idle` + menu, cancel → `idle` with nothing deleted; completed setup → `idle`. Every persisted payload MUST survive a restart, and a corrupt payload MUST recover without registering or deleting anything.
(Previously: the state machine had no `awaiting_shared_percent` state and the `awaiting_preview` payload carried no `sharedPercent` field.)

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

#### Scenario: Shared Otro percent input returns to the confirmation

- GIVEN a partner-present COMPARTIDO preview owner taps `[Otro]`
- WHEN they reply "30"
- THEN the confirmation re-renders with a 30% share and `sharedPercent` is persisted

#### Scenario: Rule delete gate confirms

- GIVEN an owner in `awaiting_savings_delete` after picking a rule
- WHEN they confirm the delete
- THEN the rule is deleted, the owner returns to `idle`, and the menu replies

## ADDED Requirements

### Requirement: Shared Split Confirmation Annotation

A COMPARTIDO split confirmation MUST use the fixed `reply-text.ts` template (no LLM) and MUST report the sender's share plus the annotation "parte de {total} compartido". A no-partner legacy COMPARTIDO confirmation MUST remain the standard single-amount reply.

#### Scenario: Split confirmation annotates the share

- GIVEN a 1000/1000 split of a 2000 COMPARTIDO
- WHEN the confirmation is sent
- THEN it reports the sender's 1000 share and "parte de {total} compartido"

#### Scenario: Legacy confirmation unchanged

- GIVEN a COMPARTIDO capture with no partner
- WHEN it saves
- THEN the standard single-amount confirmation is sent with no annotation
