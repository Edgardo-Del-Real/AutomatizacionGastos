# Design: Web Dashboard (read-only metrics + expense list)

## Technical Approach

Add new workspace `apps/dashboard` (`@rita/dashboard`) — Vite + React 19 SPA, vitest 4 (jsdom) + Testing Library, recharts. Consumes `@rita/contracts` (compiled `dist`, build-first) and the existing Fastify API via Vite dev proxy `/api → http://localhost:3000` (no API/CORS change — CORS `origin:true` already in `apps/api/src/app.ts`). Owner fixed by `VITE_OWNER_ID` (default `"default"`). Two vertical slices `features/{metrics,expenses}/` mirror the API `features/expenses/` convention; typed client `infra/api.ts` zod-validates every response; custom hooks own loading/empty/error/retry. Satisfies `openspec/specs/dashboard-web/spec.md` requirements 1–6.

## Architecture Decisions

| # | Choice | Alternatives | Rationale |
|---|--------|--------------|-----------|
| 1 | Vite + React 19 SPA in new `apps/dashboard` | Next.js/Remix; SSR HTML | pnpm `apps/*` monorepo; `pnpm-workspace.yaml` wildcard enrolls the workspace with zero root edits. Read-only slice 1 needs no SSR/routing. |
| 2 | Vertical slices `features/{metrics,expenses}/` = component + hook + tests; `infra/api.ts` typed client | Flat `components/hooks` | Mirrors API `features/expenses/{route,service,repository,tests}` and co-locates tests for strict-TDD cycles. |
| 3 | Plain `fetch`+zod in `api.ts`; custom `useMetrics`/`useExpenses` hooks | `@tanstack/react-query`, SWR, RTK Query | Two GETs, no cache invalidation; react-query adds bundle + API surface for no slice-1 gain. Hooks expose `{status,data,error,retry}` — trivially TDD-friendly. Re-eval in slice 2. |
| 4 | `recharts` BarChart (SVG) | `chart.js`; hand-rolled SVG | SVG renders in jsdom → testable without canvas/wheels; declarative JSX; React 19 compat; proposal-locked. |
| 5 | Vite dev proxy `/api → http://localhost:3000` | CORS allowlist + direct fetch | Locks proposal decision; no API/CORS edit; CORS `origin:true` already present. Allowlist deferred to slice-2 public hosting. |
| 6 | `tsconfig.json` extends `../../tsconfig.base.json` + `lib:['ES2022','DOM','DOM.Iterable']`, `jsx:'react-jsx'`, `types:['node']`; `src/vite-env.d.ts` adds `vite/client` reference | Standalone tsconfig | Base is node-only (no DOM, no `jsx`, `types:['node']`); child overrides `lib`, adds `jsx`, keeps `strict`,`noUncheckedIndexedAccess`,`verbatimModuleSyntax`. No vitest globals (matches API). |

## Data Flow

