# Exploration: Web Dashboard for AutomatizacionRita (dashboard-web)

## Current State

**API (`apps/api`, `@rita/api`)** — Fastify 5 + TypeScript 5.8 ESM, manual DI composition root `src/app.ts`, vertical-slice features (route + service + repository + tests) under `src/features/`.

Endpoints the dashboard will consume:

| Method | Path | Tenant | Response |
|--------|------|--------|----------|
| GET | `/expenses?ownerId=` | query param | `Expense[]` (ordered `occurredAt` desc) |
| GET | `/expenses/:id?ownerId=` | query param | `Expense` / 404 `{code:"NotFound"}` |
| GET | `/expenses/summary?ownerId=` | query param | `ExpenseSummary` = `{ months: [{ month: "YYYY-MM", count, totalAmount }] }`, last ~6 months (window = `6 * 30 days` from now) |
| POST | `/expenses` | `x-owner-id` header | 201 `Expense` / 422 `{code:"ValidationFailed", details}` |
| DELETE | `/expenses/:id` | `x-owner-id` header | 204 / 404 |

Error shape everywhere: `{ code, message, details? }` (422 ValidationFailed, 404 NotFound, 401 Unauthorized, 500 InternalServerError).

**Contracts (`packages/contracts`, `@rita/contracts`)** — zod 3.25, consumed as **compiled output** (`main`/`types` → `dist/`); the API always runs `pnpm --filter @rita/contracts build` before dev/test/build. Exported schemas: `createExpenseSchema`, `expenseSchema` (`Expense`), `expenseSummarySchema` (`ExpenseSummary`). `occurredAt`/`createdAt` use `z.coerce.date()`, so ISO date strings in JSON parse correctly client-side too.

**CORS** — ALREADY ENABLED: `app.register(cors, { origin: true })` in `src/app.ts` with `@fastify/cors ^11.3.0` in dependencies. `origin: true` reflects any request origin (allow-all) — fine for local dev, must become an env-driven whitelist before any public deployment. No `CORS_ORIGIN` env var exists yet.

**Env** — `env.ts` (zod-validated): `PORT` (default 3000), `DATABASE_URL` (required), `OWNER_ID` (default `"default"`, used by the WhatsApp webhook), WhatsApp webhook vars. Server listens on `0.0.0.0:${PORT}`.

**Auth** — NONE. Tenant identity is the `ownerId` string (header on writes, query param on reads). `UnauthorizedError` exists in `src/infra/errors.ts` but is unused. Anyone who knows/guesses an ownerId can read that owner's expenses.

**Monorepo** — pnpm 10.33.0 workspaces `apps/*` + `packages/*` (a new `apps/dashboard` is picked up automatically). Root scripts run `pnpm -r --if-present` (`dev`, `build`, `test`, `lint`, `typecheck`) — a new workspace with matching script names is wired with zero root changes. Shared `tsconfig.base.json`: strict, `lib: ["ES2022"]` only, `types: ["node"]`, `moduleResolution: "bundler"` (Vite-compatible). ESLint: single root flat config (`typescript-eslint` recommended only — no React plugins). No prettier. Vitest 4 with per-workspace config (API: node env, `fileParallelism: false`, integration tests hit PostgreSQL `automatizacionrita_test` on localhost:5433).

**Gaps found**
- No `expenseListSchema` / standalone month-item schema in contracts (trivial to add: `expenseSchema.array()`, `expenseSummarySchema.shape.months.element`).
- No web/dashboard workspace exists (confirmed — README and the contracts package description already anticipate "a future Next.js dashboard").
- No lint/TS config support for JSX/DOM yet (`lib` lacks `DOM`; `types: ["node"]` would need overriding; no `eslint-plugin-react-hooks`).
- Environment has Ticketera-oriented frontend skills installed (`react-patterns`, `react-testing`, `design-system`, `a11y`); they define conventions for a different project and should be adopted deliberately or adapted, not assumed.

## Affected Areas

- `apps/dashboard/**` (NEW workspace, name `@rita/dashboard`) — the dashboard itself: `vite.config.ts`, `vitest.config.ts` (jsdom), `tsconfig.json` (extends base, adds `DOM` libs), `src/` with per-feature slices mirroring the API layout.
- `packages/contracts/src/index.ts` — add `listExpensesSchema` (and optionally export the summary month schema) so the client validates API responses at runtime.
- `eslint.config.mjs` — add React/JSX handling (`eslint-plugin-react-hooks`, JSX-aware rules) once JSX enters the repo.
- `apps/api/src/app.ts` — NOT required for slice 1 (CORS already open); later: env-driven origin whitelist instead of `origin: true`.
- `README.md`, `openspec/config.yaml` — context/layout documentation updates after implementation.
- `.env.example` — optionally document `VITE_*` vars for the dashboard.

## Approaches

