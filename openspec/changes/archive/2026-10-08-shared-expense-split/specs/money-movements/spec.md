# Delta for Money Movements

## ADDED Requirements

### Requirement: Shared Total Movement Field

`Expense` MUST carry a nullable `sharedTotal Decimal(12,2)` recording the full gross the sender split from, set only on a shared-split row (see shared-expense-split). `@rita/contracts` MUST expose `sharedTotal` on `movementSchema` additively (optional, nullable). The additions MUST NOT change the shape or validation of any pre-existing movement field; a movement without `sharedTotal` MUST validate and behave exactly as before. The movements read path (SELECT, row type, mapper) MUST return `sharedTotal`.

#### Scenario: Split row carries sharedTotal

- GIVEN a split sender row of amount 1000 from a 2000 COMPARTIDO
- WHEN it is validated against `movementSchema`
- THEN it carries `sharedTotal` 2000

#### Scenario: Legacy row omits sharedTotal

- GIVEN a pre-existing movement with no `sharedTotal`
- WHEN it is validated against `movementSchema`
- THEN it validates and `sharedTotal` is absent or null

#### Scenario: Other movement fields unchanged

- GIVEN code importing `movementSchema`
- WHEN contracts rebuild
- THEN every pre-existing field and constraint is unchanged
