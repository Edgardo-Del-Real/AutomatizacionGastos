# Delta for Movement Correction

## MODIFIED Requirements

### Requirement: Movement Reference Matching

Given a reference, the executor MUST search the owner's 10 most recent movements (by recency, excluding PENDING movements — planned expenses are not correctable until marked paid, see planned-fixed-expenses) and score candidates by exact amount equality, normalized note similarity, and recency (most recent wins ties). A single best candidate MUST be reassigned via `updateMovement`. Multiple candidates with an equal top score MUST NOT be reassigned; the system MUST ask which movement (see Ambiguity Resolution).
(Previously: the search window included every recent movement; PENDING did not exist.)

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

#### Scenario: PENDING rows excluded from the window

- GIVEN a reference amount 2500, one PENDING 2500 movement, and no PAID 2500 movement in the window
- WHEN the executor runs
- THEN nothing is reassigned
- AND the bot replies that no matching movement was found