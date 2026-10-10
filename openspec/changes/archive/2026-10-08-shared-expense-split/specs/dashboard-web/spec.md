# Delta for Dashboard Web

## ADDED Requirements

### Requirement: Shared Split Amount Annotation

The dashboard MUST annotate the amount of any row whose `sharedTotal` is present with "parte de {total} compartido", in BOTH the movement-list "Monto" cell and the card view, rendering `sharedTotal` in es-AR currency. A row without `sharedTotal` MUST render its amount exactly as before with no annotation.

#### Scenario: List cell annotates a split row

- GIVEN a split row with amount 1000 and `sharedTotal` 2000
- WHEN the list renders
- THEN the amount cell shows "$ 1.000" plus "parte de $ 2.000 compartido"

#### Scenario: Card view annotates a split row

- GIVEN the same split row in the card view
- WHEN the card renders
- THEN the amount annotation "parte de $ 2.000 compartido" appears

#### Scenario: Non-split rows unannotated

- GIVEN a movement with no `sharedTotal`
- WHEN its amount renders
- THEN no annotation appears
