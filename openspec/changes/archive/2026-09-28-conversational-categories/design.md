# Design: Conversational Categories

## Technical Approach

Three mechanisms implementing the proposal (B1+B2, A1, C1, D1+D3): (1) conservative Spanish plural fold `normalizeForMatchTolerant`, per-token on **both sides** of category/savings matching — literal `normalizeForMatch`/`boundaryRegex` exports byte-identical; (2) reserved-concept + duplicate-variant guard in `CategoryService.createCategory`/`renameCategory`, the choke point all five creation paths funnel through; (3) envelope `planned` flag mirroring `shared`, merged prefix-wins by OR.

## Architecture Decisions

| # | Decision | Choice | Rejected (why) |
|---|----------|--------|----------------|
| 1 | Tolerant fold | New `normalizeForMatchTolerant`; `matchCategory` and savings `matchNote` fold note + keyword at regex-build time | Fold inside `normalizeForMatch` (load-bearing for commands/dedupe/scoring/D3, C14) |
| 2 | Rule set | Research §5.2 verbatim (Lucene `SpanishPluralStemmer` model): len≥4, exclusions §7.2, specials §5.3, 13 ordered rules, one application | Snowball/light stemmers (C8/C9); minimal stripper (C10) |
| 3 | Reserved guard | Folded set `{previsto, gasto fijo, ahorro, compartido, compartida, otro}` + guard-only alias `provisto→previsto`; in create/rename **after** exact-ahorro, **before** availability; exact `ahorro` keeps the SAVINGS upsert; delete untouched | Per-path guards (choke point covers all 5); delete guard (phantoms stay deletable) |
| 4 | Error channel | `ReservedCategoryError extends ValidationFailedError` with `concept`; per-concept redirect reply; executor code `"reserved"` | Plain `ValidationFailedError` (no discriminator) |
| 5 | Duplicate-variant | `assertNameAvailable` folded; error names the **existing** category | DB unique index (exact-name, migration) |
| 6 | Variant resolution | D6 rule 1, `resolveAwaitingCategory`, `resolveTargetCategory`: exact → folded match **before** auto-create; `resolveSuggestion` stays exact | Redirect-on-guard (variants mean the existing category; guards back true creates) |
| 7 | Envelope `planned` | Mirror of `shared`; prompt key list + instruction + few-shot; `plannedByPrefix \|\| envelope.planned === true`; merged value persisted in the confirmation payload (schema already has it) | Prefix loosening (start-anchored exactness is the AD6 safety property) |
| 8 | LLM ceiling | `resolveSuggestion` exact + otro fallback; planned materializes only in `registerWithCategory`'s deterministic PENDING tail | Tolerant suggestion resolution (spec pins exact) |

## Data Flow

Guarded create (all five paths):

```
path ──→ createCategory(ownerId, name)
   1 exact "ahorro"     → ensureAhorro (SAVINGS upsert, unchanged)
   2 folded ∈ reserved  → ReservedCategoryError(concept)
   3 folded == existing → ValidationFailed("X exists")
   4 create NORMAL
error → telegram catch (BEFORE ValidationFailedError catch) → reservedCategoryReply(name, concept) → redirect, no category, pending stays open (movement in "otro")
```

Planned registration:

```
msg → parseArrivalPrefixes{planned?} → brain → envelope{planned?}
  → executeRegistration: planned = prefixPlanned || envelope.planned === true
  → registerWithCategory: planned → EXPENSE + PENDING, never splits
```

## File Changes (all under `apps/api/src/features/`)

| File | Action | Description |
|------|--------|-------------|
| `categories/matcher.ts` | Modify | Add `foldSpanishPluralToken`, exclusion/special consts, `normalizeForMatchTolerant`; `matchCategory` folds both sides. Exports unchanged |
| `categories/reserved.ts` | Create | `ReservedConcept`, folded set, alias map, `resolveReservedConcept`, `ReservedCategoryError` |
| `categories/categories.service.ts` | Modify | Guards in create/rename; folded `assertNameAvailable`. Delete untouched |
| `savings/savings.service.ts` | Modify | `matchNote` folds both sides. `defineRule`/`computeSplit` untouched |
| `telegram/bot-brain.ts` | Modify | Envelope+schema `planned`; prompt key list + planned instruction (mirror `shared` wording) + few-shot; `CategoryCommandErrorCode` + `"reserved"` |
| `telegram/telegram.service.ts` | Modify | planned merge in `executeRegistration`/`askAmountConfirmation`; folded dialog resolution; gated auto-creates (D6 rule 3 + resolve single-token) with redirect catches, state open; setup collects redirects; `registrar`/`rename` commands catch reserved first |
| `telegram/movement-corrector.ts` | Modify | `resolveTargetCategory`: exact → folded → guarded create; `CorrectionResult` + `{status:"rejected", concept, name}`, short-circuits before scoring |
| `telegram/category-executor.ts` | Modify | Catch `ReservedCategoryError` → code `"reserved"`, message from `reservedCategoryReply` |
| `telegram/reply-text.ts` | Modify | `reservedCategoryReply(name, concept)`; setup-done-with-redirects; template `"reserved"` branches |
| `telegram/__goldens__/*` | Regenerate | `interpret-system-prompt.txt` + `interpret-few-shots.json` change; all 8 re-run `vitest -u` in-cycle |

