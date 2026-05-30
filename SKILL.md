---
name: corporate-on-demand
description: "Use when building an autonomous multi-agent system with department structure, mandatory pipelines, anti-slop governance, and CEO oversight. Also use when upgrading an existing corporate project to match a newer skill version."
version: 3.6.0
author: Rohi Rikman
license: MIT
platforms: [linux, macos, windows]
related_skills: []
metadata:
  hermes:
    tags: [cron, autonomous, multi-agent, orchestration, governance]
---

# Corporate-on-Demand

Autonomous multi-agent system: specialized departments as staggered cron jobs, each with SYSTEM.md identity, mandatory pipeline, anti-slop contract, and CEO oversight.

## Workflow Routing

| Need | Reference |
|------|-----------|
| **Strategic planning — start here** | `references/strategy-guide.md` |
| Adding departments — full checklist | `references/migration-checklist.md` |
| Folder structure, schedules, state.json, delegation | `references/architecture.md` |
| Department pipelines & enforcement rules | `references/pipelines.md` |
| Banned words, quality grading, slop prevention | `references/anti-slop.md` |
| Failure modes & mitigations (7 pitfalls) | `references/pitfalls.md` |
| Step-by-step cron setup with code examples | `references/setup.md` |
| Template configs for different domains | `references/company-templates.md` |
| Arcade platform case study | `references/example-arcade-platform.md` |


| **C-Suite layer (CEO/CTO/CISO/CPO) — design + planned tools** | `references/csuite-layer-plan.md` |
| **C-Suite improvement roadmap (next steps)** | `references/improvement-roadmap-csuite.md` |
| **Confluence — shared knowledge base (decisions, technical docs, runbooks)** | `references/impl-confluence.md` |

### Implementation Guides

| Feature | Reference |
|---------|-----------|
| DevOps department | `references/impl-devops-dept.md` |
| Cross-department meetings | `references/impl-cross-dept-meetings.md` |
| Project fast-track | `references/impl-fast-track.md` |
| CEO department creation | `references/impl-dept-creation.md` |
| IT department | `references/impl-it-dept.md` |
| HR department | `references/impl-hr-dept.md` |
| QA department | `references/impl-qa-dept.md` |
| Team building (Gibbush) | `references/impl-gibbush.md` |
| Incident response | `references/impl-incident-response.md` |
| KPI dashboard & metrics | `references/impl-kpi-dashboard.md` |
| Department budgets | `references/impl-dept-budgets.md` |
| Retrospectives | `references/impl-retrospectives.md` |
| Mentorship / shadowing | `references/impl-mentorship.md` |
| Security department | `references/impl-security-dept.md` |
| Analytics department | `references/impl-analytics-dept.md` |
| Seasonal events / themes | `references/impl-seasonal-events.md` |
| **Testing strategy (E2E, escalation, TDD)** | `references/impl-testing-strategy.md` |
| **Reporting modes (MANDATORY setup)** | `references/impl-reporting-modes.md` |
| **Pre-publish checklist** | `references/pre-publish-checklist.md` |
| Schedule optimization (QA buffer) | `references/impl-schedule-optimization.md` |
| Publishing & distribution | `references/impl-publishing.md` |
| Full changelog | `CHANGELOG.md` |
| **Pivoting — strategic direction changes** | `references/impl-pivoting.md` |
| **Sprint Mode — temporary org-wide acceleration** | `references/impl-sprint-mode.md` |
| **R&D Labs — default experimentation sandbox** | `references/impl-labs.md` |
| **Public showcase — publishing a project repo** | `references/impl-public-showcase.md` |
| **Public repo showcase `.gitignore`** | `templates/gitignore-public-repo` |
| **Upgrade live project to current skill version** | `references/impl-project-upgrade.md` |
| Newsletter, SLAs, Plugins | `references/impl-ecosystem.md` |

## Upgrading Existing Projects

When the skill gains new features (e.g. confluence, pivoting), deployed projects don't get them automatically. Upgrade checklist:

1. Compare project's CORPORATE.md / SYSTEM.md files against current skill — check for missing sections
2. Patch CORPORATE.md with new sections
3. Patch every department SYSTEM.md with new sections
4. Update state.json with new tracking fields
5. Create any new directories (e.g. `confluence/`)
6. Use `delegate_task` for bulk SYSTEM.md updates — one subagent can patch all 10 departments

## Tools

