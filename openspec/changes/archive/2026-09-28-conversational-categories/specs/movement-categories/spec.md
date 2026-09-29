# Delta for movement-categories

## MODIFIED Requirements

### Requirement: Keyword Learning and Matching

The system MUST match a movement note to a category via transport-agnostic keyword rules. Matching MUST be diacritic-insensitive and MUST use word-boundary semantics (a keyword MUST NOT match inside a larger word). Matching MUST additionally fold singular/plural variants: the keyword and the note are compared through `normalizeForMatchTolerant` (per-token conservative plural fold) on both sides, so a plural variant matches its singular keyword and vice versa. The first matching rule by a deterministic priority order MUST win; a note with no matching rule MUST NOT be auto-assigned (falls back to "otro").
(Previously: matching compared only literal normalized forms; plural variants never matched.)

#### Scenario: Word-boundary match

- GIVEN a category "Cafe" with keyword "cafe"
- WHEN a note "pague $500 en cafe2go" is matched
- THEN it does NOT match "cafe" (number inside a word is not a boundary match)
- And it falls back to "otro"

#### Scenario: Diacritic-insensitive match

- GIVEN a category "Cafe" with keyword "cafe"
- WHEN a note "tostado y cafe con leche" is matched
- THEN it matches "Cafe" despite the accented text

#### Scenario: First rule wins

- GIVEN rules "transporte" and "sube" both assigned to different categories
- WHEN a note containing both words is matched
- THEN the rule with higher priority order is applied

#### Scenario: No rule falls back

- GIVEN an owner with categories and no matching rule for a note
- WHEN the note is matched
- THEN the movement is assigned "otro"

#### Scenario: Plural variant matches both ways

- GIVEN a category "Gasto Fijo" with keyword "gasto fijo"
- WHEN a note "gastos fijos en el super" is matched
- THEN it matches "Gasto Fijo" (fold applied to note and keyword)
- AND a "gasto fijo" note matches the keyword "gastos fijos"

#### Scenario: Single-token plural folds

- GIVEN a category "Cafe" with keyword "cafe"
- WHEN a note "cafes" is matched
- THEN it matches "Cafe" (ordered rules fold "cafes"→"cafe", never "caf")

### Requirement: Category Type

The system MUST store a `type` field on every category (`NORMAL` default | `SAVINGS`). A category whose exact normalized name is "ahorro" MUST be created or upserted as `SAVINGS`, never `NORMAL`. A category whose folded name is "ahorros" MUST NOT be created as `NORMAL` nor upserted as `SAVINGS`: it MUST be rejected with a SAVINGS redirect (see Reserved and Duplicate-Variant Guards). The migration MUST auto-convert pre-existing "ahorro" categories to `SAVINGS` and MUST leave their movements untouched. The SAVINGS category MUST NOT be deletable or renamed. The system MUST ensure an "ahorro" `SAVINGS` category exists whenever a savings split would create a SAVINGS movement.
(Previously: only the exact normalized name "ahorro" was typed SAVINGS; "ahorros" was unguarded and created a NORMAL category.)

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

#### Scenario: Plural ahorros rejected, never SAVINGS

- GIVEN an owner creates "ahorros"
- WHEN processed
- THEN no category is created and a SAVINGS redirect replies
- AND exact "ahorro" still routes to SAVINGS

## ADDED Requirements

### Requirement: Reserved and Duplicate-Variant Guards

The system MUST reject, in `createCategory` and `renameCategory`, any name whose `normalizeForMatchTolerant` form is a member of the folded reserved set `{previsto, gasto fijo, ahorro, compartido, compartida, otro}`, including the guard-only alias `provisto`→`previsto` (the alias MUST NOT apply to general matching). The system MUST reject any name whose folded form equals the folded form of an existing same-owner category. Rejections MUST NOT create or mutate any category. `deleteCategory` MUST NOT gain reserved names — categories created before this change MUST remain deletable.

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

#### Scenario: Phantoms stay deletable

- GIVEN a pre-change "previsto" category exists
- WHEN the owner deletes it
- THEN the delete succeeds