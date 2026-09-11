# Movement Categories Specification

## Purpose

Owner-scoped, user-defined movement categories that replace the fixed seed vocabulary. Categories are learned from the bot, matched transport-agnostically against movement notes via normalized word-boundary keyword rules, and drive the dashboard category breakdown. Each owner always has an automatic "otro" fallback category.

## Requirements

### Requirement: Category Entity and Ownership

The system MUST store categories scoped to a single owner (`ownerId`). Each category MUST have a unique name within its owner and a stable identifier. A category MUST NOT be visible to or usable by any other owner. Management operations MUST be owner-scoped.

#### Scenario: Owner-scoped creation

- Given an owner creates a category "Food"
- When the category is persisted
- Then it is stored under that owner only
- And another owner's category list does not contain it

#### Scenario: Unique name per owner

- Given an owner already has a category "Food"
- When the owner tries to create another "Food"
- Then the request is rejected with a validation error

### Requirement: Automatic "otro" Fallback

The system MUST automatically create a default category named "otro" for every owner (on first setup) if it does not exist. Any movement whose note matches no category rule MUST be assigned "otro". "otro" MUST be created alongside the owner's first category setup and MUST be listed in the category list.

#### Scenario: Fallback created at setup

- Given an owner has no categories
- When setup completes for that owner
- Then a category "otro" exists for that owner

#### Scenario: Unmatched movement falls back

- Given an owner with categories and a movement whose note matches no rule
- When the movement is created
- Then it is assigned the "otro" category

### Requirement: Keyword Learning and Matching

The system MUST match a movement note to a category via transport-agnostic keyword rules. Matching MUST be diacritic-insensitive and MUST use word-boundary semantics (a keyword MUST NOT match inside a larger word). The first matching rule by a deterministic priority order MUST win; a note with no matching rule MUST NOT be auto-assigned (falls back to "otro").

#### Scenario: Word-boundary match

- Given a category "Cafe" with keyword "cafe"
- When a note "pague $500 en cafe2go" is matched
- Then it does NOT match "cafe" (number inside a word is not a boundary match)
- And it falls back to "otro"

#### Scenario: Diacritic-insensitive match

- Given a category "Cafe" with keyword "cafe"
- When a note "tostado y cafe con leche" is matched
- Then it matches "Cafe" despite the accented text

#### Scenario: First rule wins

- Given rules "transporte" and "sube" both assigned to different categories
- When a note containing both words is matched
- Then the rule with higher priority order is applied

#### Scenario: No rule falls back

- Given an owner with categories and no matching rule for a note
- When the note is matched
- Then the movement is assigned "otro"

### Requirement: Rename Cascade

When a category is renamed, the system MUST update the category's stored name AND MUST update every existing movement that references that category to the new name. After a rename, the category's keyword rules MUST remain attached to the (renamed) category.

#### Scenario: Rename updates movements

- Given a category "Cafe" referenced by two movements and one keyword rule
- When it is renamed to "Cafeteria"
- Then both movements now reference "Cafeteria"
- And the keyword rule remains attached to "Cafeteria"

### Requirement: Category Management Operations

The system MUST expose owner-scoped operations to list categories, create a category, rename a category, and associate a keyword (word) with a category. Listing MUST return each category's name and keyword rules. Creating MUST NOT create a duplicate name. Associating a keyword MUST apply only to future matching, and MUST be idempotent for the same (category, keyword) pair.

#### Scenario: List categories

- Given an owner with categories "Cafe" and "otro"
- When the owner lists categories
- Then both names and their keyword rules are returned

#### Scenario: Associate keyword

- Given an owner associates keyword "uber" with category "Transporte"
- When a later note contains "uber"
- Then it matches "Transporte"

#### Scenario: Duplicate association ignored

- Given keyword "uber" already associated with "Transporte"
- When the owner associates it again
- Then no duplicate rule is stored