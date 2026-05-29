# QA Department Implementation

## Overview

The QA department runs **after R&D builds** to verify games and features meet acceptance criteria. QA does not fix bugs — it finds them, documents them, and delegates fixes back to R&D or UX.

## SYSTEM.md Template

```markdown
# QA Department — SYSTEM.md

You are the QA Department of {{company_name}}.

## Role
You test games, features, and platform components built by R&D. You find bugs,
write detailed reports, and verify fixes. You do NOT fix bugs yourself.

## Pipeline
1. **Test Plan** — Read the latest R&D build output. Write a test plan covering
   functional, regression, and edge-case scenarios.
2. **Execute Tests** — Run tests. Use the browser toolset to programmatically
   play-test games. Take screenshots of failures.
3. **Report Bugs** — Write bug reports in the standard format (see below).
   Save to departments/qa/bugs/<date>/.
4. **Verify Fixes** — When R&D marks a bug as fixed, re-test and either close
   the bug or reopen with updated findings.

## Owns
- Test plans: departments/qa/test-plans/
- Bug reports: departments/qa/bugs/
- Regression logs: departments/qa/regression/
- Acceptance criteria: departments/qa/acceptance/

## Must NOT Touch
- Fixing bugs (delegate to R&D via bug report)
- UX/design changes (delegate to UX via bug report)
- Infrastructure or deployment (Infra's domain)
- Production deploys

## Trigger
You run AFTER R&D completes a build cycle. Check departments/r-and-d/builds/
for new output. If nothing new, skip this cycle.

## Tools Available
- Browser toolset for play-testing games at their served URLs
- Screenshot capability for documenting visual bugs
- File read/write for test plans and reports
```

## Bug Report Format

Each bug report is a markdown file in `departments/qa/bugs/<date>/`:

```markdown
# BUG: <short title>

**ID:** BUG-<YYYYMMDD>-<NNN>
**Severity:** P1 | P2 | P3
**Component:** <game name or platform area>
**Build:** <build reference or commit>
**Found by:** QA
**Status:** Open | Fix Pending | Verified | Closed

## Description
Brief summary of the bug.

## Steps to Reproduce
1. Navigate to ...
2. Click ...
3. Observe ...

## Expected Behavior
What should happen.

## Actual Behavior
What actually happens.

## Screenshot
![bug screenshot](./screenshots/<filename>.png)

## Environment
- Browser: Chromium (headless)
- Resolution: 1920x1080
- Platform: <platform URL>

## Notes
Any additional context, workarounds, or related bugs.
```

### Severity Levels

- **P1** — Game unplayable, platform broken, data loss
- **P2** — Game feature broken, significant UX issue, wrong behavior
- **P3** — Cosmetic issue, minor glitch, polish item

## Cron Schedule

QA should run **offset from R&D** to ensure builds are complete before testing:

```yaml
# Example: R&D runs at top of hour, QA runs 30 min later
- department: r-and-d
  schedule: "0 */2 * * *"    # Every 2 hours at :00
- department: qa
  schedule: "30 */2 * * *"   # Every 2 hours at :30
```

## Pipeline Flow

```
R&D builds game
       ↓
QA picks up new build
       ↓
QA writes test plan
       ↓
QA executes tests (browser play-test)
       ↓
  ┌─ All pass → acceptance sign-off → ready for deploy
  └─ Bugs found → bug reports filed
                        ↓
              R&D/UX picks up fixes
                        ↓
              QA verifies fixes (loop)
```

## Play-Testing with Browser Toolset

QA can use browser automation to programmatically test games:

```markdown
## Play-Test Procedure
1. Navigate to the game URL on the platform
2. Verify the game loads without console errors
3. Test core mechanics (click, move, score tracking)
4. Test edge cases (rapid clicks, resize, refresh mid-game)
5. Check responsive behavior at different viewport sizes
6. Screenshot any failures
```

## Regression Log

After each test cycle, QA appends to `departments/qa/regression/log.md`:

```markdown
## Regression Run — <date>

**Build:** <reference>
**Tests Run:** <count>
**Passed:** <count>
**Failed:** <count>
**New Bugs:** BUG-xxx, BUG-yyy
**Reopened:** BUG-zzz
**Verified Fixed:** BUG-aaa
```

## Acceptance Criteria

QA maintains acceptance criteria per game/feature in `departments/qa/acceptance/`:

```markdown
# Acceptance Criteria: <Game Name>

- [ ] Game loads within 3 seconds
- [ ] Core mechanic functions correctly
- [ ] Score persists during session
- [ ] No console errors
- [ ] Responsive at 320px, 768px, 1920px
- [ ] Keyboard accessible
- [ ] Game over state triggers correctly
```
