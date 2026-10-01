# Delta for Savings

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Deterministic Overrides

(Reason: the `sin ahorro`/`con X%` text overrides are legacy prefixes removed with the prefix surface.)
(Migration: savings splits always follow the rule; legacy override text gets an educational redirect (see bot-free-text-routing).)