1. **Vite + React (TypeScript) SPA** — `apps/dashboard`, React 19, Vite 6/7, vitest + Testing Library, Vite dev proxy `/api` → `http://localhost:3000`.
   - Pros: vitest is Vite-native (zero friction with the repo's strict-TDD vitest discipline); no SSR needed (read-only metrics views); smallest surface, fastest dev loop; static build deployable anywhere; later migration to Next.js is cheap because routes are thin and components/data layer stay the same.
   - Cons: diverges from the README's "Next.js" wording (soft signal only — no auth/SSR needs exist today); auth, when it arrives, stays client-side token handling (which is fine — auth is an API concern).
   - Effort: Low

2. **Next.js (App Router)** — `apps/dashboard` as a Next app; data fetched client-side in "use client" components.
   - Pros: matches README anticipation; middleware/auth story and SSR available if needed later; route/API conveniences.
   - Cons: heavier than the problem requires (no SSR need today); RSC + vitest adds testing friction for a strict-TDD repo; more build config and a node runtime for dev; API calls still need proxying (Next rewrites) to `:3000` or CORS absolute URLs.
   - Effort: Medium

3. **Lightweight non-React** (Vite + Svelte/Vue, or server-rendered HTMX) — faster initial bundle, but breaks alignment with the environment's React skill set, the README's React expectation, and adds a second framework family to a small monorepo.
   - Pros: small runtime.
   - Cons: ecosystem mismatch, no benefit for this slice.
   - Effort: Medium

**Charts** for monthly totals/counts (recharts vs react-chartjs-2 vs hand-rolled SVG):
- `recharts` — React-native, renders SVG (testable in jsdom with Testing Library), actively maintained, tree-shakable. Recommended.
- `chart.js` + `react-chartjs-2` — canvas-based; requires canvas mocking in jsdom tests (friction with strict TDD).
- Hand-rolled SVG bars — zero deps, trivially testable; attractive for "two simple bar charts" but recharts already solves axis/tooltips/labels for ~150 KB.

## Recommendation

**Vite + React (TypeScript) SPA in `apps/dashboard` (`@rita/dashboard`)**, read-only first slice, `recharts` for charts.

Rationale: the dashboard is a read-only metrics view over a JSON API with no SSR, no auth, and one tenant dimension. Vite is vitest-native (protecting the repo's strict-TDD rule), has built-in dev proxy to `:3000`, and its thin route layer makes a future move to Next.js (if auth/SSR ever demand it) a low-cost migration. `packages/contracts` is consumed the same way the API consumes it (build-first; typed DTOs + zod validation of responses client-side).

**First-slice scope**
- Metrics overview: summary cards + bar chart of `totalAmount` and `count` per month from `GET /expenses/summary?ownerId=`.
- Expense list: table of recent expenses from `GET /expenses?ownerId=` (category, amount, note, date). Expense detail and DELETE deferred to slice 2.
- Owner: config module with `VITE_OWNER_ID` (default `"default"`, matching `OWNER_ID`), optional small owner selector persisted in localStorage — read-only GETs only need the query param, so no header handling in slice 1.
- Layout: `src/features/metrics/`, `src/features/expenses/` (component + hook + tests per feature, mirroring API vertical slices); `src/infra/api.ts` typed client; `src/app.tsx` composition.
- Structure: `apps/dashboard` with `tsconfig.json` extending `tsconfig.base.json` (override `lib` with `DOM`/`DOM.Iterable`, drop `types: ["node"]`), its own `vitest.config.ts` (jsdom + Testing Library), Vite proxy `/api` → `http://localhost:3000`, scripts `dev`/`build`/`test`/`lint`/`typecheck` so root `pnpm -r` wires it automatically.

## Risks

- **CORS `origin: true` is allow-all** — acceptable for local dev; MUST be replaced with an env-driven origin whitelist before the dashboard is hosted publicly (API change, not dashboard change).
- **No auth** — anyone with an ownerId can read expenses; acceptable for a personal tool, must be addressed before multi-user or public hosting. `UnauthorizedError` already exists and is unused.
- **Contracts are compiled, not source-linked** — the dashboard's `dev`/`test` scripts must build `@rita/contracts` first (same pattern the API uses); forgetting this yields stale types.
- **Lint gap** — root ESLint has no React plugin; JSX will ship without hooks linting until `eslint-plugin-react-hooks` is added.
- **Framework decision contradicts README wording** — needs explicit user confirmation (Vite now vs Next.js now).
- **recharts vs canvas** — if chart.js is chosen instead, jsdom tests need canvas mocking; use recharts (SVG) to avoid it.

## Ready for Proposal

**Yes** — with one explicit user decision: **Vite + React SPA** (recommended) vs **Next.js** (README anticipation). The orchestrator should ask the user this before sdd-propose, and should also confirm the first slice is read-only (metrics + list, no create/delete).
