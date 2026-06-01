# QA Workflow Templates

Ready-to-use workflow documents for QA departments. Copy these into `confluence/workflows/` and adapt to the project. These are templates — not generic guidance. Each has concrete pass/fail criteria and output formats.

Origin: Arcade Platform incident — Pac-Man shipped with broken spawn point (player inside wall, unplayable) for 32 QA cycles. QA only grepped HTML. These workflows exist to prevent that class of failure.

---

## Template 1: qa-game-verification.md

```markdown
# QA Game Verification — Per-Cycle Checklist

Every QA cycle, verify every game/interactive feature in a real browser.

## Process

For EACH game in the project:

1. Open the site URL in a browser (Playwright or Hermes browser tools)
2. Click the game's launch button/card
3. Wait for the game container (canvas, iframe, or div) to appear
4. Verify the game renders (canvas is not blank — check pixel data or visual inspection)
5. Send keyboard input relevant to the game (arrow keys, space, WASD — whatever the game uses)
6. Verify the game STATE CHANGES in response to input:
   - Score changes, OR
   - Player position changes, OR
   - Canvas pixels change between frames, OR
   - Game UI updates (lives, level, timer)
7. Check browser console — zero JS errors
8. Navigate back to game list
9. Record result: ✅ PASS or ❌ FAIL with reason

## Output Format

Every cycle report MUST include this table:

| Game | Loads | Renders | Input Response | Console Clean | Status |
|------|-------|---------|----------------|---------------|--------|
| Snake | ✅ | ✅ | ✅ arrow keys move snake | ✅ | ✅ PASS |
| Pac-Man | ✅ | ✅ | ❌ arrow keys no movement | ✅ | ❌ FAIL |

## Mobile / Touch Verification

After completing desktop verification for each game:

1. Switch to mobile viewport (375px width) or emulate touch in DevTools
2. Verify touch D-pad buttons appear when game launches
3. Tap each direction — game must respond to ALL directions, not just one
4. Test fire/action button (🔫, Space, etc.)
5. Test continuous hold (touchstart→touchend) — paddle games need held input
6. Verify first touch doesn't cause instant death (e.g. pressing ▲ to start shouldn't aim player at nearest wall)

**Output per game:**
- ✅ or ❌ Desktop keyboard input
- ✅ or ❌ Mobile touch input
- Notes on which touch controls failed (if any)

See `references/browser-game-testing.md` § "Mobile QA Checklist" for technical failure modes.

## Hard Rules

- grep/string matching on HTML is NOT verification. If you didn't open a browser, you didn't test.
- "Game loads" is necessary but NOT sufficient. A game can load and be completely unplayable.
- If ANY game fails → P1 bug report immediately. Do not wait for next cycle.
- If you cannot test a game (tooling issue, environment down) → report as ⚠️ BLOCKED with reason. Do not mark as PASS.

## Anti-Patterns

- ❌ `grep launchGame index.html` → "all games verified"
- ❌ "I checked the HTTP status is 200" → "site works"
- ❌ "Game loads without errors" without testing input → misses spawn-in-wall bugs
- ❌ Skipping a game because "it worked last time" → regressions are real
```

---

## Template 2: qa-release-gate.md

