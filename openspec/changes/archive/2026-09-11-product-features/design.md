# Design: Learning categories, bot confirmations, dashboard corrections

## Technical Approach

Four slices on the existing vertical-slice pattern, one PR (user-accepted 4000-line budget): (1) new `features/categories` domain slice (entity, keywords, pure matcher); (2) telegram bidirectional (reply port, persisted per-owner state machine, commands); (3) movements writes (`PATCH`/`DELETE /movements/:id`, `GET /movements/categories`); (4) dashboard mutations + App-level refresh token. Sequence: migration+contracts → categories → movements endpoints ∥ telegram → dashboard. Strict TDD.

## Architecture Decisions

| # | Decision | Rejected alternative | Rationale |
|---|----------|---------------------|-----------|
| D1 | Category NAME = canonical identity; `Expense.category` stays nullable **string (name)**, not FK; keywords hold `categoryId` FK, expose name | FK (legacy NULL/seed-slug rows violate or need remap — spec pins untouched); ids in commands/PATCH (UX speaks names) | Rename cascade = one UPDATE; legacy safe; bot/PATCH/dropdown share one identity — no drift |
| D2 | Names stored as typed (trimmed); duplicates/matching compare **normalized** (lowercase+accent-folded); DB exact `@@unique([ownerId,name])` = race backstop; service rejects normalized dups with 422 | Storing normalized names (breaks spec spelling, e.g. "Mascotas") | "Café"/"cafe" as separate categories would fragment the diacritic-insensitive matcher |
| D3 | `normalizeForMatch` = lowercase + **length-preserving** accent fold (`ch.normalize("NFD").charAt(0)` per char). Commands match on normalized text; values sliced from **original** at same indices (preserves spelling) | Full NFD strip (length changes break index mapping); `Intl.Collator` (overkill) | ~3 lines; commands accept "categoría"/"Categoria" |
| D4 | Rules ordered `createdAt ASC, keyword ASC` — **oldest-learned wins**. Boundary regex on normalized note+keyword: `(?:^|[^a-z0-9])kw(?![a-z0-9])` (mirrors `INCOME_KEYWORD_REGEX`). No match → null → "otro" | Note-word-order (unstable); longest-first (opaque) | "cafe2go" blocked by digit lookahead; deterministic priority |
| D5 | New **`BotState`** table (`ownerId @id`, `state`, `pendingMovementId?`, `pendingNote?`); repo in `features/telegram/bot-state.repository.ts`. No FK on pending (deleted movement → reply "no existe", reset idle). **No timeout** — every message resolves state | Column on Category (wrong aggregate); in-memory (restart survival spec-pinned); timeout sweeper (no stuck state exists) | `pendingNote` keeps keyword learning deterministic even if movement is PATCHed meanwhile |
| D6 | **awaiting_category (LOCKED)**: ① normalized text == existing category name → ANSWER (multi-word names; beats amounts — category named "500" wins); ② parses as amount → NEW registration (single "8000" or "$8000 super"; new pending replaces old); ③ single token → ANSWER + auto-create; ④ else → registration path (unparseable → help). Commands checked **before** state consumption in all states | Amount-first (numeric answers would register phantom movements) | Resolves "mil"/"500" ambiguity; matches every spec scenario |
| D7 | Setup (spec-pinned): first registration with no categories **NOT persisted** → `awaiting_setup`; list reply (split newline/comma, trim, dedupe normalized, skip existing, create "otro") → idle; re-register. Zero names → re-ask, stay. `configurar categorias` appends | Persist-then-recategorize (spec says not persisted) | Spec-literal, simplest |
| D8 | Reply port: `handleUpdate(update, reply?: (text) => Promise<void>)`; bot wires `(text) => ctx.reply(text)` (flows via `bot.api` → offline middleware records). Reply failures caught+logged. Pure `reply-text.ts` builders + local `Intl es-AR` ARS formatter; notes truncated ~500 chars | Passing `ctx` (couples service to grammY); `sendReply` dep (no per-message binding) | Service stays grammY-free; integration tests inject recorder |
| D9 | Offline middleware: `buildOfflineBot` transformer **throw → record** `{method, payload}`, return `{ok:true, result:fakeMessage}`. **CRITICAL BUNDLE**: reply feature + this change = ONE TDD cycle (RED test fails while middleware throws) | Separate landing (reply tests red in between — violates spec) | Spec "Offline Testability" requirement |
| D10 | `PATCH`/`DELETE /movements/:id` via `x-owner-id` header (mutation convention); `GET /movements/categories` via `ownerId` query (GET convention); 404 missing/other-owner; `DELETE /expenses/:id` untouched | Idempotent 204 (breaks convention) | Follows existing slice patterns |
| D11 | `App.tsx` owns `refreshKey`; `useMovements`/`useMovementSummary` gain optional `refreshToken` dep (backward-compatible); mutations bump on success | react-query (pattern change); event bus; optimistic-only (stale KPIs) | Fits plain-hook codebase, minimal diff |
| D12 | PATCH semantics (pinned): null clears category/note, absent unchanged, amount positive, category validated against owner set (normalized) → 422 `ValidationFailedError`; excludes `type`/`occurredAt`. Answer-time reassign reuses `movementService.updateMovement` | Separate reassign path (duplicate validation surface) | One write path, same semantics |

