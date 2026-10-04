# Movement Categories Specification

## Purpose

Owner-scoped, user-defined movement categories that replace the fixed seed vocabulary. Categories are learned from the bot, matched transport-agnostically against movement notes via normalized word-boundary keyword rules, and drive the dashboard category breakdown. Each owner always has an automatic "otro" fallback category.

## Requirements

### Requirement: Category Entity and Ownership

The system MUST store categories scoped to a single owner (`ownerId`). Each category MUST have a unique name within its owner and a stable identifier. A category MUST NOT be visible to or usable by any other owner. Management operations MUST be owner-scoped.

#### Scenario: Owner-scoped creation

- Given an owner creates a category "Food"
- When the category is persisted
- Then it is stored under that owner only
- And another owner's category list does not contain it

#### Scenario: Unique name per owner

- Given an owner already has a category "Food"
- When the owner tries to create another "Food"
- Then the request is rejected with a validation error

### Requirement: Automatic "otro" Fallback

The system MUST NOT auto-create the "otro" category for new owners: the category is mandatory at the preview, so no bot movement falls back. A legacy "otro" row (created before the redesign) MUST remain as a reserved category for old movements, MUST be excluded from the preview and correction category buttons, and MUST NOT be deletable or renamed. No new movement is assigned "otro" by the bot.
(Previously: "otro" was auto-created for every owner at first setup and every unmatched movement fell back to it.)

#### Scenario: Setup creates no otro for new owners

- GIVEN an owner with no categories completes setup
- WHEN the categories are created
- THEN only the listed categories exist and no "otro" category is created

#### Scenario: Legacy otro row preserved and reserved

- GIVEN an owner with a pre-redesign "otro" row and movements in it
- WHEN the redesign is active
- THEN the row stays with its old movements and cannot be deleted or renamed

#### Scenario: No bot movement falls to otro

- GIVEN an owner in `awaiting_preview`
- WHEN they save with a chosen category
- THEN the movement registers with the chosen category and never with "otro"

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

### Requirement: Rename Cascade

When a category is renamed, the system MUST update the category's stored name AND MUST update every existing movement that references that category to the new name. After a rename, the category's keyword rules MUST remain attached to the (renamed) category.

#### Scenario: Rename updates movements

- Given a category "Cafe" referenced by two movements and one keyword rule
- When it is renamed to "Cafeteria"
- Then both movements now reference "Cafeteria"
- And the keyword rule remains attached to "Cafeteria"

### Requirement: Category Management Operations

The system MUST expose owner-scoped operations to list categories, create a category, rename a category, and associate a keyword (word) with a category. Listing MUST return each category's name and keyword rules. Creating MUST NOT create a duplicate name. Associating a keyword MUST apply only to future matching, and MUST be idempotent for the same (category, keyword) pair.

#### Scenario: List categories

- Given an owner with categories "Cafe" and "otro"
- When the owner lists categories
- Then both names and their keyword rules are returned

#### Scenario: Associate keyword

- Given an owner associates keyword "uber" with category "Transporte"
- When a later note contains "uber"
- Then it matches "Transporte"

#### Scenario: Duplicate association ignored

- Given keyword "uber" already associated with "Transporte"
- When the owner associates it again
- Then no duplicate rule is stored

### Requirement: Category Type

The system MUST store a `type` field on every category. New categories default to `MIXED`; explicit types are `INCOME`, `EXPENSE`, `MIXED`, and the reserved `SAVINGS` type. `NORMAL` remains readable for backwards compatibility and behaves as `MIXED`. A category whose exact normalized name is "ahorro" MUST be created or upserted as `SAVINGS`, never `NORMAL`. A category whose folded name is "ahorros" MUST NOT be created as `NORMAL` nor upserted as `SAVINGS`: it MUST be rejected with a SAVINGS redirect (see Reserved and Duplicate-Variant Guards). The migration MUST auto-convert pre-existing `NORMAL` categories to `MIXED`, classify unambiguous legacy income names such as "sueldo" and "sueldos" as `INCOME`, and leave movements untouched. The SAVINGS category MUST NOT be deletable or renamed. The system MUST ensure an "ahorro" `SAVINGS` category exists whenever a savings split would create a SAVINGS movement.
(Previously: only the exact normalized name "ahorro" was typed SAVINGS; "ahorros" was unguarded and created a NORMAL category.)

#### Scenario: ahorro is always SAVINGS

- GIVEN "crear categoría ahorro"
- WHEN processed
- THEN a SAVINGS-typed "ahorro" category is created, never a NORMAL one

#### Scenario: Normal categories stay NORMAL

- GIVEN "crear categoría Salud"
- WHEN processed
- THEN a MIXED category is created

#### Scenario: Income category cannot be used for expenses

- GIVEN a category "Sueldos" typed `INCOME`
- WHEN an EXPENSE movement is assigned to it
- THEN the assignment is rejected with a validation error

