# Pivoting Flow

Strategic direction changes that alter how the product works — architecture, tech stack, product model, or delivery method.

## Pivot Types

| Type | Scope | Example |
|------|-------|---------|
| `architecture` | How it's built/deployed | Monolith → modular, static → SSR, single-file → multi-page |
| `product` | What it does or who it's for | Arcade → educational platform, B2C → B2B |
| `tech-stack` | Core technology swap | Vanilla JS → React, REST → WebSocket |
| `delivery` | How users access it | Single HTML → hosted app, local → cloud |

## Pipeline (7 gates)

### Gate 1 — Pivot Proposal
**Who:** CEO or PM
**Output:** `confluence/decisions/PIVOT-<name>.md`

Required fields:
```markdown
## Pivot Proposal: <name>
- **Type:** architecture | product | tech-stack | delivery
- **Current state:** How it works now (one paragraph)
- **Target state:** How it should work after (one paragraph)
- **Why now:** Business/technical driver
- **Scope:** Which departments are affected
- **Estimated phases:** Number of phases
- **Rollback plan:** How to undo if it fails
```

### Gate 2 — Impact Assessment
**Who:** Each affected department head (via inbox)
**Trigger:** CEO sends impact-assessment request to affected departments
**Output:** Each department adds to the pivot doc:

```markdown
## Impact: <department>
- **Breaks:** What stops working
- **Rewrites:** What needs to be rebuilt
- **Effort:** S/M/L/XL
- **Dependencies:** What this dept needs from other depts first
- **Risks:** What could go wrong
```

**Deadline:** 2 cycles after request. No response = "no impact" assumed.

### Gate 3 — Pivot Plan
**Who:** PM consolidates, CEO approves
**Output:** Updated pivot doc with execution plan:

```markdown
## Execution Plan
### Phase 1: <name> (target: cycle N)
- [ ] Task 1 — owner: <dept>
- [ ] Task 2 — owner: <dept>
- Checkpoint: <what must be true to proceed>

### Phase 2: <name> (target: cycle N+M)
...

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Kill Criteria (abort pivot if any are true)
- [ ] Criterion 1
- [ ] Criterion 2
```

### Gate 4 — Board Vote
**Who:** Board meeting (use `board-meeting.ts`)
**Rule:** Majority approval required. Each department gets one vote.
**Output:** Board meeting minutes with vote record.

If rejected: pivot doc moves to `confluence/decisions/REJECTED-PIVOT-<name>.md` with rejection rationale.

### Gate 5 — Pipeline Freeze
**Who:** CEO directive to all departments
**What happens:**
- Current sprint completes (no new features start)
- R&D pipeline frozen — only pivot work allowed
- QA switches to pivot validation mode
- PM tracks pivot phases instead of normal roadmap
- **Freeze does NOT affect:** bug fixes, security patches, incident response

**State tracking:**
```json
{
  "pivot": {
    "active": true,
    "name": "modular-arcade",
    "type": "architecture",
    "phase": 1,
    "startedCycle": 15,
    "frozenDepartments": ["rnd", "uxui", "qa"],
    "exemptDepartments": ["infra", "security"]
  }
}
```

### Gate 6 — Phased Execution
**Who:** Department heads execute their tasks
**Rules:**
- Each phase has a checkpoint — must pass before next phase starts
- CEO reviews checkpoint results, issues go/no-go
- If checkpoint fails: PM documents what failed, team fixes, re-checkpoint
- If kill criteria met: abort pivot, execute rollback plan
- **Prototype-first:** Phase 1 should always be a prototype/proof-of-concept on ONE item (e.g., migrate one game, not all seven)

**Per-phase deliverables:**
- Working artifact (code, config, deployment)
- QA validation report
- Updated state.json reflecting new state
- Retrospective note for that phase

### Gate 7 — Pivot Complete
**Who:** CEO + QA sign-off
**Checklist:**
- [ ] All success criteria met
- [ ] All games/features migrated (nothing left on old system)
- [ ] Old system deprecated/removed
- [ ] CORPORATE.md updated to reflect new architecture
- [ ] All department SYSTEM.md files updated
- [ ] state.json `pivot.active` set to false
- [ ] Retrospective written to `confluence/postmortems/PIVOT-<name>-retro.md`
- [ ] Pipeline freeze lifted

## Department Roles During Pivot

| Department | Role |
|-----------|------|
| CEO | Approves proposal, reviews checkpoints, issues go/no-go |
| PM | Writes plan, tracks phases, updates roadmap |
| R&D | Implements changes, prototype first |
| UX/UI | Redesigns affected interfaces |
| QA | Validates each phase, regression testing |
| DevOps/Infra | Infrastructure changes, deployment pipeline updates |
| IT | Naming/standards compliance for new structure |
| Security | Security review of architectural changes |

## Anti-Patterns

- **Big bang pivot** — Changing everything at once. Always phase it. Always prototype first.
- **Phantom pivot** — Departments start changing things without a formal proposal. All pivots go through the 7 gates.
- **Scope creep pivot** — "While we're at it, let's also..." — NO. The pivot doc defines scope. New ideas go to the backlog.
- **Permanent freeze** — Freeze should not exceed 5 cycles. If it does, the pivot is too big — split it.
- **No rollback** — Every pivot must have a rollback plan before Gate 4. No plan = no vote.

## Inbox Integration

Pivot-related messages use a dedicated subject prefix:

```
[PIVOT:<name>] Impact assessment request
[PIVOT:<name>] Phase 1 checkpoint review
[PIVOT:<name>] Go/no-go decision
[PIVOT:<name>] Pivot complete — freeze lifted
```

## Example: Arcade Platform — "Modular Arcade"

**Type:** `architecture`
**Current:** All 7 games in a single `index.html` monolith
**Target:** Each game as an independent module, shared game engine, per-game routing

**Phase 1:** Extract Snake into standalone module, keep monolith running
**Phase 2:** Build shared game engine from Snake extraction learnings
**Phase 3:** Migrate Pong + Breakout using shared engine
**Phase 4:** Migrate remaining 4 games
**Phase 5:** Deprecate monolith, update deployment
