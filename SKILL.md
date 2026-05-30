---
name: corporate-on-demand
description: "Use when building an autonomous multi-agent system with department structure, mandatory pipelines, anti-slop governance, and CEO oversight."
version: 3.5.0
author: Rohi Rikman
license: MIT
platforms: [linux]
related_skills: [kanban-orchestrator, kanban-worker]
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
| Future ideas & expansion backlog | `references/ideas.md` |
| Honker + sqlite-vec v2 architecture research | `references/honker-sqlite-vec-integration.md` |
| **v2 architecture (Honker + sqlite-vec)** | `references/v2-honker-sqlite-vec.md` |
| LanceDB + Honker event-driven architecture | `references/lancedb-honker-integration.md` |
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
| Newsletter, SLAs, Labs, Plugins | `references/impl-ecosystem.md` |
| **Confluence shared knowledge base** | `references/impl-confluence.md` |

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

- **Review the live project, not just the skill.** When the user asks "what can we improve?", inspect the actual deployed project (state.json, departments/, cron jobs, artifacts) against the skill's features. Don't just compare skill docs to each other.
- **Snap bun is sandboxed.** Use `~/.bun/bin/bun` (real binary) for scripts that access paths outside the snap sandbox (e.g. via symlinks like `.hermes`).
- **Use create-skill workflow for new tooling.** When adding scripts/tools to this skill, follow the create-skill workflow (SKILL.md router + references/ + scripts/, validate). Don't just dump raw files.
- **Cron stagger overflow.** scaffold.ts uses minute offsets [0, 25, 50, 75, 100] for regular depts — 100 is invalid (cron minutes max 59). When >5 regular depts exist, offset wraps past 59. Fix: use modulo or cap at 55 with smaller increments.
- **"What can we improve?" means the LIVE PROJECT, not the skill.** When asked about improvements, inspect the actual deployed project (state.json, departments/, artifacts, cron jobs) against the full skill feature set. Don't compare skill docs to each other — compare skill capabilities to what the project is actually using.
- **Duplicate nested skill dir.** `skills/corporate-on-demand/SKILL.md` exists inside the skill dir itself — causes ambiguity. `skill_view` refuses with "Ambiguous skill name" but `skill_manage` resolves correctly to the top-level skill. Workaround for reading: use `skill_view(name='devops/corporate-on-demand')` with the category prefix when the bare name fails. Fix: delete `~/.hermes/skills/devops/corporate-on-demand/skills/corporate-on-demand/`.

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
