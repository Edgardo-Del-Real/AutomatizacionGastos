# Delta for Bot Expense Lifecycle

## ADDED Requirements

### Requirement: Administrar Gastos Sub-Menu

The system MUST expose the `🧾 Administrar gastos` sub-menu, reachable from the main menu, with exactly three buttons — `🗑 Borrar gasto`, `✏️ Corregir categoría`, `💵 Marcar como pagado`. Every completed or abandoned chain MUST return to the main menu.

#### Scenario: Sub-menu opens from the main menu

- GIVEN an owner taps `🧾 Administrar gastos`
- WHEN the callback is processed
- THEN the three-button sub-menu renders

#### Scenario: Menu tap abandons a pending chain

- GIVEN an owner mid-chain in the expense admin
- WHEN they tap any main-menu button
- THEN the chain abandons and the chosen flow starts fresh

## MODIFIED Requirements

### Requirement: Mark-Paid Intent Execution

The system MUST mark PENDING EXPENSES paid ONLY through the `💵 Marcar como pagado` chain: the PENDING expense list renders as buttons, the owner picks one, and the system MUST transition the picked PENDING EXPENSE to PAID through `MovementService.markMovementPaid`, replying once with the executed facts plus the menu. The conversational `mark_paid` intent is REMOVED — free text MUST NOT trigger mark-paid. The system MUST NOT create any category or movement during this flow. An already-PAID picked movement MUST NOT change state and MUST reply with a clear conflict notice.
(Previously: conversational mark-paid messages were recognized as the `mark_paid` intent and resolved by reference cues.)

#### Scenario: Button chain marks paid

- GIVEN the PENDING list renders and the owner picks the "Alquiler" PENDING expense
- WHEN the pick is processed
- THEN the movement is marked PAID via `markMovementPaid`, one confirmation replies, and the menu returns

#### Scenario: No PENDING candidate

- GIVEN an owner with no PENDING EXPENSE
- WHEN they tap `💵 Marcar como pagado`
- THEN a clear reply states nothing was pending and the menu returns

#### Scenario: Already-paid movement

- GIVEN the picked movement is already PAID and the service returns 409
- WHEN the pick is processed
- THEN the reply reports it was already paid and no state changes

### Requirement: Delete-Expense Intent Execution

The system MUST delete expenses ONLY through the `🗑 Borrar gasto` chain: the last-10 movement list renders as buttons, the owner picks one, and the system MUST NOT delete anything immediately — it MUST enter `awaiting_delete_confirmation`, persist the resolved target id, and reply with the inline keyboard `[❌ Cancelar] [🗑 Borrar]`. The delete executes through `ExpenseService.deleteExpense` ONLY when the owner confirms with `🗑 Borrar`; `❌ Cancelar` or any new message abandons the gate with nothing deleted, and the menu returns. A retried or corrupt gate payload MUST recover without deleting. The system MUST NOT create any category or movement during this flow. The conversational `delete_expense` intent is REMOVED.
(Previously: conversational delete messages were recognized as the `delete_expense` intent, resolved by reference cues, and gated.)

#### Scenario: Delete chain asks for confirmation first

- GIVEN the last-10 list renders and the owner picks a movement
- WHEN the pick is processed
- THEN the target resolves and the `[❌ Cancelar] [🗑 Borrar]` confirmation replies — nothing is deleted yet

#### Scenario: Confirmation deletes and returns to menu

- GIVEN an owner in `awaiting_delete_confirmation` with a persisted target
- WHEN they tap `🗑 Borrar`
- THEN the target is deleted via `deleteExpense`, one confirmation replies, and the menu returns

#### Scenario: Cancel keeps the movement

- GIVEN an owner in `awaiting_delete_confirmation`
- WHEN they tap `❌ Cancelar`
- THEN nothing is deleted and the menu returns

#### Scenario: No candidate

- GIVEN an owner with no matching movement
- WHEN they tap `🗑 Borrar gasto`
- THEN a clear reply states nothing matched and no gate opens

### Requirement: Movement Reference Resolution and Ambiguity

The system MUST resolve the lifecycle target by explicit button pick, never by reference cues: mark-paid lists the owner's PENDING EXPENSE window and delete lists the last-10 window, and exactly one picked candidate MUST execute (mark-paid) or become the gated target (delete). Zero candidates MUST reply with a clear no-match message. Ambiguity never arises because the pick is explicit; the `awaiting_movement_selection` pick pattern is retained for the in-chain lists.
(Previously: reference cues (category, then amount, then recency) scored candidates, and multiple candidates reused the movement-selection ask.)

#### Scenario: Picked candidate executes

- GIVEN exactly one PENDING movement is listed and picked
- WHEN a mark-paid pick is processed
- THEN the picked movement is marked PAID and no movement changes otherwise

#### Scenario: Zero candidates reply clearly

- GIVEN no movement matches the chain window
- WHEN the chain renders
- THEN a clear no-match reply is sent and no movement changes