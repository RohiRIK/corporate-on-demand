# Team Building Days (Gibbush)

## Overview

A **gibbush** (גיבוש) is a team-building event where normal pipeline enforcement is relaxed and departments can experiment freely. The CEO declares gibbush mode via `state.json`, and all departments shift to creative/exploratory work around a shared theme.

## Activation

CEO writes to `state.json`:

```json
{
  "gibbushMode": {
    "active": true,
    "theme": "retro games",
    "expiresAt": "2025-03-15T18:00:00Z",
    "maxCycles": 3,
    "cyclesCompleted": 0,
    "declaredAt": "2025-03-14T09:00:00Z"
  }
}
```

## Department Behavior During Gibbush

Every department checks `gibbushMode.active` at the **start of each cycle**:

1. **If active** → switch to gibbush mode:
   - Pipeline gates (review, approval) are relaxed
   - Normal backlog is paused
   - Output goes to `departments/<dept>/gibbush/<YYYY-MM-DD>/`
   - Department works on theme-related experiments
2. **If inactive** → normal pipeline continues

### Per-Department Examples

| Dept | Normal Work | Gibbush Work |
|------|------------|--------------|
| R&D | Build from approved specs | Prototype wild ideas around theme |
| UX | Design from briefs | Freestyle designs, mashups, experiments |
| Infra | Maintain platform | Try new tech, performance experiments |
| PM | Docs and reports | Document gibbush ideas, run polls |
| QA | Test builds | Play-test experiments, creative bug hunts |

## Output Structure

```
departments/
  r-and-d/
    gibbush/
      2025-03-14/
        retro-platformer-prototype/
        pixel-art-engine-experiment/
  ux/
    gibbush/
      2025-03-14/
        retro-ui-kit/
        crt-shader-mockup/
```

## Auto-Expiry Guard

Gibbush ends when **either** condition is met:

1. `expiresAt` timestamp is reached
2. `cyclesCompleted >= maxCycles`

Each department increments `cyclesCompleted` after completing a gibbush cycle. The CEO (or any department) checks expiry:

```python
from datetime import datetime, timezone

def is_gibbush_expired(state):
    gm = state.get("gibbushMode", {})
    if not gm.get("active"):
        return True
    if datetime.now(timezone.utc) >= datetime.fromisoformat(gm["expiresAt"]):
        return True
    if gm.get("cyclesCompleted", 0) >= gm.get("maxCycles", 999):
        return True
    return False
```

When expired, CEO sets `gibbushMode.active = false`.

## Post-Gibbush Review

1. **Board** reviews all output in `gibbush/` folders
2. Good ideas get promoted:
   - CEO adds them to `ceo/backlog/` as proper briefs
   - They enter the normal pipeline (UX → R&D → QA → Deploy)
3. Board writes a gibbush retrospective in `board/reports/`

## Example Themes

- **"retro games"** — 8-bit aesthetics, classic game mechanics
- **"accessibility"** — screen readers, colorblind modes, keyboard-only play
- **"performance challenge"** — optimize load times, reduce bundle size
- **"AI experiments"** — procedural generation, adaptive difficulty
- **"mobile first"** — touch controls, responsive layouts
- **"community"** — multiplayer, leaderboards, social features

## SYSTEM.md Additions

Departments should include this check in their SYSTEM.md instructions:

```markdown
## Gibbush Check
Before starting your normal pipeline, read state.json and check gibbushMode.active.
If true:
- Read the theme from gibbushMode.theme
- Skip normal backlog
- Create experimental work related to the theme
- Save all output to your department's gibbush/<date>/ folder
- Increment gibbushMode.cyclesCompleted when done
```