#### Scenario: Expense category cannot be used for income

- GIVEN a category "Comida" typed `EXPENSE`
- WHEN an INCOME movement is assigned to it
- THEN the assignment is rejected with a validation error

#### Scenario: Legacy salary category is normalized

- GIVEN a legacy category named "sueldos" without an explicit type
- WHEN the typed-category migration runs
- THEN the category is typed `INCOME`
- AND its existing movements are left untouched

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

### Requirement: Reserved and Duplicate-Variant Guards

The system MUST reject, in `createCategory` and `renameCategory`, any name whose `normalizeForMatchTolerant` form is a member of the folded reserved set `{previsto, ahorro, compartido, compartida, otro}`, including the guard-only aliases `provisto`→`previsto` and `provisorio`→`previsto` (the aliases MUST NOT apply to general matching; the plural fold already reduces "provisorios" to "provisorio", so one alias entry covers both forms). The category name `gasto fijo`/`gastos fijos` MUST remain available for fixed expenses and planned expenses. The system MUST reject any name whose folded form equals the folded form of an existing same-owner category. Rejections MUST NOT create or mutate any category. `deleteCategory` MUST NOT gain reserved names — categories created before this change MUST remain deletable.
(Previously: only `provisto` was a guard-only alias; "gasto provisorio" was not reserved and created a phantom category.)

#### Scenario: Reserved create rejected

- GIVEN an owner creates "previsto" (or "provisto", "compartido", "otro")
- WHEN processed
- THEN no category is created and a redirect explains the system concept

#### Scenario: Reserved rename rejected

- GIVEN an owner renames a category TO "previsto"
- WHEN processed
- THEN the rename is rejected and the name is unchanged

#### Scenario: Fixed-expense category can be created

- GIVEN the owner starts a planned-expense capture
- WHEN they create "gastos fijos"
- THEN the category is created as an EXPENSE category
- AND the movement remains PENDING until it is paid

#### Scenario: Provisorio alias rejected

- GIVEN an owner creates "gasto provisorio" (or "provisorio", "provisorios")
- WHEN processed
- THEN no category is created and the previsto redirect replies

#### Scenario: Phantoms stay deletable

- GIVEN a pre-change "previsto" category exists
- WHEN the owner deletes it
- THEN the delete succeeds
### Requirement: Closed Category Set

The system MUST treat the owner's category list as a CLOSED set for bot-driven capture: preview category rows and correction reassign rows MUST resolve only against existing categories. Categories MUST be created ONLY through the explicit button flows — the preview `➕ Crear categoría`, the `🗂 Administrar categorías` create flow, and the setup category list — all funneled through the guarded `CategoryService.createCategory`. No capture, pick, or text input MAY create a category from free text.
(Previously: creation channels were the `registrar categoria:` command, the setup list, and a `create_category` intent.)

#### Scenario: Preview never creates from the note

- GIVEN owner text "30000 alquiler" in `awaiting_capture`
- WHEN the preview renders
- THEN no category is created from the note and the category row lists existing categories only

#### Scenario: Preview create flows through the guarded path

- GIVEN an owner taps `➕ Crear categoría` in the preview
- WHEN they reply "Salud"
- THEN category "Salud" is created through the guarded `CategoryService.createCategory`

### Requirement: Ghost Category Cleanup

The system MUST include, in this change, a one-off cleanup script that deletes the phantom categories "No.", "si", and "Borrar categoria: no" (and any other free-text phantoms discovered) and reassigns their movements to "otro". The script MUST support a `--dry-run` mode that only reports, MUST require an explicit write flag to apply changes, and MUST back up the database before applying. The script MUST NOT touch categories created through explicit commands.

#### Scenario: Dry-run reports without writing

- GIVEN phantom categories in the database
- WHEN the script runs with `--dry-run`
- THEN it lists the phantoms and writes nothing

#### Scenario: Apply reassigns orphans

- GIVEN the script runs with the write flag after a database backup
- WHEN it applies
- THEN the phantom categories are deleted and their movements are reassigned to "otro"

#### Scenario: Explicit categories untouched

- GIVEN the owner's real categories created through explicit commands
- WHEN the script runs
- THEN no explicit category is deleted or renamed

### Requirement: Preview Category Selection

The capture preview MUST render the owner's NORMAL categories as buttons, excluding the legacy "otro" row and the SAVINGS "ahorro" category, and `✅ Guardar` MUST be gated until a category is selected. The preview MUST NOT infer a category from the note and MUST NOT offer "otro".

#### Scenario: Preview lists only NORMAL categories

- GIVEN an owner with NORMAL categories plus legacy "otro" and "ahorro"
- WHEN the preview category row renders
- THEN only the NORMAL categories appear and "otro"/"ahorro" are absent

#### Scenario: Guardar gated until selection

- GIVEN an owner in `awaiting_preview` with no category selected
- WHEN they tap `✅ Guardar`
- THEN nothing registers and the preview asks for a category