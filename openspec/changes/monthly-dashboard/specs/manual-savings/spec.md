# Delta for Manual Savings

## MODIFIED Requirements

### Requirement: Balance Deduction Invariant

The summary MUST deduct manual savings from balance: `balance = income - expenses - manualSavings`, deducting only `savingsOrigin = MANUAL` rows within the requested period. AUTO_SPLIT and legacy rows MUST NOT be deducted (split months already store net income; subtracting them again would double-count). `kpis.savings` ("Ahorro") MUST count AUTO_SPLIT + MANUAL rows of the SAME requested period — it MUST NOT be pinned to the current calendar month, so a request for a past month reports that month's savings. Deleting a manual savings MUST remove its deduction (the money returns to Disponible).

(Previously: `kpis.savings` counted AUTO_SPLIT + MANUAL rows of the current calendar month regardless of the requested period, while `kpis.manualSavings` already followed the period.)

#### Scenario: Manual savings deduct from balance

- GIVEN INCOME 900, EXPENSE 300, and a MANUAL SAVINGS of 50 in the requested month
- WHEN the summary computes
- THEN balance = 550 (900 - 300 - 50) and `kpis.manualSavings` = 50

#### Scenario: Mixed month counts auto and manual

- GIVEN gross 1000 split into INCOME 900 and AUTO_SPLIT SAVINGS 100, EXPENSE 300, and a MANUAL SAVINGS of 50
- WHEN the summary computes for that month
- THEN balance = 550, `kpis.savings` = 150 (100 auto + 50 manual), and income = 900, expenses = 300

#### Scenario: Savings follow a past month

- GIVEN SAVINGS 150 in October and SAVINGS 200 in November
- WHEN the summary is requested for October
- THEN `kpis.savings` is 150, not 200

#### Scenario: Deleting manual savings returns the money

- GIVEN a MANUAL SAVINGS of 50 registered against INCOME 900 and EXPENSE 300
- WHEN the movement is deleted via `DELETE /movements/:id`
- THEN balance returns to 600 (900 - 300)
