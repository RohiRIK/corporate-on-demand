# Directive Status Check — Post-Escalation Diagnostic

After issuing CEO directives (especially P1/P1-CRITICAL), verify propagation with this checklist.

## Step 1: Check inbox processing per department

For each department that received a directive:
```bash
# Pending (unprocessed)
ls departments/<dept>/inbox/*.md 2>/dev/null | wc -l
# Processed
ls departments/<dept>/inbox/done/*.md 2>/dev/null | wc -l
```

## Step 2: Verify SYSTEM.md changes landed

When directives require HR to update a department's SYSTEM.md:
```bash
# Check if HR processed its inbox
ls departments/hr/inbox/done/ | grep <directive-timestamp>

# Check target dept SYSTEM.md for expected new content
grep -n '<keyword>' departments/<target-dept>/SYSTEM.md
```

If HR inbox shows 0 in done/ → HR hasn't run yet. Check cron schedule.

## Step 3: Verify cycle evidence

```bash
# Recent logs from the department
find logs/ -name '*<dept>*' -mmin -120 | sort

# SYSTEM.md last modified
stat -c '%y' departments/<dept>/SYSTEM.md
```

## Step 4: Timeline analysis

Map directive timestamps against department cron schedules:
- Directive issued at T
- HR runs at T+X → must process inbox and patch SYSTEM.md
- Target dept runs at T+Y → must run AFTER HR (Y > X)
- If Y < X → target dept runs stale prompt, produces false results

## Escalation Triggers

- HR inbox unprocessed after 2 cycles → P1 escalation to Board
- Target dept produced report without SYSTEM.md change → flag as unreliable
- 3+ departments waiting on HR → consider emergency direct patch (document as incident)

## Common False-Positive Pattern

QA reports "7/7 PASS" but a game is actually broken (e.g. Pac-Man spawn bug).
Root cause: QA checks structural/surface metrics (canvas size, HTTP status, console errors) but not gameplay.
A structural PASS + gameplay FAIL = false positive. Only browser-based E2E with input simulation catches this.
