# Bot Free-Text Routing Specification

## Purpose

Routing of every non-command owner message in `idle`: free text NEVER starts capture. Queries go to the LLM, greetings get a warm reply plus the menu, capture-shaped text and legacy prefixes get friendly educational redirects, and everything else gets "no puedo resolver eso" plus the menu. Deterministic pre-checks run before any LLM call; without the LLM the bot still routes and never captures.

## Requirements

### Requirement: Idle Free-Text Classification

The system MUST classify every non-command owner message in `idle` in this order: (1) deterministic pre-checks — legacy-prefix text and capture-shaped text; (2) LLM classification into query | greeting | off_topic; (3) brain-null fallback → off_topic. Free text in `idle` MUST NEVER start capture, MUST NEVER create a movement, and MUST NEVER invoke the LLM for capture.

#### Scenario: Query answered by the LLM from real data

- GIVEN an owner in `idle` sends "cuánto gasté este mes"
- WHEN it is classified `query_month`
- THEN the query executor answers from real data and the menu follows

#### Scenario: Greeting greets and shows the menu

- GIVEN an owner in `idle` sends "hola"
- WHEN it is classified `greeting`
- THEN a warm greeting replies followed by the main menu

#### Scenario: Brain null degrades to off-topic

- GIVEN `GROQ_API_KEY` unset or the brain returns null
- WHEN a non-capture-shaped message is processed
- THEN "no puedo resolver eso" plus the menu replies and nothing captures

### Requirement: Educational Redirect for Capture-Shaped Text

The system MUST detect capture-shaped text (an amount token with or without a note, e.g. "14000 pasaje") deterministically, WITHOUT the LLM, and MUST reply with a friendly educational redirect ("mandalo desde ➕ Nuevo gasto") plus the menu. It MUST NOT open a preview, MUST NOT register anything, and MUST NOT invoke the LLM.

#### Scenario: Capture-shaped text redirects

- GIVEN an owner in `idle` sends "14000 pasaje"
- WHEN it is processed
- THEN a friendly redirect teaching ➕ Nuevo gasto replies, the menu follows, and nothing registers (zero LLM calls)

#### Scenario: Amount-only text redirects

- GIVEN an owner in `idle` sends "30000"
- WHEN it is processed
- THEN the same educational redirect replies and no preview opens

### Requirement: Legacy Prefix Redirect

The system MUST detect legacy prefixes (`previsto:`, `compartido:`, `sin ahorro`, `con X%`) deterministically and MUST reply with an educational redirect explaining the new button flow (📅 Gasto previsto / 👥 Compartido), plus the menu. Legacy prefixes MUST NOT create movements, MUST NOT change state, and MUST NOT invoke the LLM.

#### Scenario: previsto: prefix redirects

- GIVEN an owner sends "previsto: 2500 alquiler"
- WHEN it is processed
- THEN the redirect teaches the 📅 Gasto previsto button and no PENDING movement is created

#### Scenario: compartido: prefix redirects

- GIVEN an owner sends "compartido: 2000 super"
- WHEN it is processed
- THEN the redirect teaches the 👥 Compartido button and nothing registers

#### Scenario: Savings override text redirects

- GIVEN an owner sends "sin ahorro cobro sueldo de entrenuts 1000"
- WHEN it is processed
- THEN an educational redirect replies and no split override applies

### Requirement: Unresolvable Fallback

Any `idle` message that is not a query, greeting, capture-shaped text, or legacy prefix MUST reply "no puedo resolver eso" plus the main menu. The reply MUST NOT be general chat, MUST NOT create a movement, and MUST NOT invoke the LLM again.

#### Scenario: Unresolvable text gets the fallback

- GIVEN an owner in `idle` sends "que lindo día"
- WHEN it is processed
- THEN "no puedo resolver eso" replies followed by the menu

#### Scenario: Menu tail on every idle reply

- GIVEN any idle-classified reply is emitted
- WHEN the reply completes
- THEN the main menu follows the message