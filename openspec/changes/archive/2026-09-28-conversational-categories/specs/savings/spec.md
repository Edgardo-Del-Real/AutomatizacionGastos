# Delta for savings

## ADDED Requirements

### Requirement: Tolerant Rule Matching

`matchNote` MUST apply the tolerant plural fold (`normalizeForMatchTolerant`) to BOTH the note and the stored rule keyword when deciding whether an income matches a savings rule. `defineRule` MUST keep storing the literal-normalized keyword (no data change, unique `[ownerId, keyword]` preserved). Split arithmetic and rounding MUST remain unchanged.

#### Scenario: Plural variant matches

- GIVEN a rule with keyword "sueldo" at 10%
- WHEN an income note "cobré sueldos" is matched
- THEN the rule matches and the split applies (INCOME 900, SAVINGS 100 on gross 1000)

#### Scenario: Brand stays self-consistent

- GIVEN a rule with keyword "entrenuts" at 10%
- WHEN an income note "entrenuts" is matched
- THEN it matches (both sides fold identically) and the split applies

#### Scenario: Stored keyword unchanged

- GIVEN an owner defines rule "sueldos" at 10%
- WHEN the rule is saved
- THEN the stored keyword remains "sueldos"
- AND later notes "sueldo" or "sueldos" both match it

#### Scenario: Split arithmetic unchanged

- GIVEN a tolerant match on gross 10.00 at 33%
- WHEN the split runs
- THEN savings 3.30 and net 6.70 (net + savings equals gross exactly)