# Delta for Movement Categories

## ADDED Requirements

### Requirement: Closed Category Set

The system MUST treat the owner's category list as a CLOSED set for bot-driven matching and capture: no bot interaction — quick capture, dialog answers, correction answers, or the LLM — MUST create a category from free text. Categories MUST be created ONLY through the explicit `registrar categoria:` command, the setup category list, or a `create_category` intent, all funneled through the guarded `CategoryService.createCategory`. Matching and capture MUST resolve only against existing categories; any note that matches nothing MUST fall back to "otro".

#### Scenario: Quick capture never creates

- GIVEN owner text "30000 alquiler" with no category keyword in the closed set
- WHEN the capture parser runs
- THEN no category is created and the message falls through to normal routing

#### Scenario: LLM never creates

- GIVEN a brain suggestion not in the closed set
- WHEN the registration is materialized
- THEN the movement falls to "otro" and no category is created

#### Scenario: Explicit command still creates

- GIVEN the owner sends "registrar categoria: Salud"
- WHEN it is processed
- THEN category "Salud" is created through the guarded path

### Requirement: Ghost Category Cleanup

The system MUST include, in this change, a one-off cleanup script that deletes the phantom categories "No.", "si", and "Borrar categoria: no" (and any other free-text phantoms discovered) and reassigns their movements to "otro". The script MUST support a `--dry-run` mode that only reports, MUST require an explicit write flag to apply changes, and MUST back up the database before applying. The script MUST NOT touch categories created through explicit commands.

#### Scenario: Dry-run reports without writing

- GIVEN phantom categories in the database
- WHEN the script runs with `--dry-run`
- THEN it lists the phantoms and writes nothing

#### Scenario: Apply reassigns orphans

- GIVEN the script runs with the write flag after a database backup
- WHEN it applies
- THEN the phantom categories are deleted and their movements are reassigned to "otro"

#### Scenario: Explicit categories untouched

- GIVEN the owner's real categories created through explicit commands
- WHEN the script runs
- THEN no explicit category is deleted or renamed