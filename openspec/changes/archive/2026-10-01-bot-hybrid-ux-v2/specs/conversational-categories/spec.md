# Delta for Conversational Categories

## MODIFIED Requirements

### Requirement: Dialog Category Answers (Closed Set)

The system MUST resolve capture and correction categories ONLY against the owner's closed category set and ONLY by button: the preview category row and the correction reassign row MUST render the owner's existing NORMAL categories as buttons, and the category MUST be selected by tapping one — never inferred from text. "otro" MUST NOT appear in the preview or reassign buttons (it is a legacy reserved row only). Since dialogs are removed, no text answer resolves a category and no guard-word handling applies to category selection.
(Previously: dialog answers in `awaiting_category`/`awaiting_registration` resolved exact-normalized then folded-plural against the closed set, with guard words and "otro" included in the button list.)

#### Scenario: Button pick resolves the category

- GIVEN an owner in `awaiting_preview`
- WHEN they tap the "Transporte" category button
- THEN "Transporte" is selected for the preview and the Guardar button becomes enabled

#### Scenario: otro excluded from the category row

- GIVEN an owner with the legacy "otro" row and other categories
- WHEN the preview category row renders
- THEN "otro" is absent and only NORMAL categories appear

#### Scenario: Text never selects a category

- GIVEN an owner in `awaiting_preview`
- WHEN they send a free-text message naming a category
- THEN no category is selected and the preview stays without a selection

## ADDED Requirements

### Requirement: Button-Chosen Categories

Categories for capture, correction, and admin MUST be selected or managed by inline buttons: the bot MUST NEVER infer a category from free text, and keyword rules MUST NOT be used by any bot path (the keyword data model stays intact for the dashboard). The LLM MUST NOT suggest categories for capture or editing.

#### Scenario: Capture category chosen by button only

- GIVEN an owner sends "14000 pasaje"
- WHEN the preview renders
- THEN the category is chosen from the buttons and no text or LLM inference occurs

#### Scenario: Keyword rules never consulted by the bot

- GIVEN the owner has keyword rules on categories
- WHEN any bot message is processed
- THEN no keyword rule is matched or used by the bot

#### Scenario: Correction reassign chosen by button only

- GIVEN the correction chain lists expenses and categories
- WHEN the owner picks a category button
- THEN the reassign uses only the picked category