```markdown
# QA Release Gate — 3 Blocking Gates

No release ships without passing all 3 gates in sequence. ANY gate failure = release blocked.

## Gate 1: Automated E2E (CI)

- Playwright test suite runs in CI on every push
- All tests must pass (green checkmark)
- If ANY test fails → release blocked
- Fix required before re-running gate

**What CI tests cover:**
- Each game/feature launches
- Canvas/container renders (not blank)
- Input produces state change
- Zero JS console errors
- Page loads under 3 seconds

**Gate 1 output:** CI pipeline status (pass/fail) with test report link

## Gate 2: Manual Smoke (QA)

- QA runs the game-verification checklist (see qa-game-verification.md)
- Every game tested manually in browser
- Mobile viewport tested (375px width)
- Cross-browser spot check (Chrome + Firefox minimum)

**Gate 2 output:** Verification table from qa-game-verification.md

## Gate 3: Full Regression

- If this release changes Game X → test ALL games, not just Game X
- Compare against previous release screenshots (if visual regression is set up)
- Verify changelog.json is updated
- Verify game count matches expected

**Gate 3 output:** "Regression complete. X/Y games pass. Blockers: [list or none]"

## Decision

| Gate 1 | Gate 2 | Gate 3 | Decision |
|--------|--------|--------|----------|
| ✅ | ✅ | ✅ | SHIP |
| ❌ | any | any | BLOCKED — fix CI failures |
| ✅ | ❌ | any | BLOCKED — fix manual findings |
| ✅ | ✅ | ❌ | BLOCKED — fix regressions |

## Hard Rules

- No exceptions. "It's just a small change" does not skip gates.
- QA cannot approve their own fix. If QA fixed something, R&D verifies.
- Gate results are logged in the QA outbox report with timestamps.

## Anti-Patterns

- ❌ "CI passed so we can skip manual testing" → CI doesn't catch everything
- ❌ "Only Snake changed so I only tested Snake" → regressions exist
- ❌ "We'll fix it after release" → no, fix it before release
```

---

## Template 3: qa-bug-report.md

```markdown
# QA Bug Report — Standard Format

Every bug gets a structured report. No exceptions, no "I mentioned it in Slack."

## Required Fields

```
**Severity:** P1 / P2 / P3 / P4
**Game/Component:** [which game or system component]
**Summary:** [one-line description]
**Steps to Reproduce:**
1. [exact step]
2. [exact step]
3. [exact step]
**Expected:** [what should happen]
**Actual:** [what actually happens]
**Screenshot:** [path to departments/qa/screenshots/bugs/<file>.png]
**Console Errors:** [paste any JS errors, or "none"]
**Environment:** [browser, viewport, URL — localhost vs production]
**First Detected:** [date and cycle number]
```

## Severity Classification

| Severity | Definition | Response Time | Example |
|----------|-----------|---------------|---------|
| P1 — Critical | Feature completely broken, unplayable, or security issue | Fix within 1 cycle | Pac-Man spawns inside wall, cannot move |
| P2 — Major | Feature degraded but partially usable | Fix within 3 cycles | Score doesn't increment but game plays |
| P3 — Minor | Cosmetic or minor UX issue | Fix when capacity allows | Button hover color wrong |
| P4 — Enhancement | Not a bug, but an improvement | Backlog | "Add high score persistence" |

## Routing

| Severity | Action |
|----------|--------|
| P1 | Immediate inbox to R&D + add to state.json pendingEscalations + notify CEO |
| P2 | Inbox to R&D, log in qa/bug-reports/ |
| P3 | Log in qa/bug-reports/, mention in QA cycle report |
| P4 | Log in qa/bug-reports/ as enhancement request |

## File Location

Save bug reports to: `departments/qa/bug-reports/<game>-<date>-<short-slug>.md`

Example: `departments/qa/bug-reports/pac-man-20260601-spawn-in-wall.md`

## Anti-Patterns

- ❌ "Pac-Man doesn't work" without steps to reproduce
- ❌ Reporting in outbox text without a separate bug report file
- ❌ P1 bug logged but no inbox sent to R&D → nobody sees it
- ❌ "I think there might be a bug" → verify and reproduce before reporting
```

---

## Usage

These templates are starting points. When seeding a new project:

1. Copy the template content into `confluence/workflows/qa-game-verification.md` (etc.)
2. Adapt game-specific details (which keys to test, expected behaviors)
3. HR integrates references to these workflows into QA's SYSTEM.md
4. CEO reviews and approves before they become mandatory

For non-game projects, adapt the verification checklist to match the project's interactive features (forms, dashboards, APIs, etc.).
