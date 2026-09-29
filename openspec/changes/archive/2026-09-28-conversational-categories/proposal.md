# Proposal: Conversational Categories

## Intent

Category understanding "within reason": plural variants match, conversational planned phrasing works, phantom categories never recur.

## Scope

### In Scope

- Reserved guard (B1+B2) in `createCategory`/`renameCategory` — single choke point, all five creation paths. Reserved set (folded): `previsto`, `gasto fijo`, `ahorro`, `compartido`/`compartida`, `otro`; alias `provisto→previsto`. Educational redirect on rejection ("usá 'previsto: monto nota'"). Folded `ahorros` → reject + redirect to SAVINGS, not upsert; exact `ahorro` keeps SAVINGS routing.
- Duplicate-variant guard (same choke point): folded name matching an existing category's folded name → rejected.
- Conservative plural fold (A1, Lucene `SpanishPluralStemmer` model): new `normalizeForMatchTolerant`; len ≥ 4 guard, ~110-word exclusion list, 13 ordered rules (`-ses` before vowel+s; `-ces`→`-z`; stressed-singular exclusions). `normalizeForMatch`/`boundaryRegex` unchanged (load-bearing). Shared scope: category + savings matching.
- Dialog auto-create gated (D1+D3): single-token convenience kept, routed through the guards.
- Conversational planned (C1): envelope `planned` field (mirror of `shared`); `previsto:` prefix wins over the flag; brain-absent keeps the prefix path.
- LLM ceiling: brain only suggests — never creates categories or planned status; materialization deterministic + guarded.
- Prompt/envelope change → 8 bot-brain goldens regenerate in-cycle (spec contract).
- `deleteCategory` gains no new reserved names — phantoms stay deletable.

### Out of Scope

- General typo tolerance in matching; prefix loosening; keyword learning on corrections; DB migrations; brain-owned writes.

## Capabilities

### New Capabilities

- `conversational-categories`: reserved guards + redirects, tolerant fold, duplicate-variant rejection, suggester ceiling, gated auto-create.

### Modified Capabilities

- `movement-categories`: tolerant matching; reserved + duplicate-variant guards (create/rename); delete unchanged.
- `telegram-bot`: creation funnels through the guarded choke point; redirect replies; `previsto:` prefix authoritative.
- `bot-brain`: envelope `planned`; prompt teaches the flag; prefix wins; goldens regenerate in-cycle.
- `savings`: `matchNote` tolerant (both sides); `defineRule` + splits unchanged.

## Approach

Exploration §Recommendation adopted (B1+B2; A1; C1; D1+D3); brain stays suggester.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/features/categories/matcher.ts` | Modified | fold + tolerant path; literal exports unchanged |
| `apps/api/src/features/categories/categories.service.ts` | Modified | reserved + duplicate guards; delete untouched |
| `apps/api/src/features/savings/savings.service.ts` | Modified | `matchNote` tolerant |
| `apps/api/src/features/telegram/` (service, corrector, executor, reply-text) | Modified | gated auto-create; planned plumbing; guard codes; redirects |
| `apps/api/src/features/telegram/bot-brain.ts` + `__goldens__/` | Modified | envelope `planned`; prompt; goldens regenerated |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Fold merges distinct words | Med | len ≥ 4 + exclusion list + fixtures (mes/meses, cafe/cafes) |
| 8 prompt goldens break | High | Regenerate in-cycle |
| Savings matching shifts splits | Med | Both-sides fold; sueldo/sueldos + entrenuts fixtures |
| Brain-absent divergence | Med | Prefix authoritative; both paths tested |

## Rollback Plan

Revert merged PRs. No DB migration — stored keywords, names, uniques unchanged; phantoms stay deletable.

## Dependencies

- PostgreSQL test DB (localhost:5433); `GROQ_API_KEY` optional.

## Success Criteria

- [ ] "gastos fijos" ↔ "gasto fijo" both ways; "meses"→"mes"; "cafes"→"cafe"; exclusions unchanged.
- [ ] Reserved create (any member + `provisto`) on any path → redirect, no phantom; "ahorros" → SAVINGS redirect; duplicate-variant rejected.
- [ ] Brain on: "quiero dejar un gasto previsto para el mes que viene…" → PENDING; prefix beats flag; brain off: prefix path works.
- [ ] Savings: "sueldos" matches "sueldo"; "entrenuts" self-consistent.
- [ ] 8 goldens regenerated in-cycle; suites green; delete guards unchanged.
