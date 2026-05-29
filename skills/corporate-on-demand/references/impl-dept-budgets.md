# Department Budgets (Scope Tokens)

## Overview

Each department receives a fixed number of **change tokens** per cycle. A token is consumed for each file modification or creation. This prevents runaway modifications, enforces intentionality, and gives the CEO a lever to reward high-performing departments or constrain underperforming ones.

## state.json Schema

```json
{
  "budgets": {
    "rnd": { "tokens": 5, "used": 0, "history": [] },
    "uxui": { "tokens": 3, "used": 0, "history": [] },
    "qa": { "tokens": 3, "used": 0, "history": [] },
    "pm": { "tokens": 2, "used": 0, "history": [] },
    "devops": { "tokens": 4, "used": 0, "history": [] }
  },
  "budget_cycle": {
    "current": 12,
    "reset_every_n_cycles": 4,
    "last_reset": "2025-01-15T00:00:00Z"
  }
}
```

### Token Costs

| Action | Cost |
|--------|------|
| Modify existing file | 1 token |
| Create new file | 2 tokens |
| Delete file | 1 token |
| Read-only / report | 0 tokens |

## Implementation Steps

### 1. Add budget tracking to department SYSTEM.md

Add to each department's SYSTEM.md:

```markdown
## Budget Rules

Before making ANY file change:
1. Read state.json → budgets.<your_dept>
2. Check: used < tokens. If not, STOP and report "budget exhausted" to CEO.
3. After each change, increment `used` and append to `history`:
   { "file": "<path>", "action": "modify|create|delete", "cycle": <N>, "timestamp": "<ISO>" }
4. Write updated state.json.
```

### 2. CEO audits budget usage

The CEO checks budget usage as part of its review cycle:

```markdown
## Budget Audit (CEO)

1. Read state.json → budgets
2. For each dept where used > tokens * 0.8: flag as "high usage"
3. For each dept where used == 0: flag as "idle — investigate"
4. Include budget summary in cycle report
```

### 3. CEO adjusts budgets

After grading or retrospectives, the CEO can adjust:

```markdown
## Budget Adjustment Directive

"R&D: your budget increases to 7 tokens next cycle based on consistent A grades."
"UX/UI: reduced to 2 tokens — last cycle had 2 reverted changes."
```

### 4. Budget reset

At the start of every reset period (e.g., every 4 cycles), the CEO zeros all `used` counters and optionally adjusts `tokens` allocations.

## Example

**Cycle 12 — R&D budget:**
```json
{
  "rnd": {
    "tokens": 5,
    "used": 3,
    "history": [
      { "file": "src/games/newgame.ts", "action": "create", "cycle": 12, "timestamp": "2025-01-15T02:00:00Z" },
      { "file": "src/lib/engine.ts", "action": "modify", "cycle": 12, "timestamp": "2025-01-15T02:05:00Z" }
    ]
  }
}
```

R&D used 3 of 5 tokens (create=2 + modify=1). Two tokens remain.

## Guards & Constraints

- **Hard stop**: Departments MUST NOT make changes when budget is exhausted. No exceptions without CEO override.
- **CEO override**: CEO can issue `"budget_override": true` for emergency changes, logged separately.
- **No borrowing**: Departments cannot use another department's tokens.
- **Audit trail**: Every token spend is logged in history — CEO can trace exactly what was changed.
- **Reset timing**: Budgets reset on schedule, never mid-cycle. Unused tokens do NOT roll over.
