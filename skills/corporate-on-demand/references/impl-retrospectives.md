# Retrospectives

## Overview

Retrospectives are structured reflection cycles triggered by the CEO — either on a fixed schedule (monthly) or after major milestones. Each department writes its own retro, then the Board (CEO) synthesizes a company-wide summary and updates processes as needed.

## Trigger Conditions

- **Scheduled**: Every 4 weeks or every N cycles (configurable)
- **Milestone**: After a major feature ships, a production incident, or a failed QA cycle
- **CEO discretion**: Any time the CEO observes systemic issues

## state.json Schema

```json
{
  "retrospectives": {
    "last_retro": "2025-01-01",
    "next_retro": "2025-02-01",
    "cadence": "monthly",
    "pending_depts": ["rnd", "uxui", "qa", "pm", "devops"],
    "completed_depts": []
  }
}
```

## Implementation Steps

### 1. CEO triggers retro

CEO issues a directive to all departments:

```
ALL DEPARTMENTS: Retrospective cycle triggered. 
Write your retro to departments/<dept>/retros/<date>.md using the standard template.
Deadline: end of next cycle.
```

### 2. Each department writes its retro

Output path: `departments/<dept>/retros/YYYY-MM-DD.md`

### 3. CEO synthesizes

After all departments complete:
1. Read all `departments/*/retros/<date>.md`
2. Write `retros/<date>-company.md` with cross-cutting themes
3. Update any SYSTEM.md files if process changes are warranted
4. Update state.json: move depts to `completed_depts`, set `next_retro`

## Retro Document Template

```markdown
# Retrospective — [Department Name]
**Date**: YYYY-MM-DD
**Cycle(s) covered**: N–M

## What Went Well
- [Concrete achievement or practice that worked]
- [Another]

## What Went Badly
- [Specific problem — not vague complaints]
- [Include impact: "caused 2 cycle delay" or "3 files reverted"]

## What To Change
- [Actionable proposal, not wish]
- [Who would implement it and rough effort]

## Cross-Department Notes
- [Feedback for other departments]
- [Blocked by X from dept Y]

## Metrics This Period
- Files changed: N
- Budget tokens used: N/M
- QA issues found/fixed: N/M
- Grade trend: B → A
```

## Company-Wide Summary Template

```markdown
# Company Retrospective — YYYY-MM-DD

## Themes
- [Pattern seen across multiple depts]

## Top Wins
1. [Best outcome this period]

## Top Issues
1. [Biggest problem, with root cause]

## Process Changes
- [ ] [Change to implement, assigned to CEO/dept]

## Department Grades This Period
| Dept | Grade | Trend |
|------|-------|-------|
| R&D  | A     | ↑     |
```

## Example

**CEO directive:**
> "Retrospective triggered — milestone: arcade v2.0 shipped. All departments: write retros by cycle 16."

**R&D retro excerpt:**
> **What Went Badly**: Spec for multiplayer was underspecified — caused 3 cycles of rework. PM should include API contracts in specs.

**CEO synthesis:**
> **Process Change**: PM specs must now include API contract stubs. Added to PM SYSTEM.md.

## Guards & Constraints

- **Mandatory participation**: All active departments must submit. CEO tracks via `pending_depts`.
- **Honesty over polish**: Retros that only list wins are flagged — CEO asks for rewrite.
- **Action items tracked**: Process changes from retros are logged and verified in the next retro.
- **No blame, only systems**: Focus on what the *process* should change, not which agent "failed."
- **Retros are append-only**: Never delete or modify past retros.
