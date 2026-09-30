# Delta for Movement Categories

## MODIFIED Requirements

### Requirement: Reserved and Duplicate-Variant Guards

The system MUST reject, in `createCategory` and `renameCategory`, any name whose `normalizeForMatchTolerant` form is a member of the folded reserved set `{previsto, gasto fijo, ahorro, compartido, compartida, otro}`, including the guard-only aliases `provisto`→`previsto` and `provisorio`→`previsto` (the aliases MUST NOT apply to general matching; the plural fold already reduces "provisorios" to "provisorio", so one alias entry covers both forms). The system MUST reject any name whose folded form equals the folded form of an existing same-owner category. Rejections MUST NOT create or mutate any category. `deleteCategory` MUST NOT gain reserved names — categories created before this change MUST remain deletable.
(Previously: only `provisto` was a guard-only alias; "gasto provisorio" was not reserved and created a phantom category.)

#### Scenario: Reserved create rejected

- GIVEN an owner creates "gastos fijos" (or "previsto", "provisto", "compartido", "otro")
- WHEN processed
- THEN no category is created and a redirect explains the system concept

#### Scenario: Reserved rename rejected

- GIVEN an owner renames a category TO "previsto"
- WHEN processed
- THEN the rename is rejected and the name is unchanged

#### Scenario: Duplicate-variant create rejected

- GIVEN a category "gasto fijo" already exists
- WHEN the owner creates "gastos fijos"
- THEN it is rejected and no duplicate is created

#### Scenario: Provisorio alias rejected

- GIVEN an owner creates "gasto provisorio" (or "provisorio", "provisorios")
- WHEN processed
- THEN no category is created and the previsto redirect replies

#### Scenario: Phantoms stay deletable

- GIVEN a pre-change "previsto" category exists
- WHEN the owner deletes it
- THEN the delete succeeds