```
App.tsx ─ MetricsOverview        ExpenseList
            │ useMetrics(ownerId) │ useExpenses(ownerId)
            ▼                     ▼
        infra/api.ts  (fetch + zod.safeParse)
            │
  GET /api/expenses/summary?ownerId=…   GET /api/expenses?ownerId=…
        └── Vite proxy /api → http://localhost:3000 ── Fastify (apps/api/src/app.ts)
                                                              │
                                              ExpenseService → PrismaExpenseRepository → Postgres (:5433)
        ◄── {months:[{month,count,totalAmount}]}   Expense[] (Date → ISO; z.coerce.date() parses back)
   hooks expose loading/empty/error + retry(); malformed → error, no partial render
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/dashboard/package.json` | Create | `@rita/dashboard`, `type:module`; `dev`/`build`/`test`/`test:watch`/`typecheck`/`lint` prefix `pnpm --filter @rita/contracts build`; deps react@19, react-dom@19, recharts, `@rita/contracts@workspace:*`; devDeps vite, `@vitejs/plugin-react`, vitest@4, `@testing-library/{react,jest-dom,user-event}`, jsdom, typescript@5.8, typescript-eslint@8, eslint, `@types/react`, `@types/react-dom`. |
| `apps/dashboard/{vite,vitest}.config.ts` | Create | Vite: plugin-react + `server.proxy['/api']={target:'http://localhost:3000',changeOrigin:true}`. Vitest: `environment:'jsdom'`, `include:['src/**/*.test.{ts,tsx}']`, `setupFiles:['./src/test/setup.ts']`, `fileParallelism:false` (mirror API). |
| `apps/dashboard/tsconfig.json`, `src/vite-env.d.ts` | Create | tsconfig: extends base + DOM libs + `jsx:'react-jsx'`, `types:['node']`. d.ts: `vite/client` ref + `ImportMetaEnv.VITE_OWNER_ID?:string`. |
| `apps/dashboard/index.html`, `src/main.tsx`, `src/App.tsx`, `src/test/setup.ts` | Create | Root div → `createRoot` → composition; setup imports `@testing-library/jest-dom/vitest`. |
| `apps/dashboard/src/infra/env.ts` | Create | `OWNER_ID = import.meta.env.VITE_OWNER_ID ?? 'default'`. |
| `apps/dashboard/src/infra/api.ts`, `api.test.ts` | Create | `fetchSummary`, `fetchExpenses` (relative `/api`, owner query param); `safeParse` on `expenseSummarySchema`/`listExpensesSchema`, throw `ApiError` on mismatch/network. Tests: mocked `globalThis.fetch` — valid + malformed throw. |
| `apps/dashboard/src/features/metrics/{MetricsOverview,MetricsCards,MetricsChart}.tsx`, `useMetrics.ts`, `*.test.tsx` | Create | Section loading/empty/error states; recharts `BarChart` of `count`+`totalAmount` over `month`; hook status machine + `retry`. |
| `apps/dashboard/src/features/expenses/{ExpenseList,ExpenseFilters}.tsx`, `useExpenses.ts`, `expenseFilters.ts`, `*.test.tsx` | Create | Table cols date, amount, currency, category, note; two `<select>`; pure `filterExpenses(list,{month,category})` (month=`YYYY-MM` derived from `occurredAt`); reset. |
| `packages/contracts/src/index.ts` | Modify | Add `listExpensesSchema = z.array(expenseSchema)` + exported `expenseMonthSchema` (refactor `expenseSummarySchema` to reuse it); add types `ExpenseMonth`, `ListExpenses`. No API behavior change; rebuild `dist`. |
| `.env.example` | Modify | Append `# Dashboard (apps/dashboard)\nVITE_OWNER_ID=default`. |
| `eslint.config.mjs` | Future | React ESLint plugin deferred (Out of Scope); root flat config already parses `.tsx` via typescript-eslint — no slice-1 change. |
| `pnpm-workspace.yaml` | — | No edit; `apps/*` wildcard enrolls the workspace. |

## Interfaces / Contracts

```ts
// infra/api.ts
export type ApiError =
  | { kind: "network" }
  | { kind: "http"; status: number }
  | { kind: "validation"; issues: z.ZodIssue[] };
export function fetchSummary(ownerId: string): Promise<ExpenseSummary>;
export function fetchExpenses(ownerId: string): Promise<Expense[]>;

// hooks (one per slice)
type AsyncState<T> =
  | { status: "idle" | "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: ApiError };
export function useMetrics(ownerId: string): AsyncState<ExpenseSummary> & { retry: () => void };
export function useExpenses(ownerId: string): AsyncState<Expense[]> & { retry: () => void };

// features/expenses/expenseFilters.ts
export type Filters = { month?: string; category?: string }; // month === "YYYY-MM"
export function filterExpenses(list: Expense[], f: Filters): Expense[]; // AND-matching; reset = {}
```

`@rita/contracts` additions follow the existing zod style; built `dist` is consumed via `workspace:*`. The API serializes `Date` → ISO strings; `z.coerce.date()` restores them on the client so month derivation (`YYYY-MM` from `occurredAt`) and the summary `month` field align.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `api.ts` valid + malformed | Mock `globalThis.fetch`; assert `safeParse` throws `ApiError` on missing/wrong-typed `occurredAt`, `months`. RED first. |
| Unit | `useMetrics`/`useExpenses` state machine | `renderHook` + mocked `api`; idle→loading→success→error→`retry()` re-fetch; malformed → error (matches Response Validation spec). |
| Unit | `filterExpenses` pure logic | Both filters combined; month from `occurredAt`; no-match → empty (not error); reset = `{}`. |
| Unit | Components | `@testing-library/react` + jsdom; loading/empty/error+retry/cards/chart+table rows. recharts renders SVG (jsdom-safe, no canvas). |
| Integration | `App.tsx` | `render(<App/>)` with `api` mocked; both sections render; filter selection updates rows. |
| E2E | — | Unavailable (slice 1). |

Strict TDD: every source file driven by a failing test first (RED → GREEN → REFACTOR), per `config.yaml` `apply.tdd: true`. Per-task gate: `pnpm --filter @rita/dashboard test`.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary in this design.

## Migration / Rollout

No migration required. Build-first contracts: each dashboard script prefixes `pnpm --filter @rita/contracts build` (matches API). Vite dev proxy is the only slice-1 API access path. React ESLint plugin and README updates are deferred features, not rollout gates.

## Open Questions

- None blocking slice 1. (Slice 2 will decide: auth/`x-owner-id`, owner selector, react-query adoption, React ESLint plugin.)