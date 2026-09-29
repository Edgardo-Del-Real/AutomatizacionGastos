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

### Requirement: Gated Dialog Auto-Create

The system MUST keep the single-token dialog auto-create convenience, routing it through the reserved and duplicate-variant guards. A rejected auto-create MUST reply with the redirect, MUST NOT create a category, and MUST keep the pending correction open.

#### Scenario: Passing token auto-creates

- GIVEN an owner in `awaiting_category` replies "Mascotas"
- WHEN processed
- THEN "Mascotas" is created and the pending movement is assigned to it

#### Scenario: Reserved token rejected

- GIVEN an owner in `awaiting_category` replies "previsto"
- WHEN processed
- THEN no category is created, a redirect replies, and the correction stays open

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