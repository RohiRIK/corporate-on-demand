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

## Scripts (BUILT — v3.4.2)

All scripts live in `scripts/` within the skill directory. Shared `lib/utils.ts` provides arg parsing, state.json R/W with file locking, file listing, and timestamps.

### Shared Scripts (reusable by all roles + departments)
- `read-artifacts.ts` — Scan dept artifacts. `--path <project> --dept rnd,infra --since 24h --format summary|full|count`
- `state-rw.ts` — Atomic read/write/append for state.json with dot-notation. `--read grades.rnd` / `--write grades.rnd=B` / `--append recentChanges '{...}'`
- `inbox-send.ts` — Write formatted inbox messages. `--to rnd --from ceo --priority high --title "..." --body "..."`
- `inbox-digest.ts` — Summarize inbox. `--dept rnd --status pending|done|all --since 24h`
- `activity-log.ts` — Append/query activity log. `--append --dept rnd --action "..."` / `--query --since 12h --dept rnd`

### Role-Specific Scripts
- `csuite-report.ts` — `--role ceo|cto|ciso|cpo` (composes shared scripts internally)
- `grade.ts` — CEO grades a dept. `--dept rnd --grade B --reason "..."` (updates state + writes review)
- `board-meeting.ts` — Collects all summaries, writes minutes to `board/minutes/`
- `staleness-check.ts` — CPO anti-staleness: age, keyword repetition, structure similarity, style palette rotation

## Deployment Checklist (for wiring into a live project)

1. Add CTO/CISO/CPO cron jobs with correct schedules (CTO every 6h, CISO every 12h, CPO every 8h)
2. Upgrade data-collection scripts to call `csuite-report.ts --role <role>` instead of raw `cat`
3. Add `style_palette` to state.json for CPO staleness-check
4. Update SYSTEM.md templates to reference the new scripts (agents must know the tools exist)
5. Consider adding HR dept for SLA tracking + retrospectives, Analytics dept for user behavior

## Archive — Original Planned Items (all built)
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