## Interfaces / Contracts

```ts
// matcher.ts additions (existing exports untouched)
export function foldSpanishPluralToken(token: string): string;    // rules 0–13, single application
export function normalizeForMatchTolerant(value: string): string; // normalizeForMatch → split /[^a-z0-9]+/ → fold each → join " "
// matchCategory internal: boundaryRegex(normalizeForMatchTolerant(rule.keyword)).test(normalizeForMatchTolerant(note))

// reserved.ts
export type ReservedConcept = "previsto" | "gasto fijo" | "ahorro" | "compartido" | "compartida" | "otro";
export function resolveReservedConcept(name: string): ReservedConcept | null; // folds + guard-only alias
export class ReservedCategoryError extends ValidationFailedError { readonly concept: ReservedConcept }

// bot-brain.ts
ConversationEnvelope.planned?: boolean; // schema: z.boolean().default(false)
```

Rule order (normative, research §5.2): 0 len<4 → 1 excluded → 2 special strip-es → 3 s-after-consonant → 4 -ques/-guis/-gues → 5 V+r+es → 6 V+[dlnx]+es → 7 [yu]+es → 8 [ulrtn]+ies → 9 -ses → 10 V+is→…y → 11 -dis→…y → 12 -ces→…z → 13 V+s.

Redirect replies per concept: previsto → teach `previsto: <monto> <nota>`; gasto fijo → "gastos fijos van como previstos" + prefix + `query_planned`; ahorro → SAVINGS + `registrar ahorro:` command; compartido → teach `compartido:` prefix; otro → fallback explanation. Duplicate-variant reuses `duplicateCategoryReply(existingName)`.

## Testing Strategy

| Layer | What | Where |
|-------|------|-------|
| Unit | Fold: meses→mes, cafes→cafe (never caf), luces→luz, jerseis→jersey, pies/pie; exclusions unchanged (lunes, crisis, frances, entrenuts self-fold); gasto fijo↔gastos fijos both ways; cafe2go no-match | `matcher.test.ts` |
| Integration | Reserved create/rename per concept (incl. provisto, otros, compartidos); ahorros → SAVINGS redirect, no upsert, no NORMAL; exact ahorro → SAVINGS; variant create/rename rejected naming existing; phantoms deletable | `categories.service.integration.test.ts`, `categories.service.savings.integration.test.ts` |
| Unit | Savings: sueldos↔sueldo both sides; stored "sueldos" matches both; entrenuts self-consistency — existing "entrenut" no-match fixture flips to a match (true singular); replace with a non-folding non-match (e.g. "entrenutsa") | `savings.service.test.ts` |
| Unit | Envelope: planned decodes / defaults false / malformed → null; prompt pins planned teaching; 8 goldens regenerated | `bot-brain.test.ts` + `__goldens__/` |
| Unit | Funnel: redirect per path (command; dialog token — state open, movement in otro —; setup entry; then_reassign); folded dialog resolution ("cafes"→"Cafe"); planned flag → PENDING; prefix beats flag:false; brain-absent prefix path | `telegram.service.test.ts`, `category-executor.test.ts`, `movement-corrector.test.ts`, `reply-text.test.ts` |
| Integration | "cobré sueldos" splits with a sueldo rule (money-behavior pin); planned e2e with the brain flag | `telegram.service.savings.test.ts`, `telegram.service.integration.test.ts` |

Spec→tests: `conversational-categories` & `movement-categories` → matcher + categories.service.integration; `telegram-bot` → telegram.service + category-executor + movement-corrector; `savings` → savings.service + telegram.service.savings; `bot-brain` → bot-brain.test.ts + goldens.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration. No DB change; phantoms remain deletable. Rollback: revert merged PRs.

## Open Questions

- None blocking. Apply decides the final planned few-shot count (1–2).
