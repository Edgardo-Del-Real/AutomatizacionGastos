# Delta for Telegram Bot

## ADDED Requirements

### Requirement: Savings Rule Command

The system MUST recognize `registrar ahorro: <palabra> al <X>%` as an owner command that creates or upserts the savings rule (semantics per the savings capability) and MUST reply with a confirmation. A malformed percent MUST be rejected with a validation error and MUST NOT store a rule. Unrecognized commands MUST still fall through to normal registration parsing.

#### Scenario: Define a savings rule

- GIVEN owner sends "registrar ahorro: entrenuts al 10%"
- WHEN it is processed
- THEN the rule is created or upserted and a confirmation is sent

#### Scenario: Invalid percent rejected

- GIVEN owner sends "registrar ahorro: entrenuts al 0%"
- WHEN it is processed
- THEN a validation error replies and no rule is stored

#### Scenario: Unrecognized command falls through

- GIVEN owner text that is not a recognized command
- WHEN it is processed
- THEN it is treated as a normal registration

### Requirement: Savings Split on Income Registration

When an INCOME registration's note matches a savings-rule keyword and no override applies, the system MUST register the INCOME with the NET amount and a SAVINGS movement in the "ahorro" category in a single transaction (semantics per the savings capability), and the confirmation reply MUST report the gross, net, and savings amounts. A SHARED income MUST produce a SHARED savings movement. An income matching no rule MUST register whole as today.

#### Scenario: Split applied on registration

- GIVEN rule "entrenuts" at 10% and message "cobro sueldo de entrenuts 1000"
- WHEN the message is processed
- THEN INCOME 900 and SAVINGS 100 in "ahorro" are created in one transaction
- AND the confirmation reports 1000 gross, 900 net, and 100 saved

#### Scenario: Shared income shares the savings

- GIVEN "compartido: cobro sueldo de entrenuts 1000" with a matching rule
- WHEN the message is processed
- THEN both the INCOME and the SAVINGS movement carry SHARED visibility

#### Scenario: No rule registers whole

- GIVEN an income matching no savings rule
- WHEN the message is processed
- THEN a single whole INCOME movement is created and the reply is today's confirmation

### Requirement: Registration Overrides

The system MUST parse the deterministic overrides "sin ahorro" and "con X%" at arrival alongside the `compartido:` prefix, and MUST apply them on the brain-absent path too. "sin ahorro" MUST register the full gross with no SAVINGS movement; "con X%" MUST replace the rule percent for that message only, with X validated as `0 < X <= 100`.

#### Scenario: sin ahorro disables the split

- GIVEN a matching rule and message "sin ahorro cobro sueldo de entrenuts 1000"
- WHEN the message is processed
- THEN INCOME 1000 registers whole and no SAVINGS movement is created

#### Scenario: con X% overrides the rule percent

- GIVEN a rule at 10% and message "con 5% cobro sueldo de entrenuts 1000"
- WHEN the message is processed
- THEN INCOME 950 and SAVINGS 50 are created

#### Scenario: Override works without the brain

- GIVEN `GROQ_API_KEY` unset and a matching rule
- WHEN an income with "sin ahorro" or "con 5%" arrives
- THEN the override applies deterministically with today's flow

#### Scenario: Invalid override percent rejected

- GIVEN a message "con 150% cobro sueldo de entrenuts 1000"
- WHEN the message is processed
- THEN the registration is rejected with a validation error and no movement is created

### Requirement: Savings Query Routing

The system MUST answer "cuánto ahorré este mes" from real data with the sum of SAVINGS movements in the current calendar month (semantics per the savings capability); an honest redirect MUST be used only when query execution fails.

#### Scenario: Savings query answers real data

- GIVEN SAVINGS 100 and 50 this month
- WHEN the owner asks "cuánto ahorré este mes"
- THEN the reply answers 150 from real data

#### Scenario: Savings query failure redirects

- GIVEN a savings query whose execution fails
- WHEN the owner asks "cuánto ahorré este mes"
- THEN an honest redirect replies and no amount is fabricated