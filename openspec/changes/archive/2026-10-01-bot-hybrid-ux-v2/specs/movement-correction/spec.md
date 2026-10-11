# Delta for Movement Correction

## MODIFIED Requirements

### Requirement: Movement Correction Executor

The system MUST expose a deterministic movement-correction flow entered ONLY from the `🧾 Administrar gastos` sub-menu (`✏️ Corregir categoría` button): the last expenses render as buttons, the owner picks one, the category buttons render, and picking a category reassigns via `updateMovement`; the reply is written from the ACTUAL executed result. The conversational `correct_category` intent is REMOVED — free text MUST NEVER trigger correction. There is no `awaiting_category` answer path.
(Previously: the executor was driven by the `correct_category` LLM intent with the brain extracting the target category and a movement reference.)

#### Scenario: Button-pick correction reassigns

- GIVEN an owner taps `✏️ Corregir categoría`, picks the "uber" movement, and taps "Transporte"
- WHEN the category pick is processed
- THEN the movement is reassigned to "Transporte", a confirmation with the movement's facts replies, and the menu returns

#### Scenario: No expenses to correct

- GIVEN the owner has no movements in the correction window
- WHEN they tap `✏️ Corregir categoría`
- THEN a clear "no hay gastos para corregir" reply is sent and the menu returns

#### Scenario: Free text never corrects

- GIVEN an owner in `idle` sends "esos 2500 → gastos hormiga"
- WHEN it is processed
- THEN no movement is reassigned and the message routes through idle free-text routing

### Requirement: Movement Reference Matching

Given a correction pick, the system MUST list the owner's 10 most recent movements EXCLUDING PENDING as the correction window (planned expenses are not correctable until marked paid, see planned-fixed-expenses), each showing its date, amount, and note. The owner MUST pick exactly one listed candidate by button.
(Previously: the executor scored recent movements by exact amount equality, normalized note similarity, and recency against a free-text reference.)

#### Scenario: Window lists recent non-PENDING movements

- GIVEN an owner with recent PAID movements
- WHEN the correction list renders
- THEN the 10 most recent PAID movements appear with date, amount, and note

#### Scenario: PENDING rows excluded from the window

- GIVEN an owner with PENDING and PAID movements
- WHEN the correction list renders
- THEN no PENDING movement appears

### Requirement: Ambiguity Resolution

Ambiguity is eliminated by explicit button picks: the system MUST NOT reassign anything until the owner picks a listed candidate, and MUST NOT reassign on any other input. A menu tap or an unrelated message during the pick MUST abandon the pick, leave every movement unchanged, and return to the menu.
(Previously: an ambiguity ask listed candidates and accepted a text reply matching one listed candidate, abandoning the question on any other reply.)

#### Scenario: Pick reassigns

- GIVEN the bot listed two 2500 candidates ("super" and "uber")
- WHEN the owner taps the "uber" button
- THEN only that movement is reassigned and the chain confirms

#### Scenario: Menu tap abandons the pick

- GIVEN the bot asked which movement to correct
- WHEN the owner taps a main-menu button instead
- THEN the pick closes, nothing is reassigned, and the chosen flow starts fresh