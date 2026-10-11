# Delta for Quick Capture

## MODIFIED Requirements

### Requirement: Deterministic Capture Parser

The system MUST expose a pure parser that, given owner text, extracts the amount via the shared amount parsers and the note. It MUST yield `{amount, note}` and MUST NOT resolve, infer, or match any category — the category is chosen by button at the preview. Text with no parseable amount MUST yield `null`. The parser MUST NOT call the LLM and MUST NOT write state.
(Previously: the parser resolved the category by keyword matching against the owner's CLOSED category set and yielded `{amount, note, category}`.)

#### Scenario: Amount plus note parses

- GIVEN owner text "30000 gym"
- WHEN the parser runs
- THEN it yields amount 30000 and note "gym"

#### Scenario: No amount misses

- GIVEN owner text "gym" with no amount
- WHEN the parser runs
- THEN it yields `null` and the capture re-prompts for the amount

#### Scenario: Category is never inferred

- GIVEN owner text "30000 alquiler"
- WHEN the parser runs
- THEN it yields `{amount: 30000, note: "alquiler"}` with no category field

### Requirement: Capture Preview with Save/Correct

On a parsed `monto+nota` in `awaiting_capture`, the system MUST enter `awaiting_preview`, persist the payload `{amount, note, type, category: null|name, saveToken}` in `BotState.pendingNote`, and reply with "¿Guardamos? $ {amount} ({note})" plus the owner's existing NORMAL category buttons (excluding "otro" and "ahorro"), a `➕ Crear categoría` button, and the inline keyboard `[✅ Guardar] [✏️ Corregir]`. `✅ Guardar` MUST execute only after a category is selected. `✏️ Corregir` MUST abandon the preview and let the owner resend the capture text. A corrupt preview payload MUST recover by abandoning to `idle` without registering anything.
(Previously: the preview showed the pre-resolved category, included "otro", had a Real/Previsto type toggle row, and Guardar was not category-gated.)

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

### Requirement: Type Selection by Menu

The system MUST choose the movement type — REAL, PENDING, INGRESO, or COMPARTIDO — ONLY through the main-menu tap that started the capture; the type MUST be persisted with `awaiting_capture` and carried into the preview. The preview MUST NOT change the type (no type toggle exists). Saving with type PENDING MUST register a PENDING EXPENSE, type INGRESO an INCOME, type COMPARTIDO a SHARED EXPENSE, and type REAL a REAL EXPENSE. The LLM MUST NOT infer the type, and free text MUST NOT set it.
(Previously: the type was chosen by a toggle button inside the preview between REAL and PENDING only.)

#### Scenario: Menu type persists to the preview

- GIVEN an owner tapped `📅 Gasto previsto` and sends "2500 alquiler"
- WHEN the preview is sent
- THEN it shows the PENDING type and the payload carries type PENDING

#### Scenario: Save registers with the menu-chosen type

- GIVEN capture type REAL and preview "14000 pasaje" with a chosen category
- WHEN the owner taps `✅ Guardar`
- THEN a REAL EXPENSE registers with the previewed amount, note, and category

#### Scenario: Compartido registers SHARED

- GIVEN capture type COMPARTIDO and preview "2000 super" with a chosen category
- WHEN the owner taps `✅ Guardar`
- THEN a SHARED EXPENSE registers

#### Scenario: Ingreso registers INCOME and splits savings

- GIVEN capture type INGRESO, a matching savings rule, and preview "cobro sueldo de entrenuts 1000"
- WHEN the owner taps `✅ Guardar`
- THEN an INCOME registers with the savings split (see savings) and the confirmation reports gross, net, and saved

#### Scenario: Preview has no type toggle

- GIVEN an owner in `awaiting_preview`
- WHEN the preview keyboard renders
- THEN no type button exists and the payload type stays as chosen at the menu

### Requirement: Menu-Gated Capture Ordering

The parser MUST run ONLY on the message that follows a capture-type menu tap (`awaiting_capture` state). In `idle`, free text MUST NEVER start capture: it routes through idle classification per bot-free-text-routing, and the brain MUST NOT be invoked for capture or to decide the type.
(Previously: the parser ran on every non-command `idle` message before the brain, and a match started the preview flow.)

#### Scenario: Capture message skips the LLM entirely

- GIVEN an owner in `awaiting_capture` sends "30000 gym"
- WHEN the message is processed
- THEN the preview shows and `interpret` is never invoked

#### Scenario: Idle free text never starts capture

- GIVEN an owner in `idle` sends "14000 pasaje"
- WHEN the message is processed
- THEN an educational redirect teaches ➕ Nuevo gasto, no preview opens, and no movement registers

## ADDED Requirements

### Requirement: Create Category from Preview

The `➕ Crear categoría` button on the preview MUST open a category-name prompt (state `awaiting_category_name`); the next text MUST create the category through the guarded `CategoryService.createCategory` (reserved, duplicate-variant, and SAVINGS guards apply), and the preview MUST re-render with the new category selected. This flow MUST be available only to owners past setup — an owner in `awaiting_setup` MUST complete setup (or `/configurar categorias`) first.

#### Scenario: Create from preview selects the new category

- GIVEN an owner in `awaiting_preview` taps `➕ Crear categoría`
- WHEN they reply "Gimnasio"
- THEN "Gimnasio" is created and the preview re-renders with "Gimnasio" selected

#### Scenario: Reserved name rejected

- GIVEN the bot asked for a category name during preview
- WHEN the owner replies "previsto"
- THEN no category is created, a redirect replies, and the preview stays without a selection

#### Scenario: Duplicate name rejected

- GIVEN the owner already has a category "Gimnasio"
- WHEN the owner replies "Gimnasio" during preview create
- THEN the create is rejected and the preview stays without a selection