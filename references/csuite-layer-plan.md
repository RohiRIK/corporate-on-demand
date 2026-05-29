# C-Suite Management Layer — Design Plan

## Overview

Strategic oversight layer on top of existing departments. Runs on the current file-based system (inbox files, state.json, staggered Hermes cron) — NOT dependent on the v2 DB migration.

## Roles

| Role | Scope | Schedule |
|---|---|---|
| **CEO** | Company-wide: grades, escalations, pipeline, blocked tasks, cross-dept health | Twice daily (10:00, 22:00) |
| **CTO** | Technical: R&D + Infra + IT specs, prototypes, runbooks, tech debt | Every 8-12h |
| **CISO** | Security: infra audits, security inbox items, vulnerability patterns | Every 8-12h |
| **CPO** | Product: UX/UI designs, staleness detection, style repetition, user-facing artifacts | Every 8-12h |

- CTO oversees R&D + Infra + IT (not just R&D)
- Board meeting: C-Suite writes to shared `boardroom-log.md`, CEO synthesizes and distributes directives
- CPO anti-staleness without embeddings: keyword/structure heuristics + style rotation from `style_palette` in state.json

## Planned Skills (to build via create-skill workflow)

Each is a standalone skill under `devops/corporate-on-demand/skills/`:

### 1. `csuite-report`
Role-specific report generator.
- `scripts/csuite-report.ts --path <project> --role ceo|cto|ciso|cpo`
- CEO: all grades, escalations, pipeline, blocked, cross-dept health
- CTO: R&D+Infra+IT specs, prototypes, tech debt, runbooks
- CISO: infra audits, security inbox items, vulnerability patterns
- CPO: UX/UI designs, staleness score, style repetition, user-facing artifacts

### 2. `csuite-directive`
C-Suite issues directive to a department.
- `scripts/directive.ts --path <project> --from ceo --to rnd --priority high --title "..." --body "..."`
- Writes formatted inbox file, updates state.json

### 3. `csuite-board-meeting`
Run a board meeting.
- `scripts/board-meeting.ts --path <project>`
- Collects all dept summaries, generates agenda, writes to `board/minutes/`

### 4. `csuite-staleness`
CPO staleness checker.
- `scripts/staleness-check.ts --path <project>`
- Scans UX/UI for keyword repetition, structural similarity, stale dates, style palette rotation

### 5. `csuite-grade`
CEO grading tool.
- `scripts/grade.ts --path <project> --dept rnd --grade B --reason "..."`
- Updates `departmentGrades` in state.json, writes review to `ceo/reviews/`

## Scaffold Updates Needed

`scaffold.ts` must be updated to add CTO/CISO/CPO departments to all templates, with matching data-collection scripts.

## Implementation Notes

- All scripts: Bun/TypeScript, `--help` flag, exit 0/1
- Use `create-skill` workflow for each (not raw script dumps)
- Build sequentially per create-skill conventions — one skill fully validated before starting the next
