# Delta for Telegram Bot

## ADDED Requirements

### Requirement: Planned Expense Registration (`previsto:` prefix)

The system MUST parse a `previsto:` prefix at arrival, alongside the `compartido:` prefix, and MUST register the movement as a `PENDING` EXPENSE through the existing create path. `previsto:` MUST compose with `compartido:` in either order. The prefix MUST work on the brain-absent path. A `previsto:` registration MUST NOT trigger any savings split.

#### Scenario: previsto registers a planned expense

- GIVEN owner text "previsto: 2500 alquiler"
- WHEN it is processed
- THEN a PENDING EXPENSE of 2500 is created and a confirmation replies

#### Scenario: previsto composes with compartido

- GIVEN owner text "compartido: previsto: 2500 alquiler"
- WHEN it is processed
- THEN a PENDING EXPENSE with SHARED visibility is created

#### Scenario: brain-absent path

- GIVEN `GROQ_API_KEY` unset
- WHEN "previsto: 2500 alquiler" is processed
- THEN the PENDING EXPENSE still registers deterministically

### Requirement: Recent Movements Exclude Planned

The bot's `recent` query MUST exclude PENDING movements; PENDING rows MUST be visible only through the `planned` query.

#### Scenario: recent omits pending

- GIVEN a PENDING EXPENSE and recent PAID movements
- WHEN the owner asks for recent movements
- THEN the reply lists only the PAID movements

#### Scenario: planned still answers

- GIVEN the same PENDING EXPENSE
- WHEN the owner asks "¿cuánto tengo previsto?"
- THEN the reply reports the planned total from real data

### Requirement: Planned Query Routing

The system MUST answer "¿cuánto tengo previsto?" and equivalent phrasings ("gastos fijos previstos", "cuánto voy a gastar el mes que viene") from real data: the sum of PENDING EXPENSE movements targeted at next month (`summary.planned`). An honest redirect MUST be used only when query execution fails.

#### Scenario: planned query answers real data

- GIVEN PENDING EXPENSE 2500 and 1500 targeted next month
- WHEN the owner asks "¿cuánto tengo previsto?"
- THEN the reply answers 4000 for next month from real data

#### Scenario: no pending answers zero

- GIVEN no PENDING EXPENSE
- WHEN the owner asks "¿cuánto tengo previsto?"
- THEN the reply answers 0 for next month

#### Scenario: planned query failure redirects

- GIVEN a planned query whose execution fails
- WHEN the owner asks "¿cuánto tengo previsto?"
- THEN an honest redirect replies and no amount is fabricated