# Ecosystem Extensions

## Overview

This document covers four complementary systems that enrich the corporate-on-demand model: Internal Newsletter, SLA Contracts, R&D Labs/Skunkworks, and External Partnerships/Plugin Ecosystem.

---

## 1. Internal Newsletter

### Concept
PM writes a regular digest summarizing what happened across all departments. Keeps the "company" aligned without every department reading every other department's output.

### Output
`departments/pm/newsletters/<date>.md`

### Cadence
- Daily (brief) or every 4 cycles (detailed) — CEO configures

### Newsletter Template

```markdown
# Company Newsletter — YYYY-MM-DD

## Headlines
- [Biggest development this period]

## Department Updates
### R&D
- [Key changes, new features in progress]

### UX/UI  
- [Design updates, theme changes]

### QA
- [Test results, quality trends]

### DevOps
- [Infrastructure changes, deployments]

## Upcoming
- [What's planned for next period]

## Metrics Snapshot
- Cycle: N | Open issues: X | Grade avg: B+
```

### Implementation
1. Add newsletter task to PM's SYSTEM.md
2. PM reads all department outputs from the current period
3. PM writes digest — concise, no editorializing
4. CEO reviews and may add a "CEO note" section

---

## 2. SLA Contracts

### Concept
Formal response-time commitments between departments, tracked in state.json. Example: "QA will complete test runs within 2 cycles of receiving R&D output."

### state.json Schema

```json
{
  "slas": {
    "qa_test_turnaround": {
      "from": "rnd",
      "to": "qa",
      "commitment": "Test results within 2 cycles of R&D delivery",
      "max_cycles": 2,
      "violations": 0,
      "last_checked": "2025-01-15"
    },
    "pm_spec_delivery": {
      "from": "pm",
      "to": "rnd",
      "commitment": "Specs delivered before R&D cycle starts",
      "max_cycles": 1,
      "violations": 1,
      "last_checked": "2025-01-15"
    }
  }
}
```

### Implementation
1. CEO defines SLAs in state.json
2. CEO checks SLA compliance during review cycles
3. Violations are logged: `violations` counter incremented
4. Repeated violations trigger CEO intervention (budget reduction, process change)

### Example SLAs
- QA tests R&D output within 2 cycles
- PM delivers specs before R&D cycle begins
- DevOps deploys approved changes within 1 cycle
- UX/UI provides mockups within 2 cycles of PM spec

---

## 3. R&D Labs / Skunkworks

## 3. R&D Labs / Skunkworks

> **Promoted to core R&D feature.** See `references/impl-labs.md` for the
> full spec. Labs is now a default R&D capability — scaffold.ts creates
> the `labs/` directory automatically.

---

## 4. External Partnerships / Plugin Ecosystem

### Concept
A pipeline for external (or user-submitted) plugins/games to be reviewed and integrated. Formalizes the path from submission to shipping.

### Submission Format

```markdown
# Plugin Submission: [Name]
**Author**: [Name/handle]
**Type**: game | utility | theme | integration
**Description**: [What it does]
**Files**: [List of files included]
**Dependencies**: [Any new dependencies required]
**License**: [Must be compatible with project license]
```

Submissions go to: `submissions/<name>/`

### Review Pipeline

```
submit → PM review → QA test → R&D integration → CEO approval → ship

1. SUBMIT:  External contributor places submission in submissions/
2. PM:      Reviews fit with roadmap, checks completeness
3. QA:      Tests for bugs, security, performance
4. R&D:    Integrates into codebase (if approved)
5. CEO:    Final approval and ship decision
```

### state.json Schema

```json
{
  "submissions": {
    "cool-puzzle-game": {
      "status": "qa_review",
      "submitted": "2025-01-10",
      "reviewer": "pm",
      "qa_passed": false,
      "rnd_integrated": false,
      "ceo_approved": false
    }
  }
}
```

### Implementation
1. Create `submissions/` directory
2. Add submission review tasks to PM, QA, and R&D SYSTEM.md files
3. CEO tracks submission status in state.json
4. Each stage writes a review document in their department folder
5. CEO makes final ship/reject decision

---

## Guards & Constraints (All Systems)

- **Newsletter**: PM must be factual — no spin. CEO can correct before distribution.
- **SLAs**: Violations are tracked, not punished automatically. CEO decides consequences.
- **Labs**: Labs code is explicitly NOT production-ready. Any direct copy to src/ without graduation is a violation.
- **Submissions**: External code gets full QA treatment. No fast-tracking. Security review mandatory.
- **Budget impact**: All these activities consume department budget tokens. CEO must account for them when allocating budgets.