## Data Flow

```
Owner            TelegramService              CategoryService         DB
  │ "$2500 cafe" │  parse → match rules ───────────────────────────> CategoryKeyword
  │              │  no match → ensureOtro → create (category=otro) ─> Expense
  │              │  state=awaiting_category(id, note) ──────────────> BotState
  │◄─"¿categoria?"─┘ reply port
  │ "Transporte" │  ① exact name → ANSWER (auto-create if unknown)
  │              │  movementService.updateMovement(id,{category}) ──> Expense
  │              │  learn firstSignificantWord(pendingNote) ────────> CategoryKeyword
  │              │  state=idle ─────────────────────────────────────> BotState
  │◄─"confirmado"─┘
```

`firstSignificantWord(note)` = first token containing a letter (skips "$500").

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/prisma/schema.prisma` | Modify | Add Category, CategoryKeyword, BotState |
| `apps/api/prisma/migrations/<ts>_category_keyword_bot_state/` | Create | Additive 3 tables + indexes; down = drop |
| `packages/contracts/src/index.ts` | Modify | `updateMovementSchema`, `ownerCategorySchema`, `categoryListSchema` |
| `apps/api/src/features/categories/{types,matcher,repository,service}.ts` (+tests) | Create | Slice: pure matcher, Prisma repo (rename in tx, ensureOtro), owner-scoped service + `assertOwnerCategory` |
| `apps/api/src/features/telegram/telegram.commands.ts` (+test) | Create | Pure `parseCommand` → 5 commands or null |
| `apps/api/src/features/telegram/reply-text.ts` (+test) | Create | Pure reply builders + ARS formatter |
| `apps/api/src/features/telegram/bot-state.repository.ts` | Create | BotStateRepository interface + Prisma impl |
| `apps/api/src/features/telegram/telegram.service.ts` (+tests) | Modify | State machine, commands, matcher, replies, category on create |
| `apps/api/src/features/telegram/telegram.bot.ts` / `.bot.test.ts` | Modify | Reply wiring; middleware throw → record |
| `apps/api/src/features/movements/movements.repository.ts` | Modify | `updateById` (updateMany+findFirst), `deleteById` (no type filter) |
| `apps/api/src/features/movements/movements.service.ts` | Modify | `updateMovement` (422 category), `deleteMovement` (404) |
| `apps/api/src/features/movements/movements.route.ts` (+test) | Modify | PATCH/DELETE `:id`, GET categories; options + `categoryService` |
| `apps/api/src/app.ts` | Modify | Wire CategoryService, BotStateRepository, MovementService |
| `apps/dashboard/src/infra/api.ts` (+test) | Modify | `request(method,body,headers)`, 204 short-circuit, 3 new fns |
| `apps/dashboard/src/features/movements/useMovementMutations.ts`, `useCategories.ts` (+tests) | Create | Mutation hooks; categories hook on refreshToken |
| `apps/dashboard/src/features/movements/MovementEditForm.tsx`, `ConfirmDialog.tsx` (+tests) | Create | Diff-only patch, dropdown, clear→null; confirm/cancel |
| `apps/dashboard/src/features/movements/{useMovements,useMovementSummary}.ts` | Modify | Optional refreshToken dep |
| `apps/dashboard/src/features/movements/MovementList.tsx`, `App.tsx` (+tests) | Modify | Row actions; App owns refreshKey |

No deletions.

## Interfaces / Contracts

```prisma
model Category { id String @id @default(cuid()); ownerId String; name String
  createdAt DateTime @default(now()); keywords CategoryKeyword[]
  @@unique([ownerId, name])  @@index([ownerId]) }
