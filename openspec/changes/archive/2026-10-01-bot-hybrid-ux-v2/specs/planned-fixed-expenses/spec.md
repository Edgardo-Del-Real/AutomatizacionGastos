# Delta for Planned Fixed Expenses

## MODIFIED Requirements

### Requirement: Planned Expense Creation Channels

A planned expense MUST be creatable from two channels: the bot's `📅 Gasto previsto` menu button (capture type PENDING → `monto+nota` → preview → save) and the dashboard's "Agregar previsto" action. Both MUST create a `PENDING` EXPENSE through the existing registration path. The `previsto:` prefix is REMOVED: a message starting with `previsto:` in `idle` MUST reply with an educational redirect teaching the 📅 button and MUST NOT create anything. Planned expenses are INDIVIDUAL by design: a PENDING capture MUST never carry SHARED visibility, and the dashboard form MUST NOT offer a shared control.
(Previously: the bot channel was the `previsto:` prefix, which rejected combination with `compartido:`.)

#### Scenario: bot registers a planned expense from the button

- GIVEN an owner tapped `📅 Gasto previsto` and sends "2500 alquiler", then picks a category
- WHEN `✅ Guardar` executes
- THEN a PENDING EXPENSE of 2500 is created

#### Scenario: legacy previsto prefix redirects

- GIVEN owner text "previsto: 2500 alquiler"
- WHEN it is processed
- THEN the educational redirect teaches the 📅 Gasto previsto button and nothing is created

#### Scenario: PENDING is always INDIVIDUAL

- GIVEN a PENDING capture whose preview carries any shared signal
- WHEN it is persisted
- THEN its visibility is `INDIVIDUAL` and it is never visible to the partner

#### Scenario: dashboard adds a planned expense

- GIVEN the "Agregar previsto" form with amount, note, and category
- WHEN the owner submits
- THEN a PENDING EXPENSE is created