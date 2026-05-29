# Testing Strategy — Detection, Escalation, and Self-Healing

Multi-layer testing framework for Corporate-on-Demand projects. Departments detect, report, escalate, and fix issues autonomously.

---

## Testing Layers

### Layer 1: Static Analysis (every cycle, all departments)
Zero-cost checks that run as part of normal department work.

**R&D checks before shipping:**
- No hardcoded `localhost` in frontend code
- All API endpoints referenced in frontend exist in backend
- No console.error or syntax errors in JS files
- Game HTML is valid (canvas element exists, scripts load)

**Infra checks:**
- nginx config has correct proxy_pass rules
- Docker healthcheck passes
- Container logs have no repeated errors

**IT checks:**
- state.json schema valid
- All department folders structurally correct
- Log files are valid JSON

**Implementation**: Add to each department's SYSTEM.md under "Pre-flight Checks" section.

### Layer 2: API Contract Tests (QA, every cycle)
QA validates the API contract every run.

```
Checks:
- GET /api/health returns { status: "ok" }
- GET /api/games returns array
- Each game has: id, name, description, version
- Each game count matches expected (cross-reference pipeline.built)
- Response time < 500ms
- No 5xx errors
```

**Escalation**: If API fails → P1 to Infra. If game missing from API but in pipeline.built → P1 to R&D.

### Layer 3: Browser E2E (QA + R&D, after changes)
Open the actual site in a browser, interact, screenshot.

**When to run:**
- R&D: after building or modifying any game (self-check)
- QA: after R&D ships, and once per day as smoke test
- CEO: during inspection (visual spot-check)

**NOT every cycle** — only triggered by changes or scheduled daily.

**QA E2E flow:**
```
1. Open http://localhost:3000 in browser
2. Screenshot the game list page
3. Count visible games — must match /api/games count
4. For each game:
   a. Click the game card/button
   b. Wait 2 seconds for load
   c. Screenshot the game screen
   d. Verify canvas element exists and is visible
   e. Verify no error messages on screen
   f. Navigate back to game list
5. Check mobile viewport (375px width)
   a. Screenshot mobile view
   b. Verify games are still accessible
6. Save all screenshots to departments/qa/screenshots/
```

**R&D self-check flow (lighter):**
```
1. Open http://localhost:3000 in browser
2. Click the game I just built/modified
3. Screenshot — verify it loads
4. Check browser console for JS errors
5. If broken: fix immediately, re-check
6. If passes: log "self-check passed" in commit
```

**Tools**: Use Hermes browser tools (browser_navigate, browser_click, browser_snapshot, browser_vision).

### Layer 4: Visual Regression (after UI/UX changes)
Before/after screenshot comparison.

**When**: UX/UI or R&D modifies frontend CSS, layout, or game rendering.

**Flow:**
```
1. BEFORE change: screenshot baseline → departments/qa/screenshots/baseline/
2. Apply change
3. AFTER change: screenshot → departments/qa/screenshots/current/
4. Compare: use browser_vision to describe both images
5. If unexpected differences → P1 bug report with both screenshots attached
```

**Not automated diff** — use vision tool to describe what changed and flag if something looks wrong.

### Layer 5: LAN Accessibility (Infra + QA)
Verify the site works from a network client perspective, not just localhost.

**Checks:**
```
- grep -r "localhost" frontend/ — must return 0 hits (or only in comments)
- grep -r "127.0.0.1" frontend/ — same
- Frontend JS must use relative URLs (/api/games) not absolute (http://localhost:3001/api/games)
- nginx proxy_pass must route /api/* to backend container
- CORS headers allow LAN origins (or not needed if same-origin via proxy)
- If frontend uses fetch(): URL must be relative path
```

**This is the check that catches the bug we hit** — frontend using localhost:3001 which fails from LAN clients.

### Layer 6: Acceptance-Driven Development (R&D)
Not TDD, but spec-driven. R&D writes acceptance criteria BEFORE building.

**Game spec template (added to R&D pipeline):**
```markdown
# [Game Name] — Acceptance Criteria

## Must Pass (P1 if fails)
- [ ] Game loads in browser without JS errors
- [ ] Canvas renders at correct size (fills game container)
- [ ] Keyboard controls respond (specify which keys)
- [ ] Score displays and increments correctly
- [ ] Game over state triggers and displays
- [ ] Restart works without page reload
- [ ] No hardcoded localhost in any URL

## Should Pass (P2 if fails)
- [ ] Touch controls work on mobile
- [ ] Game pauses on blur/tab switch
- [ ] Sound effects play (if applicable)
- [ ] High score persists (if applicable)

## Nice to Have (P3)
- [ ] Responsive at 375px width
- [ ] Animation runs at 60fps
- [ ] Accessibility: keyboard-only playable
```

R&D writes this in the spec phase. QA validates against it after build.

### Layer 7: CEO Spot-Check (during inspections)
CEO adds a visual verification step to the 10:00 and 22:00 inspections.

**CEO inspection addition:**
```
1. Open http://localhost:3000 in browser
2. Screenshot
3. Count games visible vs pipeline.built count
4. If mismatch → immediate P1 escalation to QA + R&D
5. Click one random game — verify it loads
6. Screenshot and attach to inspection report
```

