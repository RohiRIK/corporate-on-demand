# Cross-Department Meetings Implementation

## Meeting Types

### 1. Design Review — R&D + UX
- **When**: Before a project enters the `build` phase
- **Purpose**: Align on visual design, interaction patterns, and technical feasibility
- **Triggered by**: CEO directive or R&D completing `spec` phase
- **Output**: Approved design doc with technical constraints noted

### 2. Deployment Planning — Infra + DevOps
- **When**: Before a project's first deployment or major infra change
- **Purpose**: Agree on environments, artifact handoff, rollback procedures
- **Triggered by**: CEO directive or DevOps completing pipeline design
- **Output**: Deployment plan with environment specs and rollback steps

### 3. Quarterly Planning — PM + Board
- **When**: Every N cycles (configured by CEO), or on CEO directive
- **Purpose**: Review roadmap, reprioritize projects, assess resource allocation
- **Triggered by**: CEO directive (always explicit)
- **Output**: Updated roadmap, priority changes, board minutes

## How CEO Triggers a Meeting

The CEO places a directive file in **both** departments' inboxes:

```
departments/<dept-A>/inbox/meeting-directive-<id>.md
departments/<dept-B>/inbox/meeting-directive-<id>.md
```

### Directive Template

```markdown
# Meeting Directive — {{meeting_id}}

**Type**: design-review | deployment-planning | quarterly-planning
**Participants**: {{dept_a}}, {{dept_b}}
**Subject**: {{topic}}
**Requested by**: CEO
**Deadline**: cycle {{N}} (or "next cycle")

## Context
{{why this meeting is needed}}

## Expected Output
{{what decisions or documents should result}}
```

Each department reads its inbox at the start of its cycle. When a department
finds a meeting directive, it prioritizes producing its input document before
proceeding with normal pipeline work.

## Meeting Document Template

Meetings produce a single shared document:

```markdown
# {{Meeting Type}} — {{Date}}

## Meeting ID
{{meeting_id}}

## Attendees
- {{dept_a}} (represented by {{agent_a}})
- {{dept_b}} (represented by {{agent_b}})

## Agenda
1. {{item_1}}
2. {{item_2}}
3. {{item_3}}

## Discussion Notes
### {{item_1}}
{{notes}}

### {{item_2}}
{{notes}}

## Decisions
- [ ] **DEC-1**: {{decision description}} — Owner: {{dept}}
- [ ] **DEC-2**: {{decision description}} — Owner: {{dept}}

## Action Items
- [ ] **ACT-1**: {{action}} — Assigned to: {{dept}}, Due: cycle {{N}}
- [ ] **ACT-2**: {{action}} — Assigned to: {{dept}}, Due: cycle {{N}}

## Next Meeting
{{if recurring, when; otherwise "as needed"}}
```

## Where Output Goes

Meeting docs are stored in **three** locations:

1. `departments/<dept-a>/meetings/{{meeting_id}}.md`
2. `departments/<dept-b>/meetings/{{meeting_id}}.md`
3. `board/minutes/{{meeting_id}}.md` (always — board needs visibility)

Action items are also written into each department's `inbox/` as follow-up
directives so they're picked up in the next cycle.

## state.json Representation

```jsonc
{
  "meetings": {
    "MTG-2026-05-29-design-review": {
      "type": "design-review",
      "participants": ["rnd", "ux"],
      "status": "completed",           // scheduled | in-progress | completed
      "scheduledCycle": 4,
      "completedCycle": 4,
      "subject": "Tetris visual design review",
      "decisions": 3,
      "actionItems": 2,
      "actionItemsCompleted": 0
    }
  },
  "departments": {
    "rnd": {
      "pendingMeetings": [],            // meeting IDs awaiting this dept
      "lastMeeting": "MTG-2026-05-29-design-review"
    }
  }
}
```

### Lifecycle in state.json
1. CEO creates directive → adds meeting ID to both depts' `pendingMeetings`
2. Meeting runs → status moves to `completed`, removed from `pendingMeetings`
3. Action items tracked via `actionItems` / `actionItemsCompleted` counts
4. Depts check off action items as they complete them in subsequent cycles

## Example: R&D + UX Design Review Before Build Phase

**Scenario**: Tetris has completed `spec` in R&D. Before building, CEO wants
UX to review the visual design and R&D to confirm technical feasibility.

### Step 1 — CEO Issues Directive

```markdown
# Meeting Directive — MTG-2026-05-29-design-review

**Type**: design-review
**Participants**: rnd, ux
**Subject**: Tetris visual design and interaction patterns
**Requested by**: CEO
**Deadline**: cycle 4

## Context
Tetris spec is complete. Before R&D begins build, we need UX sign-off on
the grid layout, piece colors, scoring display, and touch/keyboard controls.

## Expected Output
- Approved color palette and grid dimensions
- Input mapping for keyboard and touch
- Score/level display layout
```

Files created:
- `departments/rnd/inbox/meeting-directive-MTG-2026-05-29-design-review.md`
- `departments/ux/inbox/meeting-directive-MTG-2026-05-29-design-review.md`

### Step 2 — Departments Prepare

- **UX** produces: `departments/ux/designs/tetris-visual-spec.md`
- **R&D** produces: `departments/rnd/notes/tetris-tech-constraints.md`

### Step 3 — Meeting Runs

CEO orchestrates by reading both inputs and producing the meeting doc.
Decisions are recorded, action items assigned.

### Step 4 — Output Distributed

- `departments/rnd/meetings/MTG-2026-05-29-design-review.md`
- `departments/ux/meetings/MTG-2026-05-29-design-review.md`
- `board/minutes/MTG-2026-05-29-design-review.md`
- Action items → each dept's inbox

### Step 5 — R&D Proceeds to Build

R&D's next cycle picks up the action items and the approved design,
then enters the `build` pipeline step with clear visual requirements.