model CategoryKeyword { id String @id @default(cuid()); categoryId String
  keyword String   // stored normalized
  ownerId String;  createdAt DateTime @default(now())
  category Category @relation(fields: [categoryId], references: [id])
  @@unique([ownerId, keyword])  @@index([ownerId]) }
model BotState { ownerId String @id
  state String   // idle | awaiting_setup | awaiting_category
  pendingMovementId String?; pendingNote String?
  updatedAt DateTime @updatedAt }
```

```ts
// contracts
export const updateMovementSchema = z.object({
  amount: z.number().positive().optional(),
  note: z.string().min(1).nullable().optional(),
  category: z.string().min(1).nullable().optional(),
}).refine((d) => Object.values(d).some((v) => v !== undefined),
  { message: "at least one field is required" });
export const ownerCategorySchema = z.object({ name: z.string(), keywords: z.array(z.string()) });
export const categoryListSchema = z.array(ownerCategorySchema);

// telegram
type ReplyPort = (text: string) => Promise<void>;
handleUpdate(update: unknown, reply?: ReplyPort): Promise<void>;
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | Matcher (fold, "cafe2go", diacritics, priority, firstSignificantWord); command parser (accents/case, null fall-through); reply texts; `updateMovementSchema` (in apps/api — contracts pkg has no runner) | vitest RED first |
| Unit | State machine transitions, mocked repos + recorded reply fn; reply failure logged | `telegram.service.test.ts` |
| Integration (PG 5433) | Category CRUD, dup 422, rename cascade (tx), idempotent associate, otro, cross-owner | `categories.service` test |
| Integration | Bot flows: setup, correction loop (answer/auto-create/amount-is-registration/restart survival), learned keyword auto-matches | `telegram.service.integration.test.ts` |
| Integration | Routes: PATCH/DELETE both types, 404s, 422 category, null clears, absent unchanged, empty patch; GET categories | `movements.route.test.ts` |
| Offline bot | Reply payload recorded, zero network; bundle test (reply + middleware same cycle) | `telegram.bot.test.ts` |
| Dashboard (jsdom) | api client (method/body/headers, 204); edit form (dropdown, diff-patch, null, invalid blocked); confirm dialog; refreshKey refetches list+summary | vitest + Testing Library |

## Threat Matrix

All rows N/A — no executable/doc-like path classification, no `git -C`/repo selection, no commit/push/PR automation, no shell/subprocess boundary. Bot "commands" are parsed app text → pure handlers; new HTTP routes are app CRUD with 422/404 failure semantics covered by RED tests above.

## Migration / Rollout

Single additive migration (3 CREATE TABLEs + indexes). No data migration — legacy NULL/seed-slug rows untouched; matcher applies to new bot messages only. Down-migration drops the 3 tables. Rollback = revert merge commit.

## Open Questions

- [ ] Should `MovementFilters`' free-text category filter become a dropdown (fed by GET categories)? Out of scope per spec — follow-up.
- [ ] "otro" is renameable (no special-case) — confirm desired.
