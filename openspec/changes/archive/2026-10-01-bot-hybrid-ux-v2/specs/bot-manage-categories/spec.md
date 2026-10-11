# Bot Manage Categories Specification

## Purpose

The `🗂 Administrar categorías` sub-menu: create, rename, and delete categories with buttons and minimal text prompts, all funneled through the guarded `CategoryService`.

## Requirements

### Requirement: Sub-Menu Entry

The system MUST open the category admin sub-menu from the `🗂 Administrar categorías` main-menu button, rendering exactly three buttons — `➕ Crear categoría`, `✏️ Renombrar categoría`, `🗑 Borrar categoría`. Completed or abandoned operations MUST return to the main menu.

#### Scenario: Sub-menu opens from the main menu

- GIVEN an owner taps `🗂 Administrar categorías`
- WHEN the callback is processed
- THEN the three-button sub-menu renders

### Requirement: Create Category

The `➕ Crear categoría` button MUST prompt for a name; the next text MUST create the category through the guarded `CategoryService.createCategory` (reserved, duplicate-variant, and SAVINGS guards apply) and MUST confirm plus return to the menu. A rejected name MUST reply with the relevant redirect and return to the menu.

#### Scenario: Create confirms and returns to menu

- GIVEN the bot asked for a category name
- WHEN the owner replies "Gimnasio"
- THEN the category is created, a confirmation replies, and the menu returns

#### Scenario: Reserved name rejected

- GIVEN the bot asked for a category name
- WHEN the owner replies "previsto"
- THEN a redirect replies, no category is created, and the menu returns

#### Scenario: Duplicate name rejected

- GIVEN the owner already has a category "Gimnasio"
- WHEN they reply "Gimnasio" in the create prompt
- THEN the create is rejected and the menu returns

### Requirement: Rename Category

The `✏️ Renombrar categoría` button MUST list the owner's categories as buttons; picking one MUST prompt for the new name; the next text MUST rename through the guarded path (rename cascade included; reserved and duplicate-variant guards apply) and confirm plus return to the menu. The SAVINGS "ahorro" MUST NOT be renameable.

#### Scenario: Rename cascades and returns to menu

- GIVEN the owner picked a category and sent the new name
- WHEN the rename executes
- THEN the category and its movements are renamed, a confirmation replies, and the menu returns

#### Scenario: Rename to a reserved name rejected

- GIVEN the owner picked a category
- WHEN they send "gastos fijos" as the new name
- THEN the rename is rejected and the menu returns

### Requirement: Delete Category

The `🗑 Borrar categoría` button MUST list the owner's categories as buttons; picking one MUST prompt a confirmation; confirming MUST delete through the guarded path and return to the menu. The legacy reserved "otro" row and the SAVINGS "ahorro" MUST NOT be deletable.

#### Scenario: Delete confirms and returns to menu

- GIVEN the owner picked a category and confirmed
- WHEN the delete executes
- THEN the category is deleted and the menu returns

#### Scenario: Reserved category cannot be deleted

- GIVEN the owner picks "otro" or "ahorro"
- WHEN the delete is attempted
- THEN a clear rejection replies and the menu returns