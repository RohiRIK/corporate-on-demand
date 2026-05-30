# Confluence — Shared Knowledge Base

Internal wiki where departments document decisions, technical knowledge, and operational procedures.

## Why

Without a shared knowledge base:
- Decisions get lost in board minutes and improvement logs
- Technical knowledge lives only in the head of the department that discovered it
- New departments can't learn from past work
- The same question gets researched twice

## Structure

```
<project>/
└── confluence/
    ├── decisions/          ← ADRs (Architecture Decision Records)
    ├── technical/          ← Deep-dives, how things work, gotchas
    ├── runbooks/           ← Operational procedures (cross-dept)
    └── postmortems/        ← What went wrong, root cause, action items
```

### File Naming

```
confluence/<category>/<YYYY-MM-DD>-<slug>.md
```

Example: `confluence/decisions/2026-05-28-monolith-vs-modules.md`

## Document Template

Every confluence doc follows this format:

```markdown
# <Title>

**Author**: <department>
**Date**: <YYYY-MM-DD>
**Status**: draft | approved | superseded
**Supersedes**: <link to old doc, if applicable>

## Context

What situation triggered this document. What problem or question came up.

## Decision / Content

The actual decision, explanation, or procedure.

## Consequences

What changes as a result. Trade-offs accepted. What to watch for.

## References

Links to related specs, research, logs, or external resources.
```

## Who Writes What

| Category | Primary Authors | Approval |
|----------|----------------|----------|
| `decisions/` | Any dept proposing a change | Board or CEO review |
| `technical/` | R&D, Infra, DevOps, Security | Self-publish |
| `runbooks/` | Infra, DevOps, Security | Self-publish |
| `postmortems/` | Dept that owned the incident | CEO review |

## Pipeline Integration

### For departments with existing pipelines

Confluence writing is **optional and additive** — it doesn't replace existing pipelines. Departments write to confluence when:

1. **A decision is made** that affects other departments (→ `decisions/`)
2. **A non-obvious technical pattern** is discovered during implementation (→ `technical/`)
3. **A procedure** is created that others might need (→ `runbooks/`)
4. **An incident** is resolved and has lessons (→ `postmortems/`)

### Anti-slop rules for confluence

- No docs that just restate what's in a spec or design doc — link to the original instead
- No "we decided to do X" without explaining **why** and what alternatives were considered
- No runbooks without exact commands — vague "restart the service" is banned
- Every doc must be findable: clear title, correct category, proper date prefix
- `superseded` status requires a link to the replacement doc

### Board Meeting integration

Board meetings should reference relevant confluence docs and can request new ones:
- "R&D: document the canvas rendering approach in confluence/technical/"
- "Infra: write a runbook for log rotation in confluence/runbooks/"

### PM integration

PM tracks confluence activity in changelogs and reports:
- New docs → changelog under "## Documentation"
- Doc count and staleness → weekly report

## Scaffold Setup

When using `scaffold.ts`, the confluence directory structure is created automatically.

For existing projects, create manually:

```bash
mkdir -p confluence/{decisions,technical,runbooks,postmortems}
```

### SYSTEM.md additions

Add to every department's SYSTEM.md:

```markdown
## Confluence
You may write to `confluence/` when you make a decision, discover a technical insight,
or create a reusable procedure. Follow the template in CORPORATE.md.
Categories: decisions/, technical/, runbooks/, postmortems/.
```

### CORPORATE.md additions

Add a section to CORPORATE.md explaining the confluence system, template, and categories.

### State.json tracking (optional)

Add to state.json for CEO visibility:

```json
{
  "confluence": {
    "totalDocs": 0,
    "lastUpdated": null,
    "byCategory": {
      "decisions": 0,
      "technical": 0,
      "runbooks": 0,
      "postmortems": 0
    }
  }
}
```

## Example Documents

### Decision: Single HTML vs Modular Games

```markdown
# Single HTML vs Modular Game Files

**Author**: R&D
**Date**: 2026-05-28
**Status**: approved

## Context
As game count grows (now 7), all game code lives in a single index.html.
Each new game adds ~200-400 lines. File is becoming hard to navigate.

## Decision
Keep single-file approach for now. Reasons:
1. No build tooling needed — games are vanilla JS
2. nginx serves one file — simpler Docker setup
3. Shared utilities (canvas, input handling) are inline

Revisit when game count exceeds 10 or file exceeds 5000 lines.

## Consequences
- R&D must keep functions well-named and isolated (startSnake, startPong, etc.)
- Code style standard applies within the single file
- Infra monitors file size in audits
```

### Technical: Canvas Rendering Pattern

```markdown
# Canvas Rendering Pattern

**Author**: R&D
**Date**: 2026-05-29
**Status**: approved

## Context
All games share a 600x400 canvas. Documenting the standard pattern.

## Content
Every game function:
1. Gets canvas via `document.getElementById('gameCanvas')`
2. Sets width=600, height=400
3. Uses requestAnimationFrame loop
4. Clears canvas each frame with fillRect
5. Handles keyboard via document.addEventListener('keydown', ...)
6. R key always restarts

## References
- Code style standard: departments/pm/standards/code-style.md
```
