# Shared Expense Split Specification

## Purpose

Split a partner-present COMPARTIDO (PAID shared) capture end to end: the bot asks the sender's percent, parses a percent-or-amount answer, gates the save, and registers two SHARED EXPENSE rows that sum exactly to the total, each carrying `sharedTotal`. Shared PENDING capture is out of scope (`📅 Gasto previsto` stays INDIVIDUAL-only).

## Requirements

### Requirement: Shared Percent Question

For a COMPARTIDO capture with a resolved partner, the confirmation step MUST render a shared row `[50%] [25%] [75%] [Otro]` and MUST mirror the savings `sv:*` interaction: `sp:<pct>:<saveToken>` / `sp:other:<saveToken>` MUST carry only the save-token (never the percent), and every `sp:*` callback MUST be gated on `state === awaiting_preview` plus a matching `saveToken` (mismatch → "ya procesado"). `[Otro]` MUST persist the preview into `pendingNote`, set `awaiting_shared_percent`, and prompt for a value. With no partner, the capture MUST NOT show the row and MUST NOT ask. Captures other than COMPARTIDO MUST NOT show the row.

#### Scenario: Partner-present COMPARTIDO asks the percent

- GIVEN a COMPARTIDO capture with a resolved partner and a picked category
- WHEN the confirmation renders
- THEN the row [50%] [25%] [75%] [Otro] appears with token-only callbacks

#### Scenario: Percent choice re-renders in place

- GIVEN the shared row is shown
- WHEN the owner taps [50%]
- THEN the confirmation re-renders with 50% persisted as `sharedPercent`

#### Scenario: Otro prompts for input

- GIVEN the owner taps [Otro]
- WHEN the callback is processed
- THEN the state becomes `awaiting_shared_percent` and a value prompt replies

#### Scenario: Stale or ungated tap is rejected

- GIVEN an `sp:*` callback whose token does not match the open preview
- WHEN it is processed
- THEN "ya procesado" replies and nothing changes

#### Scenario: No partner asks nothing

- GIVEN a COMPARTIDO capture with no resolved partner
- WHEN the confirmation renders
- THEN no `sp:*` row appears and the legacy single-row path is kept

### Requirement: Shared Contribution Parser

`parseSharedContributionInput(input, total)` MUST resolve a percent valid only in `1..99`: a value with a `%` suffix MUST be a percent; a bare number `<= 100` MUST be a percent; a bare number `> 100` or a currency-formatted number (es-AR thousands such as `45.000`, or `$`/"ars") MUST be an amount whose percent is `amount / total * 100`. It MUST be valid only when the resolved percent is `1..99` (implied amount `> 0` and `< total`). Invalid input MUST re-prompt while keeping `awaiting_shared_percent` open.

#### Scenario: Percent suffix

- GIVEN input "30%" and total 40000
- WHEN parsed
- THEN the percent is 30

#### Scenario: Bare small number is a percent

- GIVEN input "25" and total 40000
- WHEN parsed
- THEN the percent is 25

#### Scenario: Bare large number is an amount

- GIVEN input "30000" and total 40000
- WHEN parsed
- THEN the percent is 75

#### Scenario: es-AR thousands amount

- GIVEN input "45.000" and total 90000
- WHEN parsed
- THEN the percent is 50

#### Scenario: Boundary invalid re-prompts

- GIVEN input "100", "0", or a value equal to the total
- WHEN parsed
- THEN it is invalid, no override is stored, and the prompt re-asks

### Requirement: Shared Save Gate

For a partner-present COMPARTIDO, `[✅ Guardar]` without a chosen percent MUST register nothing and MUST ask the owner to pick a percent first. A chosen percent MUST persist as the optional `sharedPercent` on the preview payload; the field MUST stay optional so persisted previews keep decoding and corrupt-payload recovery does not regress.

#### Scenario: Guardar without a percent blocks

- GIVEN a partner-present COMPARTIDO preview with a category and no `sharedPercent`
- WHEN the owner taps `✅ Guardar`
- THEN nothing registers and a reply asks to pick a percent first

#### Scenario: Guardar with a percent proceeds

- GIVEN the same preview with 50% chosen
- WHEN the owner taps `✅ Guardar`
- THEN the shared split registers

### Requirement: Shared Split Invariant

