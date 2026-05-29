---
name: corporate-on-demand
description: "Use when building an autonomous multi-agent system with department structure, mandatory pipelines, anti-slop governance, and CEO oversight."
version: 3.4.0
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
| Full changelog | `CHANGELOG.md` |
| Newsletter, SLAs, Labs, Plugins | `references/impl-ecosystem.md` |

## Tools

```bash
BUN=~/.bun/bin/bun  # snap bun is sandboxed, use real binary
SCRIPTS=~/.hermes/skills/devops/corporate-on-demand/scripts

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

## Examples

1. **New game studio**: `scaffold.ts --template game` → creates rnd/uxui/infra/pm/board/ceo departments with game-specific SYSTEM.md files
2. **Add QA dept**: `add-department.ts --name qa --pipeline "test-plan,execute,report"` → creates dir, SYSTEM.md, updates CORPORATE.md
3. **Health check**: `validate.ts` → verifies all SYSTEM.md, state.json, inbox formats are correct
4. **Daily standup**: `report.ts` → shows grades, directives, artifact counts, pipeline status
