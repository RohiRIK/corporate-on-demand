---
name: corporate-on-demand
description: "Use when building an autonomous multi-agent system with department structure, mandatory pipelines, anti-slop governance, and CEO oversight. Also use when upgrading an existing corporate project to match a newer skill version."
version: 3.9.1
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

> **Pick one or two.** Don't load more. The full pitfalls list (A./B./C./D.) is in
> `references/pitfalls.md` and the implementation guides are below. Most cycles only
> need SKILL.md + the one or two references that match the current task.

| Need | Reference |
|------|-----------|
| **Strategic planning — start here** | `references/strategy-guide.md` |
| Failure modes, mitigations (60+ pitfalls) | `references/pitfalls.md` |
| Folder structure, schedules, state.json, delegation | `references/architecture.md` |
| Department pipelines, enforcement rules | `references/pipelines.md` |
| Banned words, quality grading, slop prevention | `references/anti-slop.md` |
| Step-by-step cron setup | `references/setup.md` |
| 6 project templates (game, saas, content, devtools, homelab, data) | `references/company-templates.md` |
| Migration checklist (adding departments to existing project) | `references/migration-checklist.md` |
| Arcade platform case study | `references/example-arcade-platform.md` |
| C-Suite design + planned tools | `references/csuite-layer-plan.md` |
| C-Suite improvement roadmap | `references/improvement-roadmap-csuite.md` |
| Confluence — decisions/technical/runbooks/postmortems | `references/impl-confluence.md` |
| Full version history | `CHANGELOG.md` |
| Process lessons from live ops | `arcade-platform-changelog-2026-06.md` |

### Implementation Guides

| Need | Reference |
|------|-----------|
| DevOps / IT / HR / QA / Security / Analytics dept setup | `impl-{name}-dept.md` |
| Cross-department meetings | `impl-cross-dept-meetings.md` |
| Project fast-track | `impl-fast-track.md` |
| CEO creates new dept | `impl-dept-creation.md` |
| Team building (Gibbush) | `impl-gibbush.md` |
| Incident response | `impl-incident-response.md` |
| KPI dashboard & metrics | `impl-kpi-dashboard.md` |
| Department budgets | `impl-dept-budgets.md` |
| Retrospectives | `impl-retrospectives.md` |
| Mentorship / shadowing | `impl-mentorship.md` |
| Seasonal events | `impl-seasonal-events.md` |
| Testing strategy (E2E, escalation, TDD) | `impl-testing-strategy.md` |
| Dev workflows (TDD, E2E-first, spike) | `impl-dev-workflows.md` |
| Reporting modes (MANDATORY setup) | `impl-reporting-modes.md` |
| Pre-publish checklist | `pre-publish-checklist.md` |
| Schedule optimization (QA buffer) | `impl-schedule-optimization.md` |
| Publishing & distribution | `impl-publishing.md` |
| Directive propagation status check | `impl-directive-status-check.md` |
| QA workflow templates | `qa-workflow-templates.md` |
| Browser game testing patterns | `browser-game-testing.md` |
| Pivoting — 7-gate strategic changes | `impl-pivoting.md` |
| Sprint Mode — org-wide acceleration | `impl-sprint-mode.md` |
| Sprint Mode upgrade checklist | `sprint-mode-upgrade-checklist.md` |
| R&D Labs — experimentation sandbox | `impl-labs.md` |
| Public showcase — publish a project repo | `impl-public-showcase.md` |
| README & public docs ownership | `impl-readme-ownership.md` |
| Public repo `.gitignore` template | `templates/gitignore-public-repo` |
| Upgrade live project to current version | `impl-project-upgrade.md` |
| Role expansion — fill dept gaps | `impl-role-expansion.md` |
| C-Level accountability & merger | `impl-clevel-accountability.md` |
| Self-improving prompts (HR→CTO→CEO loop) | `impl-self-improving-prompts.md` |
| Newsletter, SLAs, Plugins | `impl-ecosystem.md` |
| External PT via OpenCode | `impl-external-pt.md` |
| **Prompt optimization — DSPy + DeepEval + Promptfoo** | `impl-prompt-optimization.md` |

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

Full list (60+ pitfalls) lives in [`references/pitfalls.md`](references/pitfalls.md) — organized by A. universal, B. games/interactive content, C. static hosting, D. cross-references. Top 3 universal patterns every agent should know cold:

- **A30 — HARD RULE: agent does not do department work.** The agent is the Board/CEO. The user asks → write decision doc → update state.json directives → send inbox. Never edit project files directly (no code, no infra, no Docker). Only exception: P1-CRITICAL security with no time for a cron cycle.
- **A31 — Cron prompt ≠ SYSTEM.md.** Inbox processing must be Step 0 in every cron prompt. SYSTEM.md is reference material; the cron prompt is what runs. If they're out of sync, directives sit unprocessed.
- **A32 — Deploy gap.** Fixes in repo ≠ fixes live. Always test localhost + production before reporting a bug as fixed. If localhost passes but production fails, the fix just needs a push.

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
| hr | ✅ | ✅ | — | ✅ | — | — |
| analytics | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| editorial | — | — | ✅ | — | — | — |

C-Suite SYSTEM.md auto-includes `## Tools` section with script references and `## Oversight Scope`.
C-Suite data-collection scripts call `csuite-report.ts` instead of raw `cat`.
