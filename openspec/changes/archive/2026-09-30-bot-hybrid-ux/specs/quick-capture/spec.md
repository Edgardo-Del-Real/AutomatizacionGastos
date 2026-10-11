# Quick Capture Specification

## Purpose

Deterministic fast path for expense capture: a pure parser extracts amount and note and resolves the category against the owner's CLOSED category set; on a match the bot shows a preview with `[✅ Guardar] [✏️ Corregir]` and the Real/Previsto type is chosen by button. The LLM is never invoked for a captured message and never decides the type.

## Requirements

### Requirement: Deterministic Capture Parser

The system MUST expose a pure `QuickCaptureParser` that, given owner text, extracts the amount via the shared amount parsers and resolves the category by keyword matching against the owner's CLOSED category set. A match MUST yield `{amount, note, category}`; a miss (no amount, or a category not in the closed set) MUST yield `null` and fall through to normal routing. The parser MUST NOT create categories, MUST NOT call the LLM, and MUST NOT write state.

#### Scenario: Amount plus closed-set category parses

- GIVEN owner text "30000 gym" and a closed set containing "Gimnasio" with keyword "gym"
- WHEN the parser runs
- THEN it yields amount 30000, note "gym", and category "Gimnasio"

#### Scenario: No amount misses

- GIVEN owner text "gym" with no amount
- WHEN the parser runs
- THEN it yields `null` and routing continues normally

#### Scenario: Keyword outside the closed set misses

- GIVEN owner text "30000 alquiler" and no category keyword matches "alquiler"
- WHEN the parser runs
- THEN it yields `null` and no category is created

### Requirement: Capture Preview with Save/Correct

On a parser match in `idle`, the system MUST enter `awaiting_preview`, persist the payload `{amount, note, category, type, saveToken}` in `BotState.pendingNote`, and reply with a preview showing amount, note, and category plus the inline keyboard `[✅ Guardar] [✏️ Corregir]`. `✏️ Corregir` MUST abandon the preview and let the owner resend the capture text. A corrupt preview payload MUST recover by abandoning to `idle` without registering anything.

#### Scenario: Preview shows the parsed facts

- GIVEN a parsed "30000 gym"
- WHEN the preview is sent
- THEN it shows amount 30000, note "gym", and category "Gimnasio" with `[✅ Guardar] [✏️ Corregir]`

#### Scenario: Corregir reopens capture

- GIVEN an owner in `awaiting_preview`
- WHEN they tap `✏️ Corregir`
- THEN the preview clears, the owner returns to `idle`, and a capture prompt replies

#### Scenario: Corrupt preview payload recovers

- GIVEN `pendingNote` holds invalid preview JSON
- WHEN any callback or message is processed
- THEN the preview abandons to `idle` with a clear reply and nothing registers

### Requirement: Type Selection by Button

The system MUST choose the movement type (REAL EXPENSE vs PENDING EXPENSE) ONLY through explicit buttons on the preview: a type button sets the payload type before saving. The LLM MUST NOT infer the type, and free text MUST NOT set it. Saving with type PENDING MUST register a PENDING EXPENSE (never SHARED).

#### Scenario: Previsto button switches the type

- GIVEN an owner in `awaiting_preview`
- WHEN they tap the Previsto button
- THEN the payload type becomes PENDING and the preview re-renders with the chosen type

#### Scenario: Save registers a REAL expense by default

- GIVEN an owner in `awaiting_preview` who tapped `[✅ Guardar]` without touching the type buttons
- WHEN the save executes
- THEN a REAL EXPENSE registers with the previewed amount, note, and category

#### Scenario: Save with Previsto registers PENDING

- GIVEN an owner in `awaiting_preview` who chose Previsto and then `[✅ Guardar]`
- WHEN the save executes
- THEN a PENDING EXPENSE registers and is never SHARED

### Requirement: Deterministic-First Ordering

In `idle`, the `QuickCaptureParser` MUST run BEFORE the bot brain for every non-command owner message. On a match, the preview flow runs and the brain MUST NOT be invoked for that message. On a miss, routing falls back to the brain (uncaptured intents only).

#### Scenario: Captured message skips the LLM entirely

- GIVEN owner text "30000 gym" that parses
- WHEN it is processed in `idle`
- THEN the preview shows and `interpret` is never invoked

#### Scenario: Miss falls back to the brain

- GIVEN owner text that does not parse
- WHEN it is processed in `idle`
- THEN the brain `interpret` is invoked as the fallback for the uncaptured intent

### Requirement: Save Idempotency

`✅ Guardar` MUST execute exactly once per preview: the persisted `saveToken` in the callback data MUST gate execution, a repeated Guardar callback MUST NOT register twice, and the second tap MUST reply "ya procesado".

#### Scenario: Repeated Guardar registers once

- GIVEN a Guardar callback whose save-token was already consumed
- WHEN it is processed again
- THEN no second movement registers and a "ya procesado" reply is sent