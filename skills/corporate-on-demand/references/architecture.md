# Corporate-on-Demand Architecture

## Folder Structure
```
<project>/
├── departments/
│   ├── CORPORATE.md          ← master rules (injected into all agents)
│   ├── DELEGATION.md         ← cross-dept communication protocol
│   ├── ceo/
│   │   ├── SYSTEM.md         ← CEO identity, authority, quality standards
│   │   ├── directives/       ← standing orders
│   │   ├── reviews/          ← inspection reports
│   │   └── inbox/            ← escalations from departments
│   ├── rnd/
│   │   ├── SYSTEM.md         ← R&D identity, code standards, workflow
│   │   ├── research/         ← analysis docs
│   │   ├── pitches/          ← proposals
│   │   ├── specs/            ← implementation specs with pseudocode
│   │   ├── prototypes/       ← experimental code
│   │   └── inbox/
│   ├── uxui/
│   │   ├── SYSTEM.md         ← design language, tokens, UX principles
│   │   ├── research/         ← UX problem analysis, references
│   │   ├── designs/          ← mockups, CSS specs, interaction notes
│   │   ├── styleguide/       ← living design system
│   │   └── inbox/
│   ├── infra/
│   │   ├── SYSTEM.md         ← SRE principles, measurement-first
│   │   ├── runbooks/         ← operational procedures with rollback
│   │   ├── audits/           ← health audit records
│   │   └── inbox/
│   ├── pm/
│   │   ├── SYSTEM.md         ← documentation standards
│   │   ├── changelogs/       ← compiled from improvement logs
│   │   ├── standards/        ← project conventions
│   │   ├── reports/          ← status reports
│   │   └── inbox/
│   └── board/
│       ├── SYSTEM.md         ← meeting format, strategic thinking
│       ├── minutes/          ← meeting records with decisions
│       ├── strategy/         ← longer-form strategic docs
│       └── inbox/
├── state.json                ← shared coordination brain
├── logs/                     ← domain-tagged JSON logs
└── backend/config.json       ← user-controllable enable/disable/scope
```

## Schedule (per 2h cycle, stagger pattern)

| Offset | Department | Focus |
|--------|-----------|-------|
| :00 | Board | synthesize, coordinate, surface risks |
| :25 | R&D | research → pitch → spec → build |
| :50 | Infra | audit → runbook → execute |
| +1:15 | UX/UI | research → design → build |
| +1:40 | PM | review → changelog/standards/report |

**CEO** runs twice daily (e.g., 10:00 & 22:00) — inspects, grades, directs.

Stagger gap: minimum 15 minutes between departments to avoid state file races and rebuild conflicts.

## state.json Schema

```json
{
  "version": "2.0.0",
  "system": "corporate-on-demand",
  "lastBoardMeeting": "ISO-8601 | null",
  "lastCEOInspection": "ISO-8601 | null",
  "ceoDirectives": {
    "<dept>": "string directive"
  },
  "departmentGrades": {
    "<dept>": "A-F"
  },
  "pipeline": {
    "researched": ["item"],
    "pitched": ["item"],
    "specced": ["item"],
    "built": ["item"]
  },
  "pendingEscalations": [],
  "recentChanges": [
    { "dept": "rnd", "action": "wrote spec for X", "ts": "ISO-8601" }
  ],
  "blockedTasks": []
}
```

## Cross-Department Delegation Protocol

All inter-department communication goes through inbox files:

**Path**: `departments/<dept>/inbox/<timestamp>-<topic>.md`

**Required format**:
```markdown
# Task: <title>
Priority: high|medium|low
From: <department>
Deadline: next cycle | 2 cycles | when ready

## What
<specific description — no vague asks>

## Acceptance Criteria
- [ ] <testable criterion 1>
- [ ] <testable criterion 2>

## Context
<why this matters, references to existing artifacts>
```

**Rules**:
- Sender creates the file in the receiver's inbox
- Receiver processes inbox items at the start of each run
- Completed items are moved to `inbox/done/` with a response appended
- Stale items (>3 cycles) get escalated to CEO inbox
- CEO can override priority of any inbox item
