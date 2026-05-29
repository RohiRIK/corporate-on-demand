# Project Fast-Track Mechanism

## Overview

Fast-track allows the CEO to accelerate a project by letting a department
execute **2 pipeline steps per cycle** instead of the normal 1. It is
time-limited, logged, and requires Board acknowledgment.

## state.json Field

```jsonc
{
  "fastTrack": {
    "project": "tetris",                // which project is fast-tracked
    "reason": "Demo deadline in 3 days", // CEO's justification
    "department": "rnd",                // which dept gets the acceleration
    "expiresAfterCycles": 2,            // auto-expires after N cycles
    "cyclesUsed": 0,                    // incremented each cycle it's active
    "issuedCycle": 5,                   // cycle when CEO issued it
    "issuedAt": "2026-05-29T10:00:00Z",
    "boardAcknowledged": false,         // must become true within 1 board meeting
    "log": []                           // append-only record of what happened
  }
}
```

When no fast-track is active, the field is `null`:
```jsonc
{ "fastTrack": null }
```

Only **one** fast-track can be active at a time. To fast-track a different
project, the current one must expire or be explicitly cancelled by the CEO.

## How the CEO Issues a Fast-Track

CEO writes a directive to the target department's inbox:

```markdown
# Fast-Track Directive

**Project**: tetris
**Department**: rnd
**Reason**: Demo deadline requires spec+build completed by cycle 7
**Duration**: 2 cycles
**Issued**: cycle 5

## Instructions
You are authorized to execute 2 pipeline steps per cycle for the
above project until this fast-track expires. Log each double-step
in your cycle report.
```

CEO also updates `state.json` with the `fastTrack` object.

## How R&D Reads and Applies

At the start of each cycle, the department checks `state.json`:

```python
# Pseudocode for department agent cycle
fast_track = state["fastTrack"]

if fast_track and fast_track["department"] == my_dept:
    if fast_track["cyclesUsed"] < fast_track["expiresAfterCycles"]:
        steps_this_cycle = 2  # fast-track active
        fast_track["cyclesUsed"] += 1
    else:
        steps_this_cycle = 1  # expired, revert to normal
        state["fastTrack"] = None
else:
    steps_this_cycle = 1      # no fast-track for us
```

With 2 steps, R&D executes them **sequentially** in one cycle:
1. Complete step A (e.g., `spec`) → update state → commit
2. Immediately proceed to step B (e.g., `build`) → update state → commit

## Auto-Expiry

- After each cycle where fast-track is used, `cyclesUsed` increments
- When `cyclesUsed >= expiresAfterCycles`, the fast-track is **automatically nullified**
- The department reverts to 1 step per cycle
- A log entry records the expiry

```jsonc
{
  "log": [
    { "cycle": 5, "steps": ["spec", "build"], "note": "Fast-track cycle 1/2" },
    { "cycle": 6, "steps": ["test", "polish"], "note": "Fast-track cycle 2/2" },
    { "cycle": 6, "event": "expired", "note": "Fast-track completed, reverting to normal pace" }
  ]
}
```

## Logging Requirements

Every fast-tracked cycle MUST log:
1. **Which 2 steps** were executed
2. **Duration** of each step (start/end timestamps)
3. **Any issues** encountered due to acceleration
4. **Artifacts produced** in each step

Logs go to:
- `state.json` → `fastTrack.log[]` (structured)
- `departments/<dept>/reports/cycle-<N>.md` (human-readable)
- `board/minutes/` (referenced in next board meeting)

## Board Acknowledgment Guard

**Rule**: The Board must acknowledge the fast-track in its next meeting minutes.

- `boardAcknowledged` starts as `false`
- At the next Board meeting (quarterly planning or ad-hoc), the Board reviews
  the fast-track reason, duration, and current status
- Board sets `boardAcknowledged: true` in state.json
- **If the Board does not acknowledge within 1 meeting cycle**, the CEO
  receives a warning flag in state.json:

```jsonc
{
  "warnings": [
    "Fast-track for 'tetris' has not been acknowledged by the Board after 1 meeting cycle"
  ]
}
```

This is a **governance check** — it doesn't auto-cancel the fast-track, but
ensures the Board has visibility into accelerated work.

## Example: Fast-Tracking Tetris Through spec+build in One Cycle

### Situation
- Tetris is in R&D's pipeline at the `spec` stage
- A demo is needed in 3 days
- Normal pace: 1 step/cycle → spec in cycle 5, build in cycle 6 (too slow)

### Step 1 — CEO Issues Fast-Track

CEO creates:
- `departments/rnd/inbox/fast-track-tetris.md` (directive)
- Updates `state.json`:

```jsonc
{
  "fastTrack": {
    "project": "tetris",
    "reason": "Demo deadline in 3 days — need spec+build done by cycle 6",
    "department": "rnd",
    "expiresAfterCycles": 2,
    "cyclesUsed": 0,
    "issuedCycle": 5,
    "issuedAt": "2026-05-29T10:00:00Z",
    "boardAcknowledged": false,
    "log": []
  }
}
```

### Step 2 — R&D Cycle 5 (Fast-Tracked)

R&D reads inbox, sees fast-track directive, confirms via state.json.

**Step A — spec** (first half of cycle):
- Writes game specification
- Defines grid size, piece types, scoring rules
- Produces `projects/tetris/docs/spec.md`

**Step B — build** (second half of cycle):
- Implements core game logic based on spec
- Produces `projects/tetris/src/` files
- Runs basic smoke tests

R&D updates state.json:
```jsonc
{
  "fastTrack": {
    "cyclesUsed": 1,
    "log": [
      {
        "cycle": 5,
        "steps": ["spec", "build"],
        "note": "Fast-track cycle 1/2 — spec and build completed for Tetris"
      }
    ]
  },
  "projects": {
    "tetris": {
      "phase": "build",
      "pipelineStep": "build-complete"
    }
  }
}
```

### Step 3 — Board Acknowledges

At the next Board meeting, the fast-track is reviewed:

```markdown
## Fast-Track Review
- **Project**: Tetris
- **Reason**: Demo deadline
- **Status**: Active, 1/2 cycles used
- **Board Decision**: Acknowledged. Reason is valid.
```

`boardAcknowledged` → `true`

### Step 4 — Normal Pace Resumes

After `expiresAfterCycles` is reached, R&D automatically returns to
1 step per cycle. The fast-track log is preserved in state.json for
historical reference and Board review.
