# Conversational Categories Specification

## Purpose

Conversational category understanding "within reason": plural variants match, conversational planned phrasing works, and phantom categories never recur. This capability owns the cross-cutting reserved guards, the tolerant matcher, and the LLM ceiling that the category, savings, and bot features rely on.

## Requirements

### Requirement: Reserved Concept Guard

The system MUST reject, on every category-creation path, any category whose `normalizeForMatchTolerant` name is a member of the folded reserved set `{previsto, gasto fijo, ahorro, compartido, compartida, otro}`. Within the guard ONLY, the alias `provisto` MUST be treated as `previsto`; the alias MUST NOT apply to general matching. Rejections MUST NOT create any category and MUST produce an educational redirect (e.g., "usá 'previsto: monto nota'"). A folded `ahorros` MUST be rejected with a SAVINGS redirect and MUST NOT upsert; exact `ahorro` MUST keep the existing SAVINGS routing.

#### Scenario: Reserved create rejected on any path

- GIVEN any creation path with name "gastos fijos"
- WHEN processed
- THEN no category is created AND a redirect explains the system concept

#### Scenario: Guard-only alias

- GIVEN an owner creates "provisto"
- WHEN processed
- THEN it is rejected with the previsto redirect
- AND the alias never applies to general matching

#### Scenario: ahorros redirects to SAVINGS

- GIVEN an owner creates "ahorros"
- WHEN processed
- THEN no category is created, no SAVINGS upsert occurs, and a SAVINGS redirect replies
- AND exact "ahorro" still routes to SAVINGS

#### Scenario: Rename to reserved rejected

- GIVEN an owner renames a category TO "previsto"
- WHEN processed
- THEN the rename is rejected and the name is unchanged

### Requirement: Tolerant Plural Matching

The system MUST match keywords and notes through `normalizeForMatchTolerant`: per-token conservative plural fold with a len >= 4 guard, a ~110-word exclusion list, and 13 ordered rules (`-ses` before vowel+s; `-ces`→`-z`; stressed-singular exclusions), applied identically on both sides. `normalizeForMatch` and `boundaryRegex` MUST remain unchanged (load-bearing for commands, dedupe, correction scoring, and index slicing).

#### Scenario: Plural phrase matches both ways

- GIVEN keyword "gasto fijo"
- WHEN a note "gastos fijos en el super" is matched
- THEN it matches (per-token fold on both sides)
- AND a "gasto fijo" note matches keyword "gastos fijos"

#### Scenario: Ordered rules fold correctly

- GIVEN a note "meses" and keyword "mes", and "cafes" and keyword "cafe"
- WHEN matched
- THEN "meses" folds to "mes" and "cafes" folds to "cafe" (never "caf")

#### Scenario: Excluded words unchanged

- GIVEN notes "lunes", "crisis", "frances"
- WHEN matched
- THEN none of them folds (exclusion list preserves them)

#### Scenario: Short singulars preserved

- GIVEN a keyword "mes" (len < 4)
- WHEN matched
- THEN it never folds to "me", and "meses" folds onto it

### Requirement: Duplicate-Variant Rejection

The system MUST reject creating or renaming a category whose folded name (`normalizeForMatchTolerant`) equals the folded name of an existing same-owner category.

#### Scenario: Variant create rejected

- GIVEN a category "gasto fijo" exists
- WHEN the owner creates "gastos fijos"
- THEN it is rejected and no duplicate is created

#### Scenario: Variant rename rejected

- GIVEN a category "cafe" exists
- WHEN the owner renames another category TO "cafes"
- THEN the rename is rejected

### Requirement: Suggester Ceiling

The LLM MUST NOT create categories or planned status; it MAY only suggest them. Materialization MUST be deterministic and guarded.

#### Scenario: Suggestion never creates

- GIVEN the brain suggests a category not in the owner's list
- WHEN the registration is materialized
- THEN the movement falls to "otro" with a correction and no category is created

#### Scenario: Planned flag is a suggestion only

- GIVEN the brain returns `planned: true` with no `previsto:` prefix
- WHEN the registration is materialized
- THEN PENDING results only through the deterministic guarded path, never from the brain

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