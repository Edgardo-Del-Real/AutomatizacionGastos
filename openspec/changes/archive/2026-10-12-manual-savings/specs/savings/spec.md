# Delta for Savings

## MODIFIED Requirements

### Requirement: KPI-Exclusion Invariants

SAVINGS movements MUST NOT contribute to income or expense totals, per-month/per-day buckets, category breakdowns, or top lists. Balance MUST equal net income − expenses − manual savings: the deduction MUST apply only to `savingsOrigin = MANUAL` rows. AUTO_SPLIT and legacy (NULL origin) SAVINGS rows MUST NOT be deducted from balance — split months already store net income, so subtracting them again would double-count.
(Previously: balance MUST equal net income − expenses with all SAVINGS excluded.)

#### Scenario: Savings never pollute KPIs

- GIVEN INCOME 900, SAVINGS 100, and EXPENSE 300
- WHEN KPIs compute
- THEN income = 900, expenses = 300, balance = 600, and the 100 never appears in any income or expense aggregate

#### Scenario: Manual savings deduct from balance

- GIVEN INCOME 900, EXPENSE 300, and a MANUAL SAVINGS of 50
- WHEN KPIs compute
- THEN balance = 550 (900 − 300 − 50) and the 50 appears in no income or expense aggregate

#### Scenario: Auto-split savings never double-count

- GIVEN gross 1000 split into INCOME 900 and AUTO_SPLIT SAVINGS 100, plus EXPENSE 300
- WHEN KPIs compute
- THEN income = 900, expenses = 300, balance = 600 — the AUTO_SPLIT 100 is not deducted again