# Delta for Quick Capture

## ADDED Requirements

### Requirement: Savings Override Choice in Confirmation

For an INGRESO-typed preview only, the confirmation step MUST render a savings row with buttons `[5%] [10%] [Otro] [No apartar]`. When the note matches a savings rule, the row MUST show the suggested rule percent plus the choice buttons. Tapping a choice MUST update the confirmation in place; `[Otro]` MUST prompt for a percent text input and re-render with the entered percent; `[No apartar]` MUST set the disabled override. The choice MUST be persisted in the optional `savings` payload field and passed to the split on Guardar. The field MUST stay optional so persisted previews without it keep decoding and corrupt-payload recovery does not regress. Non-INGRESO captures MUST NOT show the row.

#### Scenario: Ingreso confirmation shows the savings row

- GIVEN an INGRESO preview with a picked category
- WHEN the confirmation renders
- THEN the savings row [5%] [10%] [Otro] [No apartar] appears

#### Scenario: Matched rule shows the suggested percent

- GIVEN the note matches rule "entrenuts" at 10%
- WHEN the confirmation renders
- THEN the row shows "Ahorro 10%" plus the choice buttons

#### Scenario: Otro accepts a percent and re-renders

- GIVEN the owner taps [Otro]
- WHEN they reply "15"
- THEN the confirmation re-renders showing savings at 15%

#### Scenario: Otro rejects an invalid percent

- GIVEN the owner taps [Otro]
- WHEN they reply "150" or a non-numeric text
- THEN a validation error re-prompts and no override is set

#### Scenario: No apartar disables savings for the income

- GIVEN the owner taps [No apartar]
- WHEN the preview saves
- THEN a whole INCOME registers and no SAVINGS movement is created

#### Scenario: Legacy preview payload still decodes

- GIVEN a persisted preview without a `savings` field
- WHEN it is decoded
- THEN it decodes as before and saves with no manual override

## MODIFIED Requirements

### Requirement: Capture Preview with Save/Correct

On a parsed `monto+nota` in `awaiting_capture`, the system MUST enter `awaiting_preview`, persist the payload `{amount, note, type, category: null|name, saveToken, savings?}` in `BotState.pendingNote`, and reply with "¿Guardamos? $ {amount} ({note})" plus the owner's existing NORMAL category buttons (excluding "otro" and "ahorro"), a `➕ Crear categoría` button, and the inline keyboard `[✅ Guardar] [✏️ Corregir]`. `✅ Guardar` MUST execute only after a category is selected. `✏️ Corregir` MUST abandon the preview and let the owner resend the capture text. A corrupt preview payload MUST recover by abandoning to `idle` without registering anything.
(Previously: the persisted payload was `{amount, note, type, category: null|name, saveToken}` with no optional savings field.)

#### Scenario: Preview shows the parsed facts and category buttons

- GIVEN capture type PENDING and parsed "2500 alquiler"
- WHEN the preview is sent
- THEN it shows "¿Guardamos? $ 2.500 (alquiler)" with category buttons (no "otro"), ➕ Crear categoría, and [✅ Guardar] [✏️ Corregir]

#### Scenario: Guardar is gated until a category is chosen

- GIVEN an owner in `awaiting_preview` with no category selected
- WHEN they tap `✅ Guardar`
- THEN nothing registers and the preview asks for a category

#### Scenario: Guardar registers after a category is chosen

- GIVEN an owner in `awaiting_preview` who selected "Transporte"
- WHEN they tap `✅ Guardar`
- THEN a movement registers with amount, note, type, and category "Transporte"

#### Scenario: Corregir reopens capture

- GIVEN an owner in `awaiting_preview`
- WHEN they tap `✏️ Corregir`
- THEN the preview clears, the owner returns to `awaiting_capture`, and a capture prompt replies

#### Scenario: Corrupt preview payload recovers

- GIVEN `pendingNote` holds invalid preview JSON
- WHEN any callback or message is processed
- THEN the preview abandons to `idle` with a clear reply and nothing registers