---

## Escalation Flow

```
Severity → Response Time → Who Fixes → Who Verifies

P1 (site down, game broken, LAN inaccessible):
  → Detect: any department
  → Escalate: immediately to state.json pendingEscalations
  → Notify: inbox to responsible dept + CEO inbox
  → Fix: responsible dept fixes within 1 cycle
  → Verify: QA re-runs E2E after fix
  → If not fixed in 2 cycles: CEO directive with deadline

P2 (degraded, missing feature, visual bug):
  → Detect: QA or UX/UI
  → Log: bug report in departments/qa/bug-reports/
  → Notify: inbox to responsible dept
  → Fix: within 3 cycles
  → Verify: QA checks next cycle

P3 (minor, cosmetic, nice-to-have):
  → Detect: any department
  → Log: bug report in departments/qa/bug-reports/
  → Fix: when capacity allows
  → No escalation
```

**Escalation chain:**
```
Department detects issue
    ↓
Writes bug report (departments/qa/bug-reports/<game>-<date>.md)
    ↓
Adds to state.json pendingEscalations (P1 only)
    ↓
Sends inbox message to responsible department
    ↓
Responsible dept has N cycles to fix (P1=1, P2=3, P3=whenever)
    ↓
QA verifies fix with browser E2E
    ↓
If not fixed in time → CEO escalation
    ↓
CEO issues directive with hard deadline
    ↓
If still not fixed → CEO can reassign to another dept or flag for human
```

---

## Screenshot Management

### Storage
```
departments/qa/screenshots/
  baseline/              # Reference screenshots (before changes)
  current/               # Latest E2E run screenshots
  bugs/                  # Screenshots attached to bug reports
  archive/               # Moved here after bug is fixed
```

### Lifecycle
```
1. Active: screenshots in current/ and bugs/
2. After fix verified: move bug screenshots to archive/
3. After 3 months: compress archive/ (tar.gz by month)
4. After 6 months: delete compressed archives
```

### Naming
```
YYYYMMDD-HHMMSS-<context>.png
Examples:
  20260529-100000-gamelist.png
  20260529-100005-snake-gameplay.png
  20260529-100010-mobile-375px.png
  20260529-100015-bug-missing-tetris.png
```

---

## Department SYSTEM.md Additions

### R&D Addition
```markdown
## Pre-Ship Checklist
Before marking a game as "built" in pipeline:
1. Open http://localhost:3000 in browser
2. Click your new/modified game
3. Screenshot — verify it loads and renders
4. Check: no hardcoded localhost in your code (grep -r "localhost" your-file)
5. Verify acceptance criteria from spec all pass
6. If any fail: fix before shipping. Do NOT ship broken code.
7. Log self-check result in your cycle log
```

### QA Addition
```markdown
## E2E Smoke Test (daily or after R&D ships)
1. Use browser tools to open the site
2. Screenshot game list, verify count matches API
3. Click each game, screenshot, verify loads
4. Check mobile viewport
5. Write results to departments/qa/test-results/<date>.md
6. Any P1 → immediate escalation

## Bug Report Template
File: departments/qa/bug-reports/<game>-<date>.md
Required fields:
- Severity: P1/P2/P3
- Game/Component: which game or system component
- Steps to Reproduce: numbered, exact steps
- Expected: what should happen
- Actual: what actually happens (with screenshot path)
- Environment: localhost vs LAN, browser, viewport size
- Screenshot: path to departments/qa/screenshots/bugs/<file>.png
```

### CEO Addition
```markdown
## Visual Spot-Check (during inspection)
1. Open http://localhost:3000 in browser
2. Screenshot the game list
3. Verify: visible game count == len(pipeline.built)
4. Click one game at random — verify it loads
5. If visual issues found → P1 to QA with screenshot
6. Attach screenshot to inspection report in reviews/
```

---

## State.json Additions for Testing

```json
{
  "testing": {
    "lastE2E": "ISO8601 timestamp of last QA E2E run",
    "lastSmoke": "ISO8601 timestamp of last smoke test",
    "openBugs": {
      "p1": 0,
      "p2": 0,
      "p3": 0
    },
    "gamesVerified": ["snake", "pong", "breakout", "tetris"]
  }
}
```

---

## Implementation Checklist

1. [ ] Update R&D SYSTEM.md — add Pre-Ship Checklist
2. [ ] Update QA SYSTEM.md — add E2E Smoke Test + Bug Report Template
3. [ ] Update CEO SYSTEM.md — add Visual Spot-Check
4. [ ] Update Infra SYSTEM.md — add LAN accessibility checks
5. [ ] Create departments/qa/screenshots/{baseline,current,bugs,archive}/
6. [ ] Add `testing` field to state.json
7. [ ] Update QA cron prompt — include browser E2E instructions
8. [ ] Update R&D cron prompt — include self-check before shipping
9. [ ] Update CEO cron prompt — include visual spot-check
10. [ ] Add browser toolset to QA, R&D, CEO cron jobs
11. [ ] Update game-submission standard with acceptance criteria template
