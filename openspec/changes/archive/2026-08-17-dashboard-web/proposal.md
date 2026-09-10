# Proposal: Web Dashboard (read-only metrics + expense list)

## Intent

AutomatizacionRita has no web UI; owners only interact via WhatsApp and the raw API. We need a read-only screen to glance at monthly totals/counts and browse the full expense list for one owner.

## Scope

### In Scope
- New workspace `apps/dashboard` (`@rita/dashboard`): Vite + React 19 + TypeScript SPA, vitest (jsdom) + Testing Library, recharts, strict TDD.
- Metrics overview: summary cards + bar chart of `totalAmount` and `count` per month from `GET /expenses/summary?ownerId=`.
- Expense list: table of all expenses from `GET /expenses?ownerId=` (category, amount, note, `occurredAt`).
- Client-side month + category filters over the returned list (no extra API calls).
- Owner via `VITE_OWNER_ID` env (default `"default"`); no selector UI.
- Typed client (`src/infra/api.ts`) zod-validating responses via `@rita/contracts` (compiled `dist`; build contracts first).
- Vite dev proxy `/api` → `http://localhost:3000`; scripts `dev`/`build`/`test`/`lint`/`typecheck`.

### Out of Scope
- Expense detail, CREATE, DELETE (slice 2). Auth / `x-owner-id` header (ownerId query param only).
- Owner selector UI; API or CORS changes; React ESLint plugin (lint gap, deferred).

## Capabilities

> Contract with sdd-spec. `openspec/specs/` is empty (new project).

### New Capabilities
- `dashboard-web`: read-only web dashboard — metrics overview (cards + monthly bar chart) and expense list with month/category client-side filters, single screen, single owner from env.

### Modified Capabilities
- None. Expenses API capability is unchanged in slice 1 (CORS already enabled).

## Approach

Vite SPA in `apps/dashboard`, vertical slices mirroring the API (`src/features/metrics/`, `src/features/expenses/` = component + hook + tests each; `src/infra/api.ts`; `src/app.tsx` composition). recharts (SVG, jsdom-testable). Responses zod-validated via `@rita/contracts`. `pnpm -r` picks the new workspace via `apps/*` wildcard → zero root config edits.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/dashboard/**` | New | Vite/React/vitest config, tsconfig extending base with DOM libs, `src/` vertical slices |
| `packages/contracts/src/index.ts` | Modified | Add `listExpensesSchema` + export summary month schema for client-side validation |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Contracts compiled (not source-linked) → stale types | Medium | `dev`/`test`/`build` build `@rita/contracts` first |
| CORS allow-all acceptable locally, unsafe if hosted | Low | Slice 1 local-only; env-driven whitelist deferred to public-hosting |
| recharts bundle (~150 KB) | Low | Fine for single-screen internal tool; tree-shakable |
| No React ESLint plugin → hooks lint gap | Medium | Documented; `eslint-plugin-react-hooks` add scheduled |

## Rollback Plan

No git. (1) Delete `apps/dashboard/`. (2) Revert `packages/contracts/src/index.ts` (remove `listExpensesSchema` + summary month export), re-run `pnpm --filter @rita/contracts build`. (3) `pnpm install` to prune `@rita/dashboard` from lockfile. No `pnpm-workspace.yaml` edit (uses `apps/*` wildcard). No `apps/api/**` files touched.

## Dependencies

- `@rita/contracts` (build-first), `@rita/api` on `:3000` for dev proxy. pnpm 10.33.0, Node >= 20, React 19, recharts, Vite, vitest 4, Testing Library, jsdom.

## Success Criteria

- [ ] `pnpm --filter @rita/dashboard build` succeeds; `dev` shows summary cards + monthly bar chart (last ~6 months).
- [ ] Expense list renders full list from `GET /expenses?ownerId=`; month + category filters refine client-side.
- [ ] vitest suite green; `typecheck` and `lint` clean; responses zod-validated.
- [ ] Zero `apps/api/**` changes in slice 1.