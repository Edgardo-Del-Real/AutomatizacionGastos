# Delta for Quick Capture

## MODIFIED Requirements

### Requirement: Capture Preview with Save/Correct

On a parsed `monto+nota` in `awaiting_capture`, the system MUST enter `awaiting_preview`, persist the payload `{amount, note, type, category: null|name, saveToken, savings?, sharedPercent?}` in `BotState.pendingNote`, and reply with "¿Guardamos? $ {amount} ({note})" plus the owner's existing NORMAL category buttons (excluding "otro" and "ahorro"), a `➕ Crear categoría` button, and the inline keyboard `[✅ Guardar] [✏️ Corregir]`. `✅ Guardar` MUST execute only after a category is selected and, for a partner-present COMPARTIDO, a percent is also chosen (see shared-expense-split). `✏️ Corregir` MUST abandon the preview and let the owner resend the capture text. A corrupt preview payload MUST recover by abandoning to `idle` without registering anything.
(Previously: the persisted payload carried no optional `sharedPercent` field and `✅ Guardar` was gated on the category alone.)

#### Scenario: Preview shows the parsed facts and category buttons

- GIVEN capture type PENDING and parsed "2500 alquiler"
- WHEN the preview is sent
- THEN it shows "¿Guardamos? $ 2.500 (alquiler)" with category buttons (no "otro"), ➕ Crear categoría, and [✅ Guardar] [✏️ Corregir]

#### Scenario: Guardar is gated until a category is chosen

- GIVEN an owner in `awaiting_preview` with no category selected
- WHEN they tap `✅ Guardar`
- THEN nothing registers and the preview asks for a category

#### Scenario: Compartido Guardar is also gated on the percent

- GIVEN a partner-present COMPARTIDO in `awaiting_preview` with a category and no percent
- WHEN the owner taps `✅ Guardar`
- THEN nothing registers and the preview asks to pick a percent first

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

The system MUST choose the movement type — REAL, PENDING, INGRESO, or COMPARTIDO — ONLY through the main-menu tap that started the capture; the type MUST be persisted with `awaiting_capture` and carried into the preview. The preview MUST NOT change the type (no type toggle exists). Saving with type PENDING MUST register a PENDING EXPENSE, type INGRESO an INCOME, type COMPARTIDO a split of two SHARED EXPENSES when a partner is resolved (a single SHARED EXPENSE otherwise), and type REAL a REAL EXPENSE. The LLM MUST NOT infer the type, and free text MUST NOT set it.
(Previously: type COMPARTIDO registered a single SHARED EXPENSE regardless of a partner; see shared-expense-split.)

#### Scenario: Menu type persists to the preview

- GIVEN an owner tapped `📅 Gasto previsto` and sends "2500 alquiler"
- WHEN the preview is sent
- THEN it shows the PENDING type and the payload carries type PENDING

#### Scenario: Save registers with the menu-chosen type

- GIVEN capture type REAL and preview "14000 pasaje" with a chosen category
- WHEN the owner taps `✅ Guardar`
- THEN a REAL EXPENSE registers with the previewed amount, note, and category

#### Scenario: Compartido registers a shared split

- GIVEN capture type COMPARTIDO with a resolved partner and preview "2000 super" with a chosen category and 50%
- WHEN the owner taps `✅ Guardar`
- THEN two SHARED EXPENSES summing to 2000 register

#### Scenario: Compartido without a partner stays single

- GIVEN capture type COMPARTIDO with no resolved partner and preview "2000 super"
- WHEN the owner taps `✅ Guardar`
- THEN a single SHARED EXPENSE registers

#### Scenario: Ingreso registers INCOME and splits savings

- GIVEN capture type INGRESO, a matching savings rule, and preview "cobro sueldo de entrenuts 1000"
- WHEN the owner taps `✅ Guardar`
- THEN an INCOME registers with the savings split (see savings) and the confirmation reports gross, net, and saved

#### Scenario: Preview has no type toggle

- GIVEN an owner in `awaiting_preview`
- WHEN the preview keyboard renders
- THEN no type button exists and the payload type stays as chosen at the menu
