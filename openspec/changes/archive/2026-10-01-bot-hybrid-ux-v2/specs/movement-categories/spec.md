# Delta for Movement Categories

## MODIFIED Requirements

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

## ADDED Requirements

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