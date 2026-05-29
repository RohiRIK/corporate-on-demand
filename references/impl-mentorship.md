# Mentorship / Department Shadowing

## Overview

The CEO can direct one department to review another's work, breaking silos and catching blind spots. This requires **zero new infrastructure** — it's purely a directive pattern using existing SYSTEM.md and cycle mechanics.

## How It Works

The CEO includes a shadowing directive in the target department's cycle instructions:

```
UX/UI: This cycle, review R&D's latest spec at departments/rnd/specs/multiplayer.md 
and provide feedback in departments/uxui/reviews/rnd-multiplayer-review.md.
Focus on: user-facing implications, missing edge cases, accessibility.
```

The shadowing department:
1. Reads the referenced artifact
2. Writes a review document in their own department folder
3. Optionally flags items for the original department

## Shadowing Combinations & Benefits

### R&D → UX/UI
- **R&D reviews UX/UI designs**: Catches technically infeasible designs early
- **Output**: `departments/rnd/reviews/uxui-<feature>-review.md`
- **Gains**: Fewer "can't implement this" surprises mid-build

### UX/UI → R&D
- **UX/UI reviews R&D specs**: Catches poor UX in technical designs
- **Output**: `departments/uxui/reviews/rnd-<feature>-review.md`
- **Gains**: User experience considered before code is written

### QA → PM
- **QA reviews PM specs**: Catches untestable requirements
- **Output**: `departments/qa/reviews/pm-<spec>-review.md`
- **Gains**: Better acceptance criteria, fewer "what does done mean?" loops

### PM → DevOps
- **PM reviews deployment plans**: Catches missing rollback plans, user-impact gaps
- **Output**: `departments/pm/reviews/devops-<plan>-review.md`
- **Gains**: Deployment communications planned in advance

### DevOps → QA
- **DevOps reviews test infrastructure**: Catches flaky test setups, missing CI coverage
- **Output**: `departments/devops/reviews/qa-<area>-review.md`
- **Gains**: More reliable test pipeline

## Directive Patterns

### One-time review
```
QA: Review R&D's latest commit to src/games/ and report any untested code paths.
Write findings to departments/qa/reviews/rnd-games-coverage.md.
```

### Recurring shadow
```
UX/UI: Every 4th cycle, review PM's latest roadmap and flag UX risks.
```

### Mutual review
```
R&D and QA: Exchange reviews this cycle.
R&D: review QA's test plan for arcade-v2.
QA: review R&D's implementation of arcade-v2.
```

## Review Document Template

```markdown
# Shadow Review — [Reviewer Dept] → [Reviewed Dept]
**Date**: YYYY-MM-DD
**Artifact reviewed**: [path to document/code]

## Summary
[1-2 sentence overview]

## Observations
- [Finding 1 — specific, with file/line references]
- [Finding 2]

## Recommendations
- [Actionable suggestion]

## Questions for [Reviewed Dept]
- [Anything unclear that needs clarification]
```

## Example

**CEO directive (cycle 15):**
> "PM: This cycle, shadow QA's test results from the last 3 cycles. Identify any patterns in recurring failures and recommend spec improvements. Write to departments/pm/reviews/qa-failure-patterns.md."

**PM output:**
> "Pattern: 60% of QA failures trace to missing error handling in R&D code. Recommendation: add 'error scenarios' section to spec template."

**CEO action:**
> Updates R&D SYSTEM.md to require error scenario documentation in specs.

## Guards & Constraints

- **Read-only access**: Shadowing departments review but do NOT modify the other department's files.
- **No scope creep**: Review is bounded to the specific artifact named in the directive.
- **Budget-free**: Shadow reviews cost 1 token (the review document) — they don't consume the reviewed department's budget.
- **CEO-initiated only**: Departments don't self-assign shadows. The CEO decides who reviews whom and when.
- **Constructive only**: Reviews must include actionable recommendations, not just criticism.
