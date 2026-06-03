# Testing Strategy — Detection, Escalation, and Self-Healing

> **TL;DR** — 7-layer testing framework: (1) Static analysis, (2) API contract, (3) Browser E2E, (4) Visual regression, (5) LAN accessibility, (6) Acceptance-driven dev, (7) CEO spot-check. **The two layers that catch the most real bugs and are skipped most often:** Layer 3 (browser E2E with Playwright — grep-only misses interactive content bugs, see pitfall A40) and Layer 5 (LAN check — localhost hides `localhost:PORT` hardcoded in frontend, see pitfall A14). Escalation: P1 next cycle, P2 within 24h, P3 within week. Screenshot lifecycle: active → archive → compress → delete.

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

**Static sites (no backend):** If the project runs as pure static files (e.g. GitHub Pages), skip API checks. Instead verify: `changelog.json` loads, game count in HTML matches expected, no `/api/` references in source.

**Escalation**: If API fails → P1 to Infra. If game missing from API but in pipeline.built → P1 to R&D.

### Layer 2.5: CI E2E with Playwright (MANDATORY for interactive content)
Automated browser tests in CI — catches bugs that grep and API checks miss.

**When**: Every push to main. Blocking — merge fails if tests fail.

**Why this exists**: The Arcade Platform shipped Pac-Man with a broken spawn point (player inside a wall, completely unplayable) for 32 QA cycles and 197 department cycles. QA only grepped HTML for `launchGame` and checked HTTP status. Nobody opened a browser. This layer ensures a real browser verifies every interactive feature.

**CI workflow (GitHub Actions):**
```yaml
# .github/workflows/e2e-tests.yml
- Install Playwright (chromium)
- Serve static site locally (or use live URL post-deploy)
- Run Playwright test suite
- Fail the workflow if any test fails
```

**Per-game test requirements:**
```
For each game/interactive feature:
1. Navigate to site
2. Click the game card / launch button
3. Wait for canvas to appear
4. Verify canvas is NOT blank (pixel sampling)
5. Send keyboard input (arrow keys, space, etc.)
6. Verify game state changes (score, position, canvas pixels change)
7. Assert zero JS console errors
```

**Key rule**: "Game launches and responds to input" is the minimum bar. If a game has a canvas and arrow key controls, the test MUST press arrow keys and verify the canvas changes.

**Department ownership:**
- **DevOps**: CI workflow, Playwright infrastructure
- **QA**: Write and maintain test scripts
- **R&D**: Fix games that fail tests

**Anti-pattern**: Do NOT substitute `grep launchGame index.html` for Playwright. That checks code exists, not that it works. A game can have a perfect `launchGame` function and still be unplayable (e.g. player spawns inside a wall).

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
## Hard Gate: No Code Without Tests (BLOCKING — not guidance)

Every code change MUST have at least one automated test that verifies it works.

| Change Type | Test Requirement |
|-------------|-----------------|
| Bug fix | Write failing test FIRST (TDD). Test must fail without fix, pass with fix. |
| New feature/game | Write E2E test that exercises the feature. Test must pass before shipping. |
| Refactor | Existing tests must pass. If no tests exist for the area, write them first. |
| Config/build change | Smoke test verifying the build succeeds and site loads. |

### Enforcement
- Your outbox report MUST include: "Tests added: [list]" or "Tests updated: [list]"
- If you ship code with "Tests: none" → QA rejects immediately, P1 escalation to CEO
- QA will verify: does the test actually test what it claims? They run it and confirm it fails when the code is broken.

### Anti-Patterns
- ❌ "I tested manually in the browser" — that's a self-check, not a test. Self-checks are ADDITIONAL, never a replacement.
- ❌ "The game works on my machine" — without an automated test, it doesn't count.
- ❌ "It's a small change, no test needed" — small changes cause big bugs. Pac-Man was "just a maze array."

## Pre-Ship Checklist
Before marking a game as "built" in pipeline:
1. Verify your automated test passes (see Hard Gate above)
2. Open http://localhost:3000 in browser
3. Click your new/modified game
4. Screenshot — verify it loads and renders
5. Check: no hardcoded localhost in your code (grep -r "localhost" your-file)
6. Verify acceptance criteria from spec all pass
7. If any fail: fix before shipping. Do NOT ship broken code.
8. Log self-check result AND test names in your cycle log
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
