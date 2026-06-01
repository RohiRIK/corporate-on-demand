# C-Level Accountability & Merger

## Problem

C-Level departments (CEO, CTO, CISO, CPO, CFO) default to writing verbose logs that nobody reads. They analyze, grade, and decide — but never write those decisions to `state.json` or send inbox messages. The org runs on stale directives.

## CEO Mandatory State Management

Add to CEO SYSTEM.md — a section that runs EVERY cycle, not optional:

```markdown
## Mandatory State Updates (EVERY CYCLE)

Before ending your cycle, you MUST:

1. **departmentGrades** — read each department's latest output. Grade A-F. Write to state.json.
2. **ceoDirectives** — write current directives per department. Delete stale ones referencing completed work.
3. **executionPhase** — count migrated modules (e.g. files in js/games/*.js). Set phase to match reality.
4. **Send inbox directives** — for every grade change or new priority, write to that department's inbox. A log entry is NOT a directive.
5. **Validate** — read back state.json and verify consistency.

FAILURE MODE: If you write "QA downgraded to D" in your log but don't update state.json, QA never knows.
```

## CTO Technical Gate Authority

Add to CTO SYSTEM.md:

```markdown
## Technical Gate Authority

1. **P0 Deploy Block** — when ANY P0 bug is open, write DEPLOY BLOCKED to DevOps inbox. Remove when resolved.
2. **Architecture Review Gate** — R&D cannot ship new modules without CTO sign-off within 1 cycle.
3. **Tech Debt Register** — maintain `departments/cto/tech-debt.md`. Flag items > 7 days. Escalate > 14 days.
4. **Cross-Department Conflicts** — send resolution to BOTH department inboxes within 1 cycle.
```

## Board Expanded Agenda (Merged C-Suite)

When CISO/CPO/CFO are underutilized (10+ "all nominal" cycles), merge into Board:

```markdown
## Expanded Agenda

1. **State.json Integrity Audit** — compare state.json against reality. Fix stale grades/directives/phases.
2. **Security Posture** (was CISO) — review Security dept output, npm audit, Docker vulns.
3. **Product Quality** (was CPO) — review QA results (are they real browser tests?), UX output.
4. **Budget & Utilization** (was CFO) — flag departments with 3+ identical cycles (stuck detection).
5. **Stuck Work Detection** — scan all inboxes for unprocessed P0/P1 older than 4 hours → escalate to CEO.
```

## Implementation Steps

1. Write `confluence/decisions/` doc with full spec
2. Send HR inbox message with exact SYSTEM.md sections to add for CEO, CTO, Board
3. Send inbox notifications to CEO, CTO, Board explaining their new responsibilities
4. Send deprecation notices to CISO, CPO, CFO inboxes
5. Pause CISO/CPO/CFO cron jobs
6. Adjust CEO schedule (2x → 3x/day), CTO schedule (6h → 4h)
7. HR updates SYSTEM.md files on next cycle

## Schedule After Merger

| Role | Before | After | Rationale |
|------|--------|-------|-----------|
| CEO | 2x/day | 3x/day (08, 14, 22) | Midday check catches morning drift |
| CTO | every 6h | every 4h | Faster P0 blocking, architecture review |
| Board | every 2h | every 2h (expanded) | Same frequency, 3x the coverage |
| CISO | every 8h | PAUSED (merged into Board) | Board handles security posture |
| CPO | every 8h | PAUSED (merged into Board) | Board handles product quality |
| CFO | every 8h | PAUSED (merged into Board) | Board handles utilization tracking |