```bash
BUN=~/.bun/bin/bun  # snap bun is sandboxed, use real binary
SCRIPTS=~/.hermes/skills/devops/corporate-on-demand/scripts

# IMPORTANT: When adding new scripts or skills to this project,
# load the create-skill skill FIRST (skill_view name='create-skill').
# Follow its conventions for structure, naming, and validation.

# Scaffold new project from template (game|saas|content|devtools|homelab|data)
$BUN $SCRIPTS/scaffold.ts --name myproj --path ~/myproj --template saas

# MANDATORY: Configure reporting mode before first run
# See references/impl-reporting-modes.md for all options
# If skipped, defaults to Mode A (all messages delivered — can be noisy)

# Validate deployment
$BUN $SCRIPTS/validate.ts --path ~/myproj

# Status report
$BUN $SCRIPTS/report.ts --path ~/myproj

# Add department to existing project
$BUN $SCRIPTS/add-department.ts --path ~/myproj --name qa --focus "QA testing" --pipeline "test-plan,execute,report"
```

### C-Suite Management

```bash
# Role-specific reports (ceo|cto|ciso|cpo)
$BUN $SCRIPTS/csuite-report.ts --path ~/myproj --role ceo

# CEO grades a department
$BUN $SCRIPTS/grade.ts --path ~/myproj --dept rnd --grade B --reason "Good specs"

# Run a board meeting — collects summaries, writes minutes
$BUN $SCRIPTS/board-meeting.ts --path ~/myproj

# CPO staleness checker for UX/UI
$BUN $SCRIPTS/staleness-check.ts --path ~/myproj
```

### Shared Tools

```bash
# Read/scan department artifacts
$BUN $SCRIPTS/read-artifacts.ts --path ~/myproj --dept rnd,infra --since 24h --format summary

# Read/write state.json fields
$BUN $SCRIPTS/state-rw.ts --path ~/myproj --read grades
$BUN $SCRIPTS/state-rw.ts --path ~/myproj --write grades.rnd=B

# Send inbox messages between departments
$BUN $SCRIPTS/inbox-send.ts --path ~/myproj --to rnd --from ceo --priority high --title "Auth refactor" --body "Details"

# Digest a department's inbox
$BUN $SCRIPTS/inbox-digest.ts --path ~/myproj --dept rnd --status pending --since 24h

# Activity log — append or query
$BUN $SCRIPTS/activity-log.ts --path ~/myproj --append --dept rnd --action "wrote spec"
$BUN $SCRIPTS/activity-log.ts --path ~/myproj --query --since 12h --dept rnd
```

## Pitfalls

- **Gate-skipping during pivots.** The 7-gate pivot flow is strictly sequential. Complete the transition checklist before advancing `pivot.phase`. Skipping causes departments to miss assessments or votes.
- **Pivot-blind cron prompts.** Data-collection scripts should check `state.json pivot.active` and inject pivot context when true. Without this, departments ignore pivots unless CEO manually updates every directive.
- **Inconsistent script variable names.** Scripts use `PROJ` or `PROJECT` for project path. Bulk-patching must handle both. New scripts should use `PROJ` (majority convention).
- **Cron stagger overflow.** scaffold.ts minute offsets can wrap past 59 with >5 depts. Fix: modulo or cap at 55 with smaller increments.
- **Labs is a default R&D capability, not optional.** When creating an R&D department (scaffold or manual), always include `labs/` directory and Labs section in SYSTEM.md. See `impl-labs.md`.
- **Skill update ≠ project upgrade.** After adding a feature to the skill, live projects don't get it automatically. Always check if projects need the 5-gate upgrade flow (`impl-project-upgrade.md`).

## Examples

1. **New SaaS project**: `scaffold.ts --template saas` → creates 15 departments (core 9 + devops, qa, it, security, hr, analytics)
2. **New game studio**: `scaffold.ts --template game` → creates 13 departments (core 9 + devops, qa, it, analytics)
3. **Add QA dept**: `add-department.ts --name qa --pipeline "test-plan,execute,report"` → creates dir, SYSTEM.md, updates CORPORATE.md
4. **Health check**: `validate.ts` → verifies all SYSTEM.md, state.json, inbox formats are correct
5. **Daily standup**: `report.ts` → shows grades, directives, artifact counts, pipeline status

### Template → Department Mapping

Core (all templates): ceo, cto, ciso, cpo, rnd, uxui, infra, pm, board

| Dept | game | saas | content | devtools | homelab | data |
|------|------|------|---------|----------|---------|------|
| devops | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| qa | ✅ | ✅ | — | ✅ | — | ✅ |
| it | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| security | — | ✅ | — | ✅ | ✅ | ✅ |
| hr | — | ✅ | — | — | — | — |
| analytics | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| editorial | — | — | ✅ | — | — | — |

C-Suite SYSTEM.md auto-includes `## Tools` section with script references and `## Oversight Scope`.
C-Suite data-collection scripts call `csuite-report.ts` instead of raw `cat`.