The split MUST use Decimal arithmetic: `senderPart = round2(total * pct / 100)` and `partnerPart = total − senderPart`, so `senderPart + partnerPart` MUST equal `total` exactly. No part may be negative or exceed the total.

#### Scenario: Exact sum

- GIVEN total 10.00 and 33%
- WHEN split
- THEN senderPart 3.30, partnerPart 6.70, and the sum is exactly 10.00

#### Scenario: Even half

- GIVEN total 40000 and 50%
- WHEN split
- THEN senderPart 20000 and partnerPart 20000

### Requirement: Two-Row Shared Registration

On save, a partner-present COMPARTIDO with a chosen percent MUST create exactly two SHARED EXPENSE rows in one transaction: the sender row (`amount = senderPart`) under the sender's ownerId and the partner row (`amount = partnerPart`) under the partner. Both rows MUST share the same `category`, `note`, `occurredAt`, currency `ARS`, status `PAID`, and `sharedTotal = total`; identical categories MUST be kept so per-category gross stays correct. With no partner, the capture MUST keep the legacy single SHARED row with `sharedTotal` null.

#### Scenario: Two rows registered

- GIVEN a partner-present COMPARTIDO "2000 super" at 50% with category "Super"
- WHEN the preview saves
- THEN a sender row of 1000 and a partner row of 1000 register with category "Super" and `sharedTotal` 2000

#### Scenario: No partner keeps legacy

- GIVEN a COMPARTIDO capture with no partner
- WHEN it saves
- THEN a single SHARED row registers and `sharedTotal` is null

#### Scenario: Shares reconcile to the total

- GIVEN any split registration
- WHEN both row amounts are summed
- THEN the sum equals `sharedTotal` exactly

### Requirement: sharedTotal Persistence and Contract

`Expense` MUST gain a nullable `sharedTotal Decimal(12,2)` through a plain-SQL migration with no backfill. `movementSchema` MUST expose `sharedTotal` additively, and the movements read path (SELECT, row type, mapper) MUST carry it. A NULL `sharedTotal` MUST render and behave exactly as before.

#### Scenario: Migration adds a nullable column

- GIVEN expenses exist before the migration
- WHEN the migration applies
- THEN every row has a NULL `sharedTotal` and no data changes

#### Scenario: Contract carries the field

- GIVEN a split row with `sharedTotal` 2000
- WHEN validated against `movementSchema`
- THEN it carries `sharedTotal` 2000 and legacy rows still validate

### Requirement: Shared Display Annotation

The dashboard amount cell and card MUST render a split row's `sharedTotal` as the original total below the share in italics (es-AR), and MUST show the owner badge on every `visibility=SHARED` row ("vos" for the viewer, otherwise the member name) so the two split halves are distinguishable. The bot confirmation for a split MUST carry its own "parte de {total} compartido" annotation.

#### Scenario: Dashboard annotation

- GIVEN a split row with amount 1000 and `sharedTotal` 2000
- WHEN the row renders
- THEN the amount shows "$ 1.000" with "$ 2.000" below it in italics

#### Scenario: Owner badge on shared rows

- GIVEN a SHARED row whose registrant is the viewer
- WHEN the row renders
- THEN the badge shows "vos"; a partner's SHARED row shows the partner's name

#### Scenario: Bot reply annotation

- GIVEN a split registration
- WHEN the confirmation is sent
- THEN it reports the sender share plus "parte de {total} compartido"

### Requirement: Documented Consequences

The change MUST document two accepted consequences. First, two SHARED rows replace one `total` row, so under `visibility=mine` a viewer's KPIs show only that viewer's share while `all`/`shared` still sum to `total`; per-viewer assertions MUST be used. Second, each half is an independent movement with no linking column, so editing or deleting one half leaves the other orphaned and the annotation no longer reconciles. Pair linking (`sharedGroupId`) is explicitly out of scope.

#### Scenario: Viewer-scoped KPI shift

- GIVEN a 1000/1000 split and the sender as viewer
- WHEN `GET /movements/summary?visibility=mine` runs
- THEN the viewer's expenses count only their 1000 share, while `visibility=all` sums to 2000

#### Scenario: Orphaned half

- GIVEN a split pair and one half deleted
- WHEN the dashboard re-renders
- THEN the remaining half stays and no linkage is repaired
