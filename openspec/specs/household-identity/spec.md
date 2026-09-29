# Household Identity Specification

## Purpose

Registry of household members (`ownerId`, name, chatId) that resolves Telegram chatIds to owners, exposes the member list to the dashboard, and powers the partner lookup used by viewer-scoped reads. The household is a fixed two-member duo configured via environment variables; when unconfigured, the system degrades to single-user mode (ownerId `default`, no partner).

## Requirements

### Requirement: Household Member Registry

The system MUST read household members from the `HOUSEHOLD_MEMBERS` environment variable, each entry carrying `ownerId`, `name`, and a `chatId` (positive integer). The registry MUST be zod-validated at startup; malformed entries MUST fail startup with a clear configuration error. When `HOUSEHOLD_MEMBERS` is unset, the system MUST run in single-user degraded mode with ownerId `default` and no partner. ChatIds MUST NOT be logged.

#### Scenario: Two members configured

- GIVEN `HOUSEHOLD_MEMBERS` lists Rita and Edgardo with valid chatIds
- WHEN the API starts
- THEN both members are registered with their ownerId, name, and chatId

#### Scenario: Malformed config fails fast

- GIVEN `HOUSEHOLD_MEMBERS` contains an entry with an invalid chatId
- WHEN the API starts
- THEN startup fails with a clear configuration error

#### Scenario: Unset degrades to single-user

- GIVEN `HOUSEHOLD_MEMBERS` is unset
- WHEN the API starts
- THEN single-user mode is active with ownerId `default` and no partner

### Requirement: Chat Resolution

The system MUST resolve a chatId to the matching member's ownerId deterministically. A chatId with no matching member MUST resolve to no owner.

#### Scenario: Known chat resolves

- GIVEN a member with chatId 123
- WHEN chatId 123 is resolved
- THEN the member's ownerId is returned

#### Scenario: Unknown chat resolves to none

- GIVEN a chatId not present in the registry
- WHEN it is resolved
- THEN no owner is returned

### Requirement: Household Members Endpoint

`GET /household/members` MUST return the household members as an array of `{ownerId, name}`. The response MUST NOT include chatIds. In single-user mode the endpoint MUST return a single member with ownerId `default`.

#### Scenario: Members returned without chatIds

- GIVEN a configured household with two members
- WHEN `GET /household/members` is called
- THEN both members return with ownerId and name only

#### Scenario: Single-user returns the default member

- GIVEN `HOUSEHOLD_MEMBERS` is unset
- WHEN `GET /household/members` is called
- THEN a single member with ownerId `default` returns

### Requirement: Partner Lookup

Given a member's ownerId, the system MUST resolve the partner's ownerId. In single-user mode there MUST be no partner.

#### Scenario: Partner resolved

- GIVEN members Rita and Edgardo
- WHEN Rita's partner is requested
- THEN Edgardo's ownerId is returned

#### Scenario: No partner in single-user mode

- GIVEN single-user mode with ownerId `default`
- WHEN the partner of `default` is requested
- THEN no partner is returned