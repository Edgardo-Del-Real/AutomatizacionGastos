# Bot Manage Savings Specification

## Purpose

The 💰 Ahorro savings-rule sub-menu, entered from the Ayuda help reply (the main menu is full at 8 rows): create, list, and delete automatic savings rules with buttons, plus the `listar ahorros` / `borrar ahorro:` text commands. Deterministic — no LLM involvement.

## Requirements

### Requirement: Sub-Menu Entry

The system MUST open the savings-rule sub-menu from a 💰 Ahorro keyboard button on the Ayuda help reply, rendering exactly three actions — create, list, and delete rules. The main menu MUST NOT gain a ninth button. Completed or abandoned operations MUST return to the main menu.

#### Scenario: Sub-menu opens from Ayuda

- GIVEN the owner taps `❓ Ayuda`
- WHEN the help reply with the 💰 Ahorro button is sent
- THEN tapping 💰 Ahorro opens the savings-rule sub-menu with the three actions

#### Scenario: Main menu stays at eight buttons

- GIVEN the main menu is rendered
- WHEN the savings sub-menu is added
- THEN the main menu still shows exactly the eight existing buttons

### Requirement: Create Rule

The create action MUST prompt for a rule; the next text MUST be parsed with the same syntax as the text command (`registrar ahorro: <palabra> al <X>%`), MUST create or upsert the rule through the savings service, and MUST confirm plus return to the menu. An invalid percent MUST be rejected and MUST NOT store a rule.

#### Scenario: Create confirms and returns to menu

- GIVEN the bot asked for a rule in the sub-menu
- WHEN the owner replies "registrar ahorro: entrenuts al 10%"
- THEN the rule is created or upserted, a confirmation replies, and the menu returns

#### Scenario: Invalid percent rejected

- GIVEN the bot asked for a rule in the sub-menu
- WHEN the owner replies "registrar ahorro: entrenuts al 0%"
- THEN a validation error replies, no rule is stored, and the menu returns

### Requirement: List Rules

The list action MUST show the owner's savings rules (keyword and percent, oldest-first). An owner with no rules MUST receive a clear empty reply.

#### Scenario: List shows the owner's rules

- GIVEN the owner has rules "entrenuts al 10%" and "sueldo al 5%"
- WHEN the list action executes
- THEN both rules are shown with keyword and percent

#### Scenario: Empty list replies clearly

- GIVEN the owner has no savings rules
- WHEN the list action executes
- THEN a clear "no tenés ahorros configurados" reply is sent

### Requirement: Delete Rule

The delete action MUST list the owner's rules as buttons; picking one MUST enter a confirmation gate; confirming MUST delete the rule through the savings service and return to the menu; cancel MUST return without deleting. A stale pick of an already-deleted rule MUST reply missing and MUST NOT execute.

#### Scenario: Delete confirms and returns to menu

- GIVEN the owner picked a rule and confirmed the delete
- WHEN the delete executes
- THEN the rule is removed and the menu returns

#### Scenario: Cancel abandons the delete

- GIVEN the owner picked a rule
- WHEN they cancel the confirmation
- THEN no rule is deleted and the menu returns

#### Scenario: Stale rule pick replies missing

- GIVEN a rule button whose rule was already deleted
- WHEN the delete is attempted
- THEN a clear missing reply is sent and nothing executes