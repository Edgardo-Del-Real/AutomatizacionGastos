# Apply Progress: LLM Note Interpreter for Telegram Registration

Change: `llm-note-interpreter` · Branch: `feat/llm-note-interpreter` (based on `feat/bot-learning-improvements`, which is `dev` + the correction-loop slice the design targets) · Status: **success** — all 10 tasks complete, full gate green.

## Task Status

| Task | Status | Notes | Tests |
|------|--------|-------|-------|
| 1.1 Interpreter port & client | ✅ done | `note-interpreter.ts`: `NoteInterpreter`, `InterpretedNote`, `normalizeAmountString`, zod `interpretedNoteSchema`, `SYSTEM_PROMPT`, `GroqNoteInterpreter` (fetch POST, `AbortSignal.timeout`, 1 attempt, no retry, degrade-to-null, injectable `fetchImpl`) | driven by 1.2 |
| 1.2 Interpreter unit tests | ✅ done | fake `fetchImpl`, zero network: happy paths (string/number amount), non-JSON body, non-string content, HTTP 429/500, timeout (AbortError + AbortSignal passed), schema rejects (0 / -5 / "NaN" / missing / 61-char category / empty category), full `normalizeAmountString` table | 45 tests |
| 2.1 Env vars | ✅ done | 4 zod vars; invalid `LLM_BASE_URL` fails startup with zod config error (test in `env.test.ts`) | 6 new tests |
| 2.2 DI wiring | ✅ done | `app.ts` constructs `GroqNoteInterpreter` only when `GROQ_API_KEY` set; `TelegramServiceDeps.interpreter?` optional → deterministic-only otherwise | via 2.1 + service tests |
| 3.1 Bot state | ✅ done | `BOT_STATES` += `awaiting_amount_confirmation`; Prisma `state` is String — no migration | — |
| 3.2 Reply texts | ✅ done | `amountConflictReply(deterministic, llm)` (both via `formatARS`, voseo) + `amountConfirmationAbandonedReply()`; additive tests only | 2 new tests |
| 3.3 Service restructure | ✅ done | setup gate before interpreter; matched rule skips interpreter; keyword miss → suggestion + conflict check; rescue on parse failure; shared `registerWithCategory` / `registerOtroWithCorrection` tails; `amountConfirmationPayloadSchema` (exported) | driven by 4.2 |
| 3.4 Confirmation handler | ✅ done | `handleAwaitingAmountConfirmation` + `handleUpdate` route; decode via `safeParse`, `normalizeAmountString ?? parseAmount` reply matching, stored-context registration, abandon→clear→reprocess | driven by 4.2 |
| 4.1 Harness + existing assertions | ✅ done | `interpret: vi.fn()` in harness; matched-note and zero-categories cases assert interpreter not invoked | — |
| 4.2 Service unit cases | ✅ done | suggestion resolve/unknown/"otro"/null; rescue (resolved + otro variants, null→help); conflict ask + payload + both amounts; answers 5000 (both category variants); abandonment + reprocess; restart survival via schema payload; corrupted payload recovery; create-failure keeps question open; commands don't consume | 14 new tests |
| 4.3 Integration (stubbed) | ✅ done | `buildService(logger?, interpreter?)`; suggestion→seeded category; rescue 5000 from "compre mercaderia"; conflict row; restart-survival answer; abandonment. Real Prisma, never real Groq | 5 new tests |
| 5.1 Full gate | ✅ done | `pnpm --filter @rita/api test` 317/317 · typecheck 0 errors · lint 0 errors | 317 total |

## Test Evidence

- Baseline (pre-change): `pnpm --filter @rita/api test` → 17 files, 243 tests passed.
- Final: `pnpm --filter @rita/api test` → **18 files, 317 tests passed**.
- `pnpm --filter @rita/api typecheck` → exit 0.
- `pnpm --filter @rita/api lint` → exit 0 (0 problems).
- Integration DB: Postgres on localhost:5433 (`rita-postgres` container), DB `automatizacionrita_test` derived from `DATABASE_URL`; no 10s hook timeout trip.

## Divergences / Notes

1. **Branch base**: the task brief said "create `feat/llm-note-interpreter` from `dev`", but the design header explicitly names `feat/bot-learning-improvements` as the integration branch (base `dev`), and its 3 commits (correction-loop no-learning, non-blocking prompts) are the "today" behavior the design/specs reference. Branch created from `feat/bot-learning-improvements` HEAD to match the design; `dev` alone lacks that context. Documented here for the archive phase.
2. **Two existing unit tests gained category seeding** ("replies with help for an unparseable message", "keeps processing subsequent messages after a reply failure"): under the design's mandated order (zero-categories setup gate BEFORE the amount rescue), "hola" with no categories now triggers `awaiting_setup` instead of help. Seeding `otro` preserves each test's original intent; the order change itself is design-mandated (setup gate wins; interpreter never fires for category-less owners).
3. **`normalizeAmountString("1.234,567")` → 1234.567** per the design's "last separator is the decimal marker" rule (test expectation corrected accordingly — was my initial misreading).
4. `product` is validated but unused by the bot in this slice (dashboard follow-up, per non-goals). `parseAmount` import added to `telegram.service.ts` for the confirmation-reply matcher.

## Commits

| Commit | Scope |
|--------|-------|
| `ec531ad` feat(telegram): add NoteInterpreter port with Groq client | Phase 1 |
| `ea8e8d8` feat(config): add LLM env vars and conditional interpreter wiring | Phase 2 |
| `e023755` feat(telegram): wire interpreter into registration with amount-conflict flow | Phase 3 + 4.1/4.2 |
| `9e7ad1e` test(telegram): integration coverage for interpreter paths | Phase 4.3 |
| (pending) chore: apply-progress + tasks completion markers | Phase 5 |

## Next

- Verify phase: `sdd-verify` on `feat/llm-note-interpreter`.
- Archive phase: amend spec scenario text — "No amount rescued by the interpreter" (`telegram-bot/spec.md`) uses "gaste como 5 mil pesos", which the parser reads as **5** (CONFLICT path, per design); rescue inputs are genuinely unparseable (`"compre mercaderia"`, `"gaste cinco mil pesos"`, `"1234,50 cafe"`, `"$ 1.234,50 supermercado"`, `"1234.5 cafe"`). Also close the two open questions (conflict-answer third-amount semantics; category-renamed-between-ask-and-answer edge) per their design defaults.