# Delta for Registration-Collection

## MODIFIED Requirements

### Requirement: Category-Answer Cascade

A category answer MUST resolve through the deterministic cascade in order: exact normalized match; folded-plural match; no auto-create — a single-token non-match MUST present the closed-set category buttons and STAY open (never auto-creates, never dead-ends); a multi-word non-match lists the existing categories as buttons and STAYS open.
(Previously: a single-token non-match auto-created the category through the guarded `CategoryService.createCategory` and completed the registration.)

#### Scenario: Exact match resolves

- GIVEN an owner in `awaiting_registration` asked for the category
- WHEN the owner replies "Transporte" matching an existing category
- THEN the registration completes with "Transporte" and the owner returns to `idle`

#### Scenario: Multi-word non-match lists buttons and stays open

- GIVEN an owner in `awaiting_registration` asked for the category
- WHEN the owner replies with a multi-word text matching no category
- THEN the bot presents the category buttons and the state stays open

#### Scenario: Single-token non-match shows buttons and never auto-creates

- GIVEN an owner in `awaiting_registration` replies "Mascotas" (not existing, not reserved)
- WHEN the cascade reaches the non-match step
- THEN no category is created, the category buttons render, and the state stays open