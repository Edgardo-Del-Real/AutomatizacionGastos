# Delta for Conversational Categories

## ADDED Requirements

### Requirement: Punctuation-Stripped Guard Normalization

The system MUST provide `normalizeForMatchGuard` — `normalizeForMatch` plus punctuation stripping and whitespace collapse — and MUST use it for guard-set matching (`KEEP_OTRO_ANSWERS`, `CATEGORY_AFFIRM_ANSWERS`, `COLLECT_ABANDON_ANSWERS`) and for the single-token auto-create reject. `normalizeForMatch` MUST remain unchanged (its length-preserving contract is load-bearing for commands, dedupe, and correction scoring).

#### Scenario: Punctuation stripped from guard words

- GIVEN the reply "no." (or "si.", "no,")
- WHEN it is normalized through `normalizeForMatchGuard`
- THEN it matches the guard word "no" (or "si") and never reaches category creation

#### Scenario: Core matcher untouched

- GIVEN the punctuation-stripping normalization exists
- WHEN `normalizeForMatch` is invoked
- THEN its length-preserving contract is unchanged

## MODIFIED Requirements

### Requirement: Gated Dialog Auto-Create

The system MUST keep the single-token dialog auto-create convenience, routing it through the reserved and duplicate-variant guards. Before auto-create, the single token MUST be checked through `normalizeForMatchGuard`: a token that normalizes to a guard word ("no", "si", with or without punctuation) MUST route to the abandon/affirmation handling and MUST NOT create a category. A rejected auto-create MUST reply with the redirect, MUST NOT create a category, and MUST keep the pending correction open.
(Previously: the single-token cascade did not strip punctuation, so "no." and "si." fell through the guard sets and auto-created phantom categories.)

#### Scenario: Passing token auto-creates

- GIVEN an owner in `awaiting_category` replies "Mascotas"
- WHEN processed
- THEN "Mascotas" is created and the pending movement is assigned to it

#### Scenario: Reserved token rejected

- GIVEN an owner in `awaiting_category` replies "previsto"
- WHEN processed
- THEN no category is created, a redirect replies, and the correction stays open

#### Scenario: Punctuated guard word rejected

- GIVEN an owner in `awaiting_category` replies "si."
- WHEN processed
- THEN no category is created and the reply routes to the affirmation handling