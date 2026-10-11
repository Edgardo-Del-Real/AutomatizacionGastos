# Bot Manage Expenses Specification

## Purpose

The `🧾 Administrar gastos` sub-menu: delete, correct category, and mark-paid chains, all button-driven, all ending back at the main menu.

## Requirements

### Requirement: Sub-Menu Entry

The system MUST open the expense admin sub-menu from the `🧾 Administrar gastos` main-menu button, rendering exactly three buttons — `🗑 Borrar gasto`, `✏️ Corregir categoría`, `💵 Marcar como pagado`. Any completed or abandoned chain MUST return to the main menu.

#### Scenario: Sub-menu opens from the main menu

- GIVEN an owner taps `🧾 Administrar gastos`
- WHEN the callback is processed
- THEN the three-button sub-menu renders

#### Scenario: Menu tap abandons a pending chain

- GIVEN an owner mid-chain in the expense admin
- WHEN they tap any main-menu button
- THEN the chain abandons and the chosen flow starts fresh

### Requirement: Delete Chain

The `🗑 Borrar gasto` button MUST list the owner's 10 most recent movements as buttons; picking one MUST open the existing `[❌ Cancelar] [🗑 Borrar]` confirmation gate; `🗑 Borrar` MUST delete via `ExpenseService.deleteExpense` and return to the menu; `❌ Cancelar` or any new message MUST abandon with nothing deleted.

#### Scenario: Delete chain confirms before deleting

- GIVEN the last-10 list renders and the owner picks a movement
- WHEN the pick is processed
- THEN the confirmation gate opens and nothing is deleted yet

#### Scenario: Confirmation deletes and returns to menu

- GIVEN the confirmation gate is open
- WHEN the owner taps `🗑 Borrar`
- THEN the movement deletes and the main menu replies

#### Scenario: Cancel keeps the movement

- GIVEN the confirmation gate is open
- WHEN the owner taps `❌ Cancelar`
- THEN nothing is deleted and the main menu replies

#### Scenario: Empty window replies clearly

- GIVEN the owner has no movements
- WHEN they tap `🗑 Borrar gasto`
- THEN a clear "no hay gastos" reply is sent and the menu returns

### Requirement: Correction Chain

The `✏️ Corregir categoría` button MUST list the owner's 10 most recent movements EXCLUDING PENDING as buttons; picking one MUST render the owner's NORMAL categories as buttons (excluding "otro" and "ahorro"); picking a category MUST reassign via `updateMovement` and return to the menu.

#### Scenario: Correction reassigns by pick

- GIVEN the owner picked a movement and a target category
- WHEN the category pick is processed
- THEN the movement is reassigned, a confirmation replies, and the menu returns

#### Scenario: PENDING excluded from the correction list

- GIVEN the owner has PENDING and PAID movements
- WHEN the correction list renders
- THEN only PAID movements appear

### Requirement: Mark-Paid Chain

The `💵 Marcar como pagado` button MUST list the owner's PENDING EXPENSE movements as buttons; picking one MUST mark it PAID via `MovementService.markMovementPaid` and return to the menu. An already-PAID pick MUST reply with a conflict notice; zero PENDING movements MUST reply clearly.

#### Scenario: Mark-paid by pick

- GIVEN a PENDING movement is listed and picked
- WHEN the pick is processed
- THEN the movement is marked PAID, a confirmation replies, and the menu returns

#### Scenario: No pending movements

- GIVEN the owner has no PENDING movements
- WHEN they tap `💵 Marcar como pagado`
- THEN a clear "nada previsto" reply is sent and the menu returns