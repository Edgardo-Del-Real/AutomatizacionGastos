# Delta for Movement Categories

## ADDED Requirements

### Requirement: Category Type

The system MUST store a `type` field on every category (`NORMAL` default | `SAVINGS`). A category whose normalized name is "ahorro" MUST be created or upserted as `SAVINGS`, never `NORMAL`. The migration MUST auto-convert pre-existing "ahorro" categories to `SAVINGS` and MUST leave their movements untouched. The SAVINGS category MUST NOT be deletable or renamed. The system MUST ensure an "ahorro" `SAVINGS` category exists whenever a savings split would create a SAVINGS movement.

#### Scenario: ahorro is always SAVINGS

- GIVEN "crear categoría ahorro"
- WHEN processed
- THEN a SAVINGS-typed "ahorro" category is created, never a NORMAL one

#### Scenario: Normal categories stay NORMAL

- GIVEN "crear categoría Salud"
- WHEN processed
- THEN a NORMAL category is created

#### Scenario: Legacy ahorro converts, movements untouched

- GIVEN a pre-existing NORMAL "ahorro" category with movements
- WHEN the migration runs
- THEN the category converts to `SAVINGS` and its movements are unchanged

#### Scenario: Delete and rename guards

- GIVEN the SAVINGS "ahorro" category
- WHEN an owner tries to delete or rename it
- THEN the operation is rejected

### Requirement: SAVINGS Category Assignment Guard

The category-validation used by movement writes MUST reject assigning the SAVINGS category to EXPENSE or INCOME movements; only SAVINGS movements MAY use it.

#### Scenario: Assignment rejected

- GIVEN an EXPENSE movement and the "ahorro" category
- WHEN the movement is written with that category
- THEN it is rejected with a validation error

#### Scenario: SAVINGS movement allowed

- GIVEN a SAVINGS movement
- WHEN it is written with the "ahorro" category
- THEN it succeeds