# Sprint Mode Implementation

## Overview

Sprint Mode is a **temporary organizational acceleration** that any senior
role (CEO, PM, or Board) can propose. Unlike Fast-Track (single department,
single project), Sprint Mode affects the entire organization — boosting
cycle frequency, enabling parallel tracks, and fast-tracking multiple
departments simultaneously.

Sprint Mode is designed for **pivots and time-sensitive initiatives** where
the normal organizational tempo is a bottleneck.

## Who Can Propose

| Role  | Can Propose | Can Approve | Can Veto |
|-------|-------------|-------------|----------|
| CEO   | ✅          | ✅ (self)   | ✅       |
| PM    | ✅          | ❌          | ❌       |
| Board | ✅          | ✅          | ✅       |

- **CEO** can propose AND self-approve Sprint Mode (Board must acknowledge
  within 1 meeting cycle, same as Fast-Track governance)
- **PM** can propose Sprint Mode by writing a proposal to CEO's inbox —
  CEO decides whether to activate
- **Board** can propose and approve during quarterly planning or ad-hoc
  meetings, and can also veto an active Sprint Mode

## How It Gets Proposed

### CEO Proposes (Direct Activation)

During a normal CEO cycle, the CEO analyzes organizational state and
determines Sprint Mode would help. CEO writes:

1. A Sprint Plan document → `confluence/decisions/SPRINT-<name>.md`
2. Updates `state.json` with sprint mode fields
3. Sends inbox directives to all affected departments

**CEO should consider Sprint Mode when:**
- A pivot is active and Gate progress is slow
- Multiple departments are blocked on each other
- A deadline or demo requires accelerated output
- Too many departments are idle waiting for upstream work

### PM Proposes (Recommendation)

During a normal PM cycle, PM identifies a tempo bottleneck and writes
a Sprint Mode proposal to CEO inbox:

```markdown
# Sprint Mode Proposal

**From**: PM
**Reason**: {{why current pace is insufficient}}
**Suggested Duration**: {{1-5 days}}
**Suggested Scope**: {{which departments, which projects}}
**Expected Outcome**: {{what Sprint Mode would unblock}}

## Analysis
{{PM's data — cycle counts, blocked departments, pipeline bottlenecks}}

## Recommended Levers
{{which Sprint Mode levers to activate — see Levers section}}
```

CEO evaluates in their next cycle and either activates or responds with
reasoning for not activating.

### Board Proposes (Strategic Directive)

During quarterly planning or ad-hoc Board meeting, the Board can issue
a Sprint Mode directive as a strategic decision:

```markdown
## Board Decision: Sprint Mode Activation

**Decision ID**: DEC-{{N}}
**Type**: Sprint Mode
**Reason**: {{strategic justification}}
**Duration**: {{max 5 days}}
**Scope**: {{departments and projects}}
**Owner**: CEO (execution responsibility)
```

This goes into board minutes and CEO's inbox. CEO must execute.

## Sprint Mode Levers

Sprint Mode is not binary — it has **6 configurable levers** that can be
mixed and matched based on need:

### Lever 1 — Cron Frequency Boost
Temporarily increase cycle frequency for key departments.

```jsonc
{
  "cronOverrides": {
    "rnd": "1h",      // was 2h → now every hour
    "creative": "1h", // was 2h → now every hour
    "devops": "1h"    // was 2h → now every hour
  }
}
```

**Rule**: Only fast-cycle departments (2h base) can be boosted to 1h.
Slow-cycle departments (4-8h) can be boosted to 2h max.
Never go below 1h — agents need time to produce quality work.

### Lever 2 — Parallel Tracks
Group departments into independent parallel tracks that can work
simultaneously without waiting for sequential handoffs.

```jsonc
{
  "parallelTracks": [
    { "id": "A", "departments": ["devops", "ux"], "focus": "Framework migration" },
    { "id": "B", "departments": ["rnd"], "focus": "Game rebuilds on LittleJS" },
    { "id": "C", "departments": ["creative"], "focus": "Game scripts and creative direction" },
    { "id": "D", "departments": ["qa", "it"], "focus": "Testing infrastructure" }
  ]
}
```

Each track works independently. Cross-track dependencies are handled via
inbox messages, not blocking waits.

### Lever 3 — Multi-Department Fast-Track
Extend Fast-Track to multiple departments simultaneously (normally only
one Fast-Track is allowed).

```jsonc
{
  "fastTrackDepts": ["rnd", "creative"]
}
```

Each fast-tracked department executes 2 pipeline steps per cycle.
All normal Fast-Track rules apply (logging, board acknowledgment).

### Lever 4 — C-Suite Cadence Bump
Increase frequency of slow-cycle C-suite departments to maintain
governance pace during sprint.

```jsonc
{
  "cronOverrides": {
    "cto": "4h",   // was 6h
    "cpo": "4h",   // was 8h
    "ciso": "4h"   // was 8h
  }
}
```

### Lever 5 — Daily Standup Meetings
Auto-trigger a lightweight cross-department standup meeting every 12h
during Sprint Mode. CEO reads all department reports and produces a
coordination summary.

```jsonc
{
  "standupEnabled": true,
  "standupIntervalHours": 12
}
```

Standup output goes to `confluence/sprints/standup-<date>.md` and
relevant action items go to department inboxes.

### Lever 6 — Scope Lock
During Sprint Mode, no new projects or scope changes are allowed.
All departments focus exclusively on Sprint Mode objectives.

```jsonc
{
  "scopeLock": true,
  "sprintObjectives": [
    "Complete LittleJS framework migration",
    "Produce creative direction for all 7 games",
    "Gate 2 → Gate 4 for arcade-evolution pivot"
  ]
}
```

## state.json Schema

```jsonc
{
  "sprintMode": {
    "active": true,
    "name": "arcade-evolution-sprint",
    "proposedBy": "ceo",              // "ceo" | "pm" | "board"
    "approvedBy": "ceo",              // who approved
    "reason": "Accelerate pivot Gate 2→4",
    "activatedAt": "2026-05-30T10:00:00Z",
    "expiresAt": "2026-06-04T10:00:00Z",  // max 5 days
    "maxDurationDays": 5,
    "levers": {
      "cronBoost": true,
      "parallelTracks": true,
      "multiFastTrack": true,
      "csuiteBump": true,
      "dailyStandup": true,
      "scopeLock": true
    },
    "cronOverrides": {
      "rnd": "1h",
      "creative": "1h",
      "devops": "1h",
      "cto": "4h",
      "cpo": "4h"
    },
    "parallelTracks": [
      { "id": "A", "departments": ["devops", "ux"], "focus": "Framework" },
      { "id": "B", "departments": ["rnd"], "focus": "Game rebuilds" },
      { "id": "C", "departments": ["creative"], "focus": "Scripts" },
      { "id": "D", "departments": ["qa", "it"], "focus": "Testing" }
    ],
    "fastTrackDepts": ["rnd", "creative"],
    "sprintObjectives": [
      "LittleJS migration",
      "Creative direction for all games",
      "Gate 2→4 for arcade-evolution"
    ],
    "standupEnabled": true,
    "standupIntervalHours": 12,
    "scopeLock": true,
    "boardAcknowledged": false,
    "log": []
  }
}
```

When no Sprint Mode is active: `"sprintMode": null`

## How Departments Read Sprint Mode

Every department checks `state.json` at cycle start:

```python
# Pseudocode — department cycle start
sprint = state.get("sprintMode")

if sprint and sprint["active"]:
    # Am I in a parallel track?
    my_track = next((t for t in sprint["parallelTracks"]
                     if my_dept in t["departments"]), None)
    if my_track:
        focus = my_track["focus"]
        # Prioritize track focus over normal backlog

    # Am I fast-tracked?
    if my_dept in sprint.get("fastTrackDepts", []):
        steps_this_cycle = 2

    # Is scope locked?
    if sprint.get("scopeLock"):
        # Do not pick up new projects outside sprint objectives
        pass
```

## Auto-Expiry

Sprint Mode **automatically expires** when `expiresAt` is reached.
Maximum duration is **5 days** — this is a hard limit.

On expiry:
1. All cron overrides revert to normal schedule
2. Fast-track for all departments ends
3. Parallel tracks dissolve
4. Scope lock lifts
5. CEO produces a Sprint Retrospective → `confluence/sprints/retro-<name>.md`
6. `sprintMode` set to `null` in state.json
7. A log entry records the expiry and outcomes

**Early termination**: CEO or Board can end Sprint Mode early by setting
`active: false` and recording the reason in the log.

## Sprint Retrospective

When Sprint Mode ends (expiry or early termination), CEO produces:

```markdown
# Sprint Retrospective — {{name}}

**Duration**: {{start}} → {{end}}
**Proposed by**: {{role}}
**Reason**: {{original reason}}

## Objectives — Achieved?
- [ ] {{objective 1}} — {{status}}
- [ ] {{objective 2}} — {{status}}

## Levers Used
{{which levers were active and their effect}}

## What Worked
{{observations}}

## What Didn't Work
{{observations}}

## Departments Performance During Sprint
| Department | Cycles Run | Steps Completed | Notes |
|------------|-----------|-----------------|-------|
| rnd        | 12        | 18              | Fast-tracked, 2 steps/cycle |

## Recommendations
{{should Sprint Mode be used again? what to change?}}
```

## Interaction with Other Mechanisms

### Fast-Track
Sprint Mode's `fastTrackDepts` **replaces** the single `fastTrack` field.
When Sprint Mode is active, the normal `fastTrack` field is ignored.
When Sprint Mode ends, any lingering single fast-track is also cleared.

### Pivots
Sprint Mode is especially useful during pivots. The sprint objectives
should align with the pivot's current gate goals. Sprint Mode does NOT
skip pivot gates — it accelerates progress through them.

### Cross-Department Meetings
Sprint Mode's standup meetings use the standard meeting protocol from
`impl-cross-dept-meetings.md`. The standup is a lightweight variant:
CEO reads reports and produces coordination notes (no formal meeting
document with separate department inputs).

### Board Governance
Same as Fast-Track: Board must acknowledge Sprint Mode within 1 meeting
cycle. If not acknowledged, a warning is added to `state.json.warnings[]`.
Board can veto (force early termination) at any time.

## Cron Override Implementation

When Sprint Mode activates with cron overrides, the **operator** (user or
orchestrator) must update the actual cron job schedules. The state.json
`cronOverrides` field is the **source of truth** for what the schedules
should be. On Sprint Mode expiry, schedules revert to their base values
defined in `architecture.md`.

CEO's Sprint activation log entry should include the before/after cron
schedules for easy revert.

## Example: CEO Activates Sprint Mode for Pivot

### Situation
- Pivot `arcade-evolution` is at Gate 2
- 8 departments need to submit impact assessments
- Normal pace: each department runs every 2h = assessments trickle in
- CEO determines Sprint Mode would get Gate 2 done in 1-2 days vs 3-4

### Step 1 — CEO Decides During Normal Cycle

In the CEO's regular cycle report:

```markdown
## Sprint Mode Recommendation

I'm activating Sprint Mode for the arcade-evolution pivot.

**Reason**: Gate 2 requires impact assessments from 8 departments.
At current pace (2h cycles), this will take 3-4 days. Sprint Mode
with cron boost + parallel tracks can compress this to 1-2 days.

**Duration**: 3 days
**Levers**: Cron boost (key depts to 1h), parallel tracks (4 tracks),
scope lock (focus on pivot only)
```

### Step 2 — CEO Updates state.json + Sends Directives

CEO writes the Sprint Plan to confluence, updates state.json, and
sends inbox directives to all departments explaining the sprint.

### Step 3 — Departments Adapt

Each department reads the sprint directive and adjusts:
- Checks parallel track assignment
- Checks if fast-tracked
- Focuses on sprint objectives only (scope lock)

### Step 4 — Daily Standups

Every 12h, CEO reads all reports and produces a standup summary
noting progress, blockers, and cross-track coordination needs.

### Step 5 — Sprint Ends

After 3 days (or when objectives are met), Sprint Mode expires.
CEO writes retrospective. Normal operations resume.
