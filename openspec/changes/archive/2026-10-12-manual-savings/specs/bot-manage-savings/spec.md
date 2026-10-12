# Delta for Bot Manage Savings

## MODIFIED Requirements

### Requirement: Sub-Menu Entry

The system MUST open the savings sub-menu from a 💰 Ahorro keyboard button on the Ayuda help reply, rendering exactly four actions — create, list, and delete rules, plus register a manual savings (`sa:manual`, see manual-savings). The main menu MUST NOT gain a ninth button. Completed or abandoned operations MUST return to the main menu.
(Previously: the sub-menu rendered exactly three actions — create, list, and delete rules.)

#### Scenario: Sub-menu opens from Ayuda

- GIVEN the owner taps `❓ Ayuda`
- WHEN the help reply with the 💰 Ahorro button is sent
- THEN tapping 💰 Ahorro opens the savings sub-menu with the four actions

#### Scenario: Main menu stays at eight buttons

- GIVEN the main menu is rendered
- WHEN the savings sub-menu is extended
- THEN the main menu still shows exactly the eight existing buttons

#### Scenario: Manual savings action starts the flow

- GIVEN the savings sub-menu is open
- WHEN the owner taps the manual savings action (`sa:manual`)
- THEN the `AWAITING_MANUAL_SAVINGS` flow starts with the amount + optional note prompt