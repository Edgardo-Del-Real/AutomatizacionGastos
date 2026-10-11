# Delta for Savings

## ADDED Requirements

### Requirement: Savings Rule Listing and Deletion

The system MUST list an owner's savings rules (oldest-first) and MUST delete a rule by keyword scoped to that owner. Deleting a keyword with no stored rule MUST reply gracefully ("no existe") and MUST NOT error; deletion MUST NOT affect other owners' rules or any movements.

#### Scenario: List returns the owner's rules

- GIVEN the owner has rules "entrenuts" and "sueldo"
- WHEN the rules are listed
- THEN both rules are returned oldest-first

#### Scenario: Delete removes the rule

- GIVEN an owner with rule "entrenuts" at 10%
- WHEN the rule is deleted by keyword
- THEN the rule no longer matches future incomes and the reply confirms

#### Scenario: Delete of an unknown keyword replies gracefully

- GIVEN an owner with no rule "gym"
- WHEN "gym" is deleted
- THEN a graceful "no existe" reply is sent and nothing changes

#### Scenario: Delete is owner-scoped

- GIVEN two owners each with a rule "sueldo"
- WHEN one owner deletes "sueldo"
- THEN the other owner's rule remains

## MODIFIED Requirements

### Requirement: Income Split and Rounding

When an INGRESO-type movement registers (from the ➕ Ingreso menu button), the system MUST decide the split by precedence: an explicit manual choice for that income MUST win — a percent choice MUST apply that percent, a "No apartar" choice MUST disable savings for that income only (whole INCOME, no SAVINGS movement); with no manual choice, a note matching a savings-rule keyword MUST apply the rule percent; with no match, the income MUST register whole. A split MUST register the net INCOME keeping the preview-picked category and a SAVINGS movement of the savings amount in the "ahorro" category, both in a single transaction. Rounding MUST be `savings = round2(gross × percent / 100)`, `net = gross − savings`, and `net + savings` MUST equal `gross` exactly.
(Previously: every INGRESO followed the automatic rule with no per-income choice, and both split movements were created in "ahorro".)

#### Scenario: Split registers net and savings

- GIVEN rule "entrenuts" at 10%, an INGRESO capture "cobro sueldo de entrenuts 1000" with category "Sueldo" picked, and no manual choice
- WHEN the preview saves
- THEN INCOME 900 keeps category "Sueldo" and SAVINGS 100 is created in "ahorro"

#### Scenario: Rounding keeps the invariant

- GIVEN gross 10.00 at 33%
- WHEN split
- THEN savings 3.30 and net 6.70, and net + savings equals 10.00 exactly

#### Scenario: Two-movement atomicity

- GIVEN a split whose SAVINGS create fails
- WHEN the transaction commits
- THEN neither the INCOME nor the SAVINGS movement is persisted

#### Scenario: No rule registers whole

- GIVEN an INGRESO matching no rule and no manual choice
- WHEN the preview saves
- THEN a single whole INCOME movement is created

#### Scenario: Manual percent supersedes the rule

- GIVEN rule "entrenuts" at 10% and a manual choice of 15%
- WHEN the preview saves
- THEN savings is 15% of gross (150 on 1000) and net 850

#### Scenario: No apartar registers whole

- GIVEN a matching rule and a manual "No apartar" choice
- WHEN the preview saves
- THEN a single whole INCOME registers and no SAVINGS movement is created

#### Scenario: Manual choice is per income only

- GIVEN an income saved with a manual 15% choice
- WHEN a later INGRESO with the same note saves with no manual choice
- THEN the rule percent applies again