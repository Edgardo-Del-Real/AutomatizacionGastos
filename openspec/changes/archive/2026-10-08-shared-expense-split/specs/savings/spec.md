# Delta for Savings

## MODIFIED Requirements

### Requirement: SHARED Inheritance

A SAVINGS movement created from a SHARED income MUST inherit SHARED visibility and be visible to the same viewers as the source income. Shared incomes are legacy-only after the redesign (no new shared-income capture exists — COMPARTIDO captures expenses), so the inheritance MUST keep applying to pre-existing shared incomes. A COMPARTIDO capture MUST register a shared expense split (see shared-expense-split) and MUST NOT create a SAVINGS movement.
(Previously: a COMPARTIDO capture registered a single SHARED EXPENSE with no SAVINGS movement.)

#### Scenario: Legacy shared income shares savings

- GIVEN a shared income registered before the redesign with a matching rule
- WHEN the split applies to it
- THEN the SAVINGS movement carries SHARED visibility like the net INCOME

#### Scenario: Compartido creates no SAVINGS movement

- GIVEN a COMPARTIDO-typed capture whose note matches a rule
- WHEN the preview saves
- THEN the shared expense split registers and no SAVINGS movement is created
