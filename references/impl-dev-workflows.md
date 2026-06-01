# Development Workflows — Shared Process Library

Formalized development workflows stored in `confluence/workflows/`. Departments select the appropriate workflow per task. HR bridges workflows into SYSTEM.md files.

---

## Structure

```
confluence/workflows/
  README.md              # Index + selection rules
  tdd.md                 # Test-Driven Development
  e2e-first.md           # E2E-First Development
  spike.md               # Spike / Exploration
  creative-pipeline.md   # Game migration with creative polish
  <more as needed>       # Added by QA, R&D, PM over time
```

## Workflow Selection Rules

| Context | Workflow |
|---------|----------|
| Bug fix | TDD — prove the bug, then fix it |
| New game / UI change / user-facing feature | E2E-First |
| Unknown approach / research | Spike first, then TDD or E2E-First |
| Game migration with creative direction | Creative Pipeline (includes TDD/E2E in build phase) |

## Scope — ALL Departments

Workflows are NOT limited to R&D and QA. Every department can have workflows:
- **Creative**: stage scripting, color palette selection, creative direction docs
- **DevOps**: CI pipeline changes, deployment rollbacks, infrastructure updates
- **Security**: audit procedures, vulnerability response
- **UX/UI**: design review, card identity creation
- **IT**: log validation, cleanup procedures
- **QA**: game verification, release gates, bug reporting

When a repeatable process exists in any department, it belongs in `confluence/workflows/`.

## Ownership Model

- **Any department**: When you discover a repeatable process or lesson — write it as a workflow.
- **PM**: Identifies workflow gaps across ALL departments (not just R&D). Proposes new workflows when seeing repeated ad-hoc patterns. Has authority to request HR connect any workflow to any department.
- **HR**: Bridges workflows into department SYSTEM.md files. When a new workflow appears in `confluence/workflows/`, HR determines which departments it applies to and integrates it. A single workflow can apply to multiple departments.
- **CTO**: Reviews workflow quality during inspections.

## QA-Specific Workflows

Beyond the general dev workflows, QA should have dedicated workflow documents:

```
confluence/workflows/
  qa-game-verification.md   # Per-game verification every cycle (launch, input, gameplay, console)
  qa-release-gate.md         # 3 blocking gates before any release ships
  qa-bug-report.md           # How to file, classify (P1-P4), and route bugs
```

These are separate from TDD/E2E-first because they govern QA's own cycle behavior, not how code is written.

## Workflow Monitoring (CEO Review Gate)

New workflows should be reviewed by the CEO before HR connects them to departments — prevents generic/low-quality workflows from becoming mandatory.

**Watchdog pattern**: A no-agent cron job monitors `confluence/workflows/` for new files and alerts when one appears. CEO reviews, improves if needed, then approves for HR integration.

```bash
# ~/.hermes/scripts/workflow-watcher.sh
# Compares current file list against saved state
# Silent when no changes, alerts on new files
```

## R&D SYSTEM.md Integration

R&D must have these rules in their SYSTEM.md:

```markdown
## Mandatory Workflow Selection
Before starting ANY task:
1. Read `confluence/workflows/README.md`
2. Select the appropriate workflow based on task context
3. State which workflow you are following in your outbox report
4. Follow that workflow's process completely — no skipping steps

Hard rule: "I just wrote the code and it works" is NOT a valid workflow.
Every change must have automated verification before it ships.
```

## PM — Continuous Workflow Authorship Process

PM doesn't just "identify gaps" — PM actively scans for workflow opportunities every cycle.

### Per-Cycle Scan

1. Read all department outbox reports from the last cycle
2. Look for signals:
   - Repeated ad-hoc patterns ("I manually did X again")
   - Inconsistent approaches between departments doing similar work
   - Lessons learned that aren't captured anywhere
   - CEO corrections that imply a missing process
3. For each pattern found:
   a. Draft a workflow document in `confluence/workflows/`
   b. Include: trigger conditions, step-by-step, pass/fail criteria, anti-patterns
   c. Send inbox to CEO for review (workflow does NOT become active until approved)

### Cross-Department Workflow Requests

PM can request HR connect an existing workflow to a new department:
- Example: "qa-release-gate applies to DevOps too — they should gate deploys the same way"
- Send inbox to HR with: workflow name, target department, rationale
- HR evaluates and integrates (after CEO approval if it's a new connection)

### Department-Authored Workflow Review

Any department can write a workflow and drop it in `confluence/workflows/`. When this happens:
- PM reviews for quality (see Workflow Quality Criteria below)
- If generic or vague → PM sends back to author with specific feedback
- If actionable → PM routes to CEO for approval
- PM does NOT approve workflows — PM reviews and routes

### PM Outbox Report Must Include

```
## Workflow Gap Analysis
- Patterns detected: [list or "none this cycle"]
- New workflows drafted: [list or "none"]
- Workflows routed to CEO for approval: [list or "none"]
- Departments scanned: [all / specific list]
```

---

## Workflow Quality Criteria (CEO Review Checklist)

Before approving a workflow for HR integration, CEO checks against these criteria.

### PASS — All Must Be True

1. **Specific** — References actual tools, file paths, commands, or output formats (not "ensure quality")
2. **Actionable** — A department can follow it step-by-step without asking questions
3. **Measurable** — Has explicit pass/fail criteria or required output format
4. **Scoped** — States clearly WHEN to use (trigger conditions) AND WHEN NOT to use
5. **Anti-patterns** — Lists at least one "don't do this" example with explanation

### FAIL — Any One = Reject

- "Ensure quality" / "maintain standards" without defining what those mean
- No pass/fail criteria — how do you know the workflow was followed?
- No trigger conditions — when should a department use this vs another workflow?
- Reads like a mission statement instead of a checklist
- Could apply to literally anything (too generic to be useful)
- No anti-patterns section

### Approval Format

Approved workflows get a header line added by CEO:
```
Status: APPROVED by CEO — <date>
```

Rejected workflows get returned to author via inbox with specific feedback referencing which criteria failed.

---

## Why This Exists

Without formalized workflows, departments default to ad-hoc development:
- R&D writes code without tests
- QA greps HTML instead of opening a browser
- Bugs ship to production undetected for weeks

The workflow library encodes institutional knowledge so new cycles don't repeat old mistakes.

## Implementation Checklist

1. [ ] Create `confluence/workflows/` directory
2. [ ] Add initial workflow documents (TDD, E2E-First, Spike, Creative Pipeline)
3. [ ] Add QA-specific workflows (game-verification, release-gate, bug-report)
4. [ ] Add README.md with selection table
5. [ ] Send directive to HR to integrate into ALL relevant department SYSTEM.md files (not just R&D)
6. [ ] Send directive to PM for ongoing gap identification across ALL departments
7. [ ] Send directive to all departments for ongoing workflow authorship
8. [ ] Set up workflow-watcher cron job (no-agent, monitors for new files, alerts CEO)
9. [ ] Verify HR updates SYSTEM.md files with workflow selection rules
10. [ ] CEO reviews and approves each new workflow before HR connects it
