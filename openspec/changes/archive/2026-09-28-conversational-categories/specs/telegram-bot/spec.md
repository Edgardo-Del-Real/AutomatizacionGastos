# Delta for telegram-bot

## ADDED Requirements

### Requirement: Guarded Category Creation Funnel

Every bot-side category creation path — dialog single-token auto-create, `correct_category` target auto-create, `create_category` intent (including `then_reassign`), setup-list entries, and the `registrar categoria:` command — MUST funnel through the guarded `CategoryService.createCategory`. A name rejected by the reserved or duplicate-variant guards MUST produce a redirect reply, MUST NOT create any category, and MUST leave the pending correction (when one exists) open with the movement in "otro".

#### Scenario: registrar command redirected

- GIVEN owner sends "registrar categoria: previsto"
- WHEN it is processed
- THEN no category is created and a redirect reply teaches "previsto: monto nota"

#### Scenario: Dialog auto-create gated

- GIVEN an owner in `awaiting_category` replies "previsto"
- WHEN it is processed
- THEN no category is created, a redirect replies, and the pending correction stays open

#### Scenario: then_reassign gated

- GIVEN an owner in `awaiting_category` sends "creá gastos fijos y guardalo ahí"
- WHEN the brain returns `create_category` with `then_reassign: true`
- THEN no category is created and no reassignment occurs (a redirect replies instead)

#### Scenario: Setup entry gated

- GIVEN an owner in `awaiting_setup` replies "Cafe, gastos fijos"
- WHEN it is processed
- THEN "Cafe" is created and "gastos fijos" is rejected with a redirect (no category for it)

## MODIFIED Requirements

### Requirement: Planned Expense Registration (`previsto:` prefix)

The system MUST parse a `previsto:` prefix at arrival, alongside the `compartido:` prefix, and MUST register the movement as a `PENDING` EXPENSE through the existing create path. `previsto:` MUST compose with `compartido:` in either order. The prefix MUST work on the brain-absent path. A `previsto:` registration MUST NOT trigger any savings split. The deterministic prefix MUST be authoritative: when both a `previsto:` prefix and a brain `planned` flag are present, the prefix wins; a brain `planned: true` flag without the prefix MAY register a PENDING EXPENSE; on the brain-absent path only the prefix can produce PENDING.
(Previously: only the literal `previsto:` prefix could produce PENDING; the brain envelope carried no `planned` field.)

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

#### Scenario: Prefix wins over the flag

- GIVEN the brain returns `planned: false` and the text carries "previsto: 2500 alquiler"
- WHEN it is processed
- THEN the PENDING EXPENSE registers anyway (deterministic prefix authoritative)

#### Scenario: Flag alone registers PENDING with the brain

- GIVEN the brain returns `planned: true` for "dejalo para el mes que viene: 2500 alquiler" with no prefix
- WHEN it is processed
- THEN a PENDING EXPENSE registers