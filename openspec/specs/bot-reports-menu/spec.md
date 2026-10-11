# Bot Reports Menu Specification

## Purpose

The `📊 Reportes` sub-menu: five query buttons plus free-text queries answered from executed query results. Answers come from real data; failures redirect honestly; every answer returns to the main menu.

## Requirements

### Requirement: Sub-Menu Entry

The system MUST open the reports sub-menu from the `📊 Reportes` main-menu button, rendering exactly five buttons — `Últimos movimientos`, `Saldo`, `Resumen del mes`, `Ahorro del mes`, `Gastos previstos` — plus a hint that free-text queries are welcome. After an answer, the system MUST return to the main menu.

#### Scenario: Sub-menu opens from the main menu

- GIVEN an owner taps `📊 Reportes`
- WHEN the callback is processed
- THEN the five-button sub-menu renders with the free-text hint

### Requirement: Button Queries

Each button MUST execute its `QueryExecutor` type from real data — recent, balance, month summary, savings, planned — and reply with the executed result (fixed template). A failed execution MUST reply with an honest redirect. The answer MUST be followed by the main menu.

#### Scenario: Recent answers real data

- GIVEN an owner taps `Últimos movimientos`
- WHEN the query executes
- THEN the recent movements answer from real data and the menu follows

#### Scenario: Balance answers real data

- GIVEN an owner taps `Saldo`
- WHEN the query executes
- THEN the balance answer from real data replies and the menu follows

#### Scenario: Planned answers real data

- GIVEN an owner taps `Gastos previstos`
- WHEN the query executes
- THEN the next-month planned total replies from real data and the menu follows

#### Scenario: Failed execution redirects

- GIVEN the query execution fails
- WHEN a button is tapped
- THEN an honest redirect replies, no amount is fabricated, and the menu follows

### Requirement: Free-Text Queries

A free-text query in the reports sub-menu MUST be classified by the LLM into a query intent and answered from the executed result; a message not resolvable to a query by the LLM MUST fall back to the fixed redirect plus the menu. Free text in the reports sub-menu MUST NEVER capture.

#### Scenario: Free-text query answered

- GIVEN an owner in the reports sub-menu sends "cuánto ahorré este mes"
- WHEN it is classified as a savings query
- THEN the savings answer from real data replies and the menu follows

#### Scenario: Unresolvable free text redirects

- GIVEN the LLM returns no query intent for the free text
- WHEN the message is processed
- THEN an honest redirect plus the menu replies and nothing captures