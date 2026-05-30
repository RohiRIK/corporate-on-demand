# R&D Labs (Skunkworks)

## Overview

Labs is a **default R&D capability** — every R&D department gets a sandbox
for experimental work. Labs let R&D prototype freely without the overhead
of the full pitch→spec→build pipeline. But labs output NEVER goes to
production directly — it must graduate through the normal pipeline.

## Why Default

R&D's job is to build things. But the formal pipeline (pitch→spec→build→QA)
creates friction for exploration. Labs solve this:
- Quick PoCs to validate technical approaches
- Framework evaluations (e.g., "can LittleJS handle our use case?")
- Performance experiments
- Architectural prototypes

Without Labs, R&D either skips exploration (ships untested approaches) or
shoehorns experiments into the formal pipeline (wastes cycles on specs for
throwaway code).

## Directory Structure

```
departments/rnd/labs/
  experiment-001-physics-engine/
    README.md          # Goal, status, findings
    prototype.js       # Throwaway code
    findings.md        # What was learned
  experiment-002-multiplayer/
    README.md
    prototype.js
    findings.md
```

Each experiment gets its own numbered directory. Numbers are sequential,
never reused (even after abandonment).

## Experiment README Template

```markdown
# Experiment: <Name>
**Status**: exploring | promising | graduated | abandoned
**Started**: YYYY-MM-DD
**Goal**: <What question are we answering?>

## Approach
<What we're trying — tools, libraries, techniques>

## Findings
<Updated as we go — what worked, what didn't, measurements>

## Recommendation
<Continue / Graduate to spec / Abandon — and why>
```

## Rules

1. **No pitch/spec needed** — Labs are for exploration, not delivery
2. **Labs code is NOT production-ready** — any direct copy to `src/` without
   graduation is a violation
3. **Budget-aware** — labs work consumes tokens like anything else. R&D
   should not spend more than ~20% of cycle time on labs unless CEO directs
4. **Document everything** — even failed experiments have value. Always write
   findings.md before abandoning
5. **One active experiment at a time** (recommended) — prevents labs from
   becoming a distraction. CEO can override for urgent parallel experiments

## Graduation Path

When an experiment shows promise:

1. R&D updates README: `status: promising` + writes detailed `findings.md`
2. R&D writes recommendation: "Graduate to spec"
3. PM reads findings and creates a formal spec
4. Normal pipeline: spec → build → QA → ship
5. R&D updates README: `status: graduated`

The experiment directory stays in `labs/` as historical reference — never
deleted, even after graduation.

## Abandonment

When an experiment doesn't work:

1. R&D updates README: `status: abandoned`
2. R&D writes `findings.md` with what was learned and why it failed
3. Directory stays in `labs/` — failed experiments prevent future rework

## state.json Tracking (Optional)

For projects that want CEO visibility into labs activity:

```jsonc
{
  "labs": {
    "activeExperiment": "experiment-003-littlejs-isolation",
    "totalExperiments": 3,
    "graduated": 1,
    "abandoned": 1,
    "exploring": 1
  }
}
```

This is optional — CEO can also just read `departments/rnd/labs/` directly.
Useful for projects with high experiment velocity.

## CEO Oversight

- CEO can **direct** R&D to run a specific experiment (via inbox directive)
- CEO can **cap** labs time if R&D is spending too much on exploration
- CEO reviews labs findings during inspection cycles
- Graduation decisions are R&D + PM — CEO intervenes only if priorities conflict

## CTO Interaction

- CTO may request specific experiments (e.g., "evaluate framework X")
- CTO reviews technical findings before graduation recommendation
- For architecture-level experiments, CTO sign-off is recommended before
  PM creates a spec

## Scaffold Integration

`scaffold.ts` automatically creates `departments/rnd/labs/` and includes
the Labs section in R&D's SYSTEM.md for all project templates.

## Example: LittleJS Engine Isolation PoC

### Situation
- Pivot `arcade-evolution` requires migrating 7 games to LittleJS
- Unknown: can LittleJS instances be isolated per-game without conflicts?
- This is a technical question, not a product decision — perfect for Labs

### Experiment

```markdown
# Experiment: LittleJS Engine Isolation
**Status**: exploring
**Started**: 2026-05-31
**Goal**: Can multiple LittleJS instances run on one page without
canvas/state conflicts?

## Approach
- Create 2 minimal LittleJS games on one page
- Test shared canvas vs separate canvas
- Measure memory/CPU overhead per instance

## Findings
(in progress)

## Recommendation
(pending findings)
```

### Outcome Paths
- **Works** → Graduate: PM specs the multi-game architecture, R&D builds it
- **Doesn't work** → Abandon: findings inform alternative architecture (iframe isolation, SPA routing)
- Either way, the experiment prevents wasting a full pipeline cycle on an untested assumption
