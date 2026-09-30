# Bot Expense Lifecycle Specification

## Purpose

The conversational expense lifecycle: the bot marks planned expenses as paid (PENDING→PAID) and deletes expenses from chat, reusing the existing REST services (`MovementService.markMovementPaid`, `ExpenseService.deleteExpense`) with zero duplicated business logic. Reference resolution is deterministic (recency, category, amount cues); ambiguity reuses the existing movement-selection ask.

## Requirements

### Requirement: Mark-Paid Intent Execution

The system MUST recognize conversational mark-paid messages ("ya lo pagué", "pásalo a pagado", "el previsto de X lo pagué") as the `mark_paid` intent and MUST transition the referenced PENDING EXPENSE to PAID through `MovementService.markMovementPaid`, replying once with the executed facts. The system MUST NOT create any category or movement during this flow. An already-PAID referenced movement MUST NOT change state and MUST reply with a clear conflict notice.

#### Scenario: Mark paid by category reference

- GIVEN an owner with a PENDING EXPENSE in "Alquiler" and the message "el previsto de alquiler lo pagué"
- WHEN the message is processed
- THEN the movement is marked PAID via `markMovementPaid` and one confirmation reply is sent

#### Scenario: Mark paid by amount reference

- GIVEN an owner with a PENDING EXPENSE of 2500 and the message "ya lo pagué, los 2500"
- WHEN the message is processed
- THEN the matching PENDING movement is marked PAID and one confirmation reply is sent

#### Scenario: No PENDING candidate

- GIVEN an owner with no PENDING EXPENSE
- WHEN the message "ya lo pagué" is processed
- THEN a clear reply states nothing was pending and no state changes

#### Scenario: Already-paid movement

- GIVEN the referenced movement is already PAID and the service returns 409
- WHEN the message is processed
- THEN the reply reports it was already paid and no state changes

### Requirement: Delete-Expense Intent Execution

The system MUST recognize conversational delete messages ("borra ese gasto", "borralo") as the `delete_expense` intent and MUST delete the referenced expense through `ExpenseService.deleteExpense`, replying once with the executed facts. The system MUST NOT create any category or movement during this flow.

#### Scenario: Delete by recency

- GIVEN an owner with a recent movement and the message "borra ese gasto"
- WHEN the message is processed
- THEN the most recent matching movement is deleted via `deleteExpense` and one confirmation reply is sent

#### Scenario: Delete by category reference

- GIVEN an owner with a movement in "Cafe" and the message "borra el de cafe"
- WHEN the message is processed
- THEN the referenced movement is deleted and one confirmation reply is sent

#### Scenario: No candidate

- GIVEN an owner with no matching movement
- WHEN the message "borra ese gasto" is processed
- THEN a clear reply states nothing matched and nothing is deleted

### Requirement: Movement Reference Resolution and Ambiguity

The system MUST resolve the movement reference deterministically before acting: mark-paid MUST consider only the owner's PENDING EXPENSE movements; delete MUST score all owner movements using the corrector-style candidate window. Reference cues MUST be weighed in a fixed order — explicit category, then amount, then recency. Exactly one candidate MUST execute; zero candidates MUST reply with a clear no-match message; multiple candidates MUST reuse the `awaiting_movement_selection` ask and MUST NOT modify any movement until the owner picks one.

#### Scenario: Single candidate acts

- GIVEN exactly one movement matches the reference cues
- WHEN a lifecycle intent is processed
- THEN the action executes immediately and one reply is sent

#### Scenario: Ambiguous reference asks

- GIVEN two PENDING movements in the same category
- WHEN a mark-paid message references that category
- THEN the bot asks the owner to pick via the movement-selection ask and no movement changes

#### Scenario: No match replies clearly

- GIVEN no movement matches any reference cue
- WHEN a lifecycle intent is processed
- THEN a clear no-match reply is sent and no movement changes