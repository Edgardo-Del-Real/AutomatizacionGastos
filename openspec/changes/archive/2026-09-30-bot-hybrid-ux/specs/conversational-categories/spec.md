# Delta for Conversational Categories

## REMOVED Requirements

### Requirement: Gated Dialog Auto-Create

(Reason: decision #3 removes free-text auto-create; the single-token dialog cascade is the last path that can mint phantom categories from dialog replies.)
(Migration: dialog answers in `awaiting_category` and `awaiting_registration` now resolve against the closed set or the category buttons — see ADDED "Dialog Category Answers (Closed Set)"; the guard normalization requirement stays for abandon/affirmation routing.)

## ADDED Requirements

### Requirement: Dialog Category Answers (Closed Set)

The system MUST resolve dialog category answers (`awaiting_category`, `awaiting_registration`) ONLY against the owner's closed category set: exact normalized match first, then folded-plural match. An answer that matches no category MUST NOT create one: the system MUST present the existing categories as inline buttons (with "otro" included) and MUST keep the state open. Guard-word replies ("no", "si", with or without punctuation, via `normalizeForMatchGuard`) MUST still route to the abandon/affirmation handling and MUST NOT create a category.

#### Scenario: Exact answer resolves

- GIVEN an owner in `awaiting_category` replies "Transporte" matching an existing category
- WHEN it is processed
- THEN the pending movement is reassigned and no category is created

#### Scenario: Unknown answer shows buttons

- GIVEN an owner in `awaiting_category` replies "Mascotas" matching no category
- WHEN it is processed
- THEN no category is created, the category buttons render, and the state stays open

#### Scenario: Guard word never creates

- GIVEN an owner in `awaiting_category` replies "si."
- WHEN it is processed
- THEN no category is created and the reply routes to the affirmation handling