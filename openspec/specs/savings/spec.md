# Savings Specification

## Purpose

Automatic savings on income: per-owner keyword→percent rules split a matching income registration into a NET income plus a SAVINGS movement in the "ahorro" category. SAVINGS movements never count as income or expense in KPIs; balance means available money (net income − expenses).

## Requirements

### Requirement: SavingsRule Model

The system MUST store savings rules scoped to an owner (`ownerId`, `keyword`, `percent`) with a unique constraint on `[ownerId, keyword]`. `percent` MUST be stored as `Decimal(12,2)` and MUST satisfy `0 < percent <= 100`. Re-defining an existing keyword MUST upsert (replace the percent), never create a duplicate.

#### Scenario: Rule created

- GIVEN an owner defines "entrenuts al 10%"
- WHEN the rule is saved
- THEN a rule with keyword "entrenuts" and percent 10.00 is stored under that owner only

#### Scenario: Invalid percent rejected

- GIVEN a definition with percent 0, 101, or negative
- WHEN validated
- THEN it is rejected with a validation error

#### Scenario: Redefinition upserts

- GIVEN an existing rule "entrenuts" at 10%
- WHEN it is redefined at 15%
- THEN the same rule stores 15.00 and no duplicate exists

### Requirement: SavingsRule Definition Channel

A savings rule MUST be definable conversationally and via an explicit command. The brain intent `create_savings_rule` MUST redirect to the explicit command `registrar ahorro: <palabra> al <X>%` (the `associate_keyword` precedent). The command MUST create or upsert the rule and confirm.

#### Scenario: Conversational intent redirects

- GIVEN the owner says "guarda un ahorro del 10% para entrenuts"
- WHEN the brain returns intent `create_savings_rule`
- THEN the bot redirects to the explicit `registrar ahorro: entrenuts al 10%` command

#### Scenario: Command defines a rule

- GIVEN the owner sends "registrar ahorro: entrenuts al 10%"
- WHEN processed
- THEN the rule is created or upserted and a confirmation replies

#### Scenario: Malformed definition

- GIVEN a command with an invalid percent
- WHEN processed
- THEN it is rejected with a validation error and no rule is stored

### Requirement: Income Split and Rounding

When an INGRESO-type movement registers (from the ➕ Ingreso menu button) and its note matches a savings-rule keyword, the system MUST register INCOME with the NET amount (gross − savings) and a SAVINGS movement of the savings amount in the "ahorro" category, both in a single transaction. Rounding MUST be `savings = round2(gross × percent / 100)`, `net = gross − savings`, and `net + savings` MUST equal `gross` exactly. With no matching rule, the income MUST register whole (single movement). Per-message overrides no longer exist — every INGRESO follows the rule.
(Previously: the split triggered on keyword-matched income free text, and a "sin ahorro" override could register the income whole.)

#### Scenario: Split registers net and savings

- GIVEN rule "entrenuts" at 10% and an INGRESO capture "cobro sueldo de entrenuts 1000"
- WHEN the preview saves
- THEN INCOME 900 and SAVINGS 100 in "ahorro" are created

#### Scenario: Rounding keeps the invariant

- GIVEN gross 10.00 at 33%
- WHEN split
- THEN savings 3.30 and net 6.70, and net + savings equals 10.00 exactly

#### Scenario: Two-movement atomicity

- GIVEN a split whose SAVINGS create fails
- WHEN the transaction commits
- THEN neither the INCOME nor the SAVINGS movement is persisted

#### Scenario: No rule registers whole

- GIVEN an INGRESO matching no rule
- WHEN the preview saves
- THEN a single whole INCOME movement is created

### Requirement: SHARED Inheritance

A SAVINGS movement created from a SHARED income MUST inherit SHARED visibility and be visible to the same viewers as the source income. Shared incomes are legacy-only after the redesign (no new shared-income capture exists — COMPARTIDO captures expenses), so the inheritance MUST keep applying to pre-existing shared incomes.
(Previously: shared incomes came from the `compartido:` prefix and the inheritance applied to them at registration.)

#### Scenario: Legacy shared income shares savings

- GIVEN a shared income registered before the redesign with a matching rule
- WHEN the split applies to it
- THEN the SAVINGS movement carries SHARED visibility like the net INCOME

#### Scenario: Compartido captures never split

- GIVEN a COMPARTIDO-typed capture whose note matches a rule
- WHEN the preview saves
- THEN a single SHARED EXPENSE registers and no SAVINGS movement is created

### Requirement: KPI-Exclusion Invariants

SAVINGS movements MUST NOT contribute to income or expense totals, balance, per-month/per-day buckets, category breakdowns, or top lists. Balance MUST equal net income − expenses (SAVINGS excluded).

#### Scenario: Savings never pollute KPIs

- GIVEN INCOME 900, SAVINGS 100, and EXPENSE 300
- WHEN KPIs compute
- THEN income = 900, expenses = 300, balance = 600, and the 100 never appears in any income or expense aggregate

### Requirement: Month Savings Query

The system MUST answer "cuánto ahorré este mes" with the sum of SAVINGS movements in the current calendar month (`America/Argentina/Buenos_Aires`), from real data.

#### Scenario: Month with savings

- GIVEN SAVINGS 100 and 50 this month
- WHEN the query runs
- THEN it answers 150

#### Scenario: Empty month

- GIVEN no SAVINGS movements this month
- WHEN the query runs
- THEN it answers 0

### Requirement: Tolerant Rule Matching

`matchNote` MUST apply the tolerant plural fold (`normalizeForMatchTolerant`) to BOTH the note and the stored rule keyword when deciding whether an income matches a savings rule. `defineRule` MUST keep storing the literal-normalized keyword (no data change, unique `[ownerId, keyword]` preserved). Split arithmetic and rounding MUST remain unchanged.

#### Scenario: Plural variant matches

- GIVEN a rule with keyword "sueldo" at 10%
- WHEN an income note "cobré sueldos" is matched
- THEN the rule matches and the split applies (INCOME 900, SAVINGS 100 on gross 1000)

#### Scenario: Brand stays self-consistent

- GIVEN a rule with keyword "entrenuts" at 10%
- WHEN an income note "entrenuts" is matched
- THEN it matches (both sides fold identically) and the split applies

#### Scenario: Stored keyword unchanged

- GIVEN an owner defines rule "sueldos" at 10%
- WHEN the rule is saved
- THEN the stored keyword remains "sueldos"
- AND later notes "sueldo" or "sueldos" both match it

#### Scenario: Split arithmetic unchanged

- GIVEN a tolerant match on gross 10.00 at 33%
- WHEN the split runs
- THEN savings 3.30 and net 6.70 (net + savings equals gross exactly)