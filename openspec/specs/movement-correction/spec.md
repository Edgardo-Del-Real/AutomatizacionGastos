# Movement Correction Specification

## Purpose

Free-form correction of past movements: the owner points at an already-registered movement ("esos 2500", "el uber de ayer") and names a category; the deterministic matcher resolves the reference to exactly one movement and reassigns it via `updateMovement`. Ambiguity is resolved by asking, never by guessing. The system MUST NEVER fabricate a movement, amount, or note.

## Requirements

### Requirement: Movement Correction Executor

The system MUST expose a deterministic movement-correction executor (`movement-corrector.ts`) driven by the `correct_category` intent: the brain extracts the target category and a movement reference (amount and/or note), the executor matches and reassigns, and the reply is written from the ACTUAL executed result. The executor MUST be the only path that reassigns past movements from free-form correction; the `awaiting_category` answer path reassigns the persisted pending movement directly and MUST NOT invoke the matcher.

#### Scenario: Free-form correction reassigns

- GIVEN owner text "esos 2500 → gastos hormiga" and exactly one recent 2500 movement
- WHEN the message is processed
- THEN that movement is reassigned to "gastos hormiga"
- AND the reply confirms the reassignment with the movement's facts

#### Scenario: No reference asks for one

- GIVEN a `correct_category` envelope with a category but no amount and no note
- WHEN the executor runs
- THEN nothing is reassigned
- AND the bot asks which movement to correct

### Requirement: Movement Reference Matching

Given a reference, the executor MUST search the owner's 10 most recent movements (by recency) and score candidates by exact amount equality, normalized note similarity, and recency (most recent wins ties). A single best candidate MUST be reassigned via `updateMovement`. Multiple candidates with an equal top score MUST NOT be reassigned; the system MUST ask which movement (see Ambiguity Resolution).

#### Scenario: Amount match unique

- GIVEN a reference amount 2500 and exactly one recent movement of 2500 with note "uber"
- WHEN the executor runs
- THEN that movement is reassigned to the target category

#### Scenario: Repeated amount disambiguated by note

- GIVEN two recent 2500 movements (notes "super" and "uber") and a reference amount 2500 with note "uber"
- WHEN the executor runs
- THEN only the "uber" movement is reassigned

#### Scenario: Repeated amount without note asks

- GIVEN two recent 2500 movements and a reference amount 2500 with no note
- WHEN the executor runs
- THEN nothing is reassigned
- AND the bot asks which 2500 movement to correct

#### Scenario: Empty window

- GIVEN no movements in the owner's recent window
- WHEN the executor runs
- THEN nothing is reassigned
- AND the bot replies that no matching movement was found

### Requirement: Ambiguity Resolution

When the matcher cannot resolve a single candidate, the system MUST ask which movement, listing each candidate with its date, amount, and note, and MUST NOT reassign anything until the owner picks. A reply matching one listed candidate MUST reassign it and close the question; any other reply MUST abandon the question with a clear reply, leaving every movement unchanged. (Exact persisted state value is a design decision.)

#### Scenario: Pick reassigns

- GIVEN the bot listed two 2500 candidates ("super" and "uber")
- WHEN the owner replies identifying the "uber" one
- THEN that movement is reassigned and the question closes

#### Scenario: Non-answer abandons

- GIVEN the bot asked which movement to correct
- WHEN the owner sends an unrelated reply
- THEN the question closes, nothing is reassigned, and the new text is processed normally

### Requirement: Correction Safety (Phantom Guard)

The executor MUST reassign only a movement resolved by the matcher or explicitly picked by the owner. A missing or deleted target movement MUST produce a clear "movement no longer exists" reply; the system MUST NOT create anything in its place.

#### Scenario: Missing movement degrades

- GIVEN the matched movement was deleted before the update
- WHEN `updateMovement` runs
- THEN a clear error reply is sent and nothing is created