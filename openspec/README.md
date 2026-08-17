# OpenSpec — AutomatizacionRita

Spec-driven development workspace for the AutomatizacionRita project (hybrid persistence: openspec files + Engram).

## Layout

```
openspec/
├── config.yaml       <- Project SDD config (context, rules, testing capabilities)
├── specs/            <- Source of truth (main specs): {domain}/spec.md
└── changes/          <- Active changes: {change-name}/{proposal,specs,design,tasks,verify-report,state}
    └── archive/      <- Completed changes: YYYY-MM-DD-{change-name}/ (audit trail, never delete)
```

## Workflow

1. `/sdd-propose` — create a change proposal under `changes/{change-name}/proposal.md`.
2. `/sdd-spec` — write delta specs under `changes/{change-name}/specs/{domain}/spec.md`.
3. `/sdd-design` — technical design in `changes/{change-name}/design.md`.
4. `/sdd-tasks` — task breakdown in `changes/{change-name}/tasks.md`.
5. `/sdd-apply` — implement tasks (strict TDD; test command: `pnpm --filter @rita/api test`).
6. `/sdd-verify` — prove implementation; write `verify-report.md`.
7. `/sdd-archive` — move to `changes/archive/YYYY-MM-DD-{change-name}/` and merge deltas into `specs/`.

## Conventions

- Strict TDD is enabled: RED-GREEN-REFACTOR; tests are written before implementation code.
- Integration tests require PostgreSQL on `localhost:5433` and the `automatizacionrita_test` database (see `config.yaml` `testing.prerequisites`).
- Generated technical artifacts default to English.
