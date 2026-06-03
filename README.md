<div align="center">

```
 ██████╗ ██████╗ ██████╗ ██████╗  ██████╗ ██████╗  █████╗ ████████╗███████╗
██╔════╝██╔═══██╗██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔══██╗╚══██╔══╝██╔════╝
██║     ██║   ██║██████╔╝██████╔╝██║   ██║██████╔╝███████║   ██║   █████╗  
██║     ██║   ██║██╔══██╗██╔═══╝ ██║   ██║██╔══██╗██╔══██║   ██║   ██╔══╝  
╚██████╗╚██████╔╝██║  ██║██║     ╚██████╔╝██║  ██║██║  ██║   ██║   ███████╗
 ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝      ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
                  ██████╗ ███╗   ██╗    ██████╗ ███████╗███╗   ███╗ █████╗ ███╗   ██╗██████╗ 
                 ██╔═══██╗████╗  ██║    ██╔══██╗██╔════╝████╗ ████║██╔══██╗████╗  ██║██╔══██╗
                 ██║   ██║██╔██╗ ██║    ██║  ██║█████╗  ██╔████╔██║███████║██╔██╗ ██║██║  ██║
                 ██║   ██║██║╚██╗██║    ██║  ██║██╔══╝  ██║╚██╔╝██║██╔══██║██║╚██╗██║██║  ██║
                 ╚██████╔╝██║ ╚████║    ██████╔╝███████╗██║ ╚═╝ ██║██║  ██║██║ ╚████║██████╔╝
                  ╚═════╝ ╚═╝  ╚═══╝    ╚═════╝ ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ 
```

**Autonomous multi-agent corporate system for self-evolving projects**

*Departments. Pipelines. Anti-slop. C-Suite oversight. Runs while you sleep.*

🕹️ **[Live Demo: Arcade Platform](https://github.com/RohiRIK/arcade-platform)** — 7 games, 16 departments, fully autonomous. See Corporate on Demand in action.

[![Version](https://img.shields.io/badge/version-3.9.1-blue?style=flat-square)]()
[![Hermes](https://img.shields.io/badge/hermes--agent-skill-purple?style=flat-square)](https://hermes-agent.nousresearch.com)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)]()
[![Departments](https://img.shields.io/badge/departments-16-orange?style=flat-square)]()
[![Impl Guides](https://img.shields.io/badge/impl%20guides-33%2B-yellow?style=flat-square)]()
[![Docs](https://img.shields.io/badge/docs-51%2B%20files-brightgreen?style=flat-square)]()

</div>

---

## What is this?

A [Hermes Agent](https://hermes-agent.nousresearch.com) skill that turns cron jobs into an autonomous corporation. Each department is an AI agent running on a schedule — with its own identity, mandatory pipeline, quality contract, and inbox. A full C-Suite (CEO, CTO, CISO, CPO) oversees everything, and a Board provides strategic direction.

**The result**: your project improves itself while you sleep. You wake up to a morning report of what happened overnight.

```
                              ┌─────────────────┐
                              │    👤 Human      │
                              │  morning report  │
                              │   @ 08:00        │
                              └────────┬─────────┘
                                       │ reads
                              ┌────────▼─────────┐
                              │   🤵 CEO Agent   │
                              │  inspects 2x/day │
                              │  grades A-F      │
                              │  issues directives│
                              │  activates sprints│
                              └────────┬─────────┘
                                       │ oversees
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
     ┌────────▼──────┐       ┌────────▼────────┐      ┌───────▼───────┐
     │  C-Suite       │       │  state.json     │      │  📬 Inboxes   │
     │  CTO · CISO    │       │  shared brain   │      │  cross-dept   │
     │  CPO · CFO     │       │  pipeline       │      │  communication│
     └────────┬───────┘       │  grades · pivot │      └───────────────┘
              │               │  sprint mode    │
              │               └─────────────────┘
    ┌─────────┼─────────────────────────────────────┐
    │         │         │         │         │        │
┌───▼──┐ ┌───▼──┐ ┌───▼───┐ ┌──▼───┐ ┌───▼──┐ ┌──▼────┐
│🔬 R&D│ │🎨 UX │ │🔧Infra│ │📋 PM │ │🏛Board│ │🎭Crea-│
│+Labs │ │ /UI  │ │      │ │      │ │      │ │ tive  │
└──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └───────┘

┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌───────┐
│🛡️ QA │ │🖥️ IT │ │👷DevOp│ │🔒Sec │ │📊Anal│ │💰 CFO │
└──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └───────┘
```

---

## Quick Start

### 1. Scaffold a project

```bash
BUN=~/.bun/bin/bun
$BUN scripts/scaffold.ts --name my-arcade --path ~/my-arcade --template game
```

Templates: `game` | `saas` | `content` | `devtools` | `homelab` | `data`

### 2. Configure reporting mode (MANDATORY)

```bash
# See references/impl-reporting-modes.md
# Default is Mode A (all messages delivered) — usually too noisy
```

### 3. Validate the setup

```bash
$BUN scripts/validate.ts --path ~/my-arcade
```

### 4. Set up cron jobs

See [`references/setup.md`](references/setup.md) for the full cron setup with Hermes Agent.

### 5. Watch it run

Morning report arrives at 08:00 on Telegram. CEO inspects twice daily. Departments run every 2h. You wake up to a changelog.

---

## Features

| Feature | What it does |
|---------|-------------|
| 🏢 **16 departments** | Operational (R&D, UX/UI, Infra, PM, Board, QA, IT, DevOps, Security, Analytics, Creative) + C-Suite (CEO, CTO, CISO, CPO, CFO) |
| 📋 **Mandatory pipelines** | R&D: research→pitch→spec→build. No skipping steps. |
| 🚫 **Anti-slop contract** | Banned words list, concrete output rules, CEO grades A-F |
| 📬 **Inbox communication** | Cross-department tasks via structured inbox files |
| 🧠 **Shared state** | `state.json` — directives, pipeline status, grades, pivot tracking |
| 🤵 **C-Suite oversight** | CEO inspects + grades. CTO reviews architecture + department relevance. CISO audits security. CPO guards product quality. CFO tracks budgets. |
| 📰 **Morning/Evening reports** | Daily briefings delivered to Telegram |
| ⚡ **Fast-track** | CEO accelerates a single project — 2 pipeline steps per cycle |
| 🚀 **Sprint Mode** | Temporary org-wide acceleration — 6 levers: cron boost, parallel tracks, multi fast-track, C-suite bump, daily standups, scope lock. CEO/PM/Board can propose. Max 5 days. |
| 🔄 **Pivoting** | 7-gate process for strategic direction changes. Proposal → assessment → plan → board vote → freeze → execution → sign-off |
| 🔬 **R&D Labs** | Default experimentation sandbox. No pitch/spec needed. Graduation path to production pipeline. |
| 📚 **Confluence** | Shared knowledge base — decisions, technical docs, runbooks, postmortems |
| 🎉 **Gibbush days** | Pipeline-free experimentation cycles to prevent staleness |
| 🚨 **Incident response** | P1/P2/P3 severity, incident mode, postmortems |
| 📊 **KPI dashboard** | Objective metrics per department |
| 🔧 **Project upgrade** | 5-gate flow to upgrade existing projects when skill evolves |
| 🧠 **Self-improving prompts** | Distill recurring CEO feedback into versioned prompt lines (HR→CTO→CEO). Dormant until v2 DB. |
| 🛡 **External PT** | Weekly OpenCode + DeepSeek scan, Security owns triage. |
| 🧬 **Prompt optimization (v3.9.1)** | DSPy + DeepEval + Promptfoo — the skill improves its own task prompts. HR→CTO→CEO loop, LLM-agnostic. |

### Token Optimization (v3.9.0)

The skill used to load its full pitfall list on every cron cycle. v3.9.0 changed that:

- **SKILL.md** — 228 → 185 lines. Routing table trimmed to 2–4 word tags. Only the 3 universal pitfalls (A30, A31, A32) stay inline.
- **60+ pitfalls** — Moved to `references/pitfalls.md`, organized A. universal / B. games / C. static hosting / D. cross-refs. Domain-specific pitfalls no longer pollute non-applicable projects.
- **Top 5 largest impl guides** — `impl-hr-dept`, `impl-sprint-mode`, `impl-testing-strategy`, `impl-it-dept`, `strategy-guide` all have TL;DR sections. Agents can bail at the TL;DR if the doc isn't relevant.
- **Pitfalls deduplicated** — "Cron prompt ≠ SYSTEM.md" appeared twice; "Pre-push QA gate" and "Auto-deploy cron bypass" were split. Merged.

### Prompt Optimization (v3.9.1)

The skill can now **improve its own task prompts** through the HR→CTO→CEO loop using LLM-agnostic open-source tools:

- **DSPy** (Stanford, MPL-2.0) — the iterative "revisit and re-improve" engine. GEPA optimizer reflects on what worked, proposes better instructions, iterates.
- **DeepEval** (Apache 2.0) — the v1-vs-v2 judge. Custom GEval metric decides if v2 actually beats v1.
- **Promptfoo** (MIT) — the pre-publish regression gate. Blocks deploys on prompt regression.

Three new scripts: `prompt-optimize.ts`, `prompt-eval.ts`, `prompt-regression.ts`. See [`references/impl-prompt-optimization.md`](references/impl-prompt-optimization.md) for the workflow.

---

## Maturity Model

Start small, grow organically. The [strategy guide](references/strategy-guide.md) tells you exactly when to add what.

```
Stage 0: Idea          ──→  CEO + R&D + Infra (3 depts)
                              │
Stage 1: MVP           ──→  + UX/UI + PM (5 depts)
                              │
Stage 2: Growing       ──→  + Board + QA (7 depts)
                              │
Stage 3: Mature        ──→  + IT + DevOps + Security (10 depts)
                              │
Stage 4: Enterprise    ──→  + C-Suite (CTO/CISO/CPO/CFO) + Analytics + Creative (16 depts)
```

---

## Project Structure

```
your-project/
├── backend/                    # Application backend
├── frontend/                   # Application frontend
├── departments/
│   ├── CORPORATE.md            # Master governance doc
│   ├── DELEGATION.md           # Cross-dept communication protocol
│   ├── ceo/                    # CEO oversight + directives
│   ├── cto/                    # Technical oversight
│   ├── ciso/                   # Security posture
│   ├── cpo/                    # Product quality
│   ├── cfo/                    # Budget tracking
│   ├── rnd/
│   │   ├── SYSTEM.md           # R&D identity & pipeline
│   │   ├── research/           # Research docs
│   │   ├── pitches/            # Pitch documents
│   │   ├── specs/              # Implementation specs
│   │   ├── labs/               # Experimentation sandbox (default)
│   │   └── inbox/              # Tasks from other depts
│   ├── uxui/                   # Design, CSS, user experience
│   ├── infra/                  # Docker, health, networking
│   ├── pm/                     # Documentation, changelogs
│   ├── board/                  # Strategy, meeting minutes
│   ├── qa/                     # Testing, quality assurance
│   ├── it/                     # File management, maintenance
│   ├── devops/                 # CI/CD, deployment pipelines
│   ├── security/               # Vulnerability audits
│   ├── analytics/              # Metrics, data analysis
│   └── creative/               # Game scripts, visual direction
├── confluence/
│   ├── decisions/              # Strategic decisions + pivot docs
│   ├── technical/              # Technical documentation
│   ├── runbooks/               # Operational runbooks
│   └── postmortems/            # Incident postmortems
├── state.json                  # Shared coordination brain
├── logs/                       # Per-cycle JSON logs
└── docker-compose.yml          # Infrastructure
```

---

## Tools

| Script | Purpose |
|--------|---------|
| `scaffold.ts` | Scaffold entire project from template |
| `validate.ts` | Run structural checks on deployment |
| `report.ts` | Generate status report with grades and metrics |
| `add-department.ts` | Add a department to an existing project |
| `csuite-report.ts` | C-Suite role-specific reports |
| `grade.ts` | CEO grades a department |
| `board-meeting.ts` | Run a board meeting — collect summaries, write minutes |
| `inbox-send.ts` | Send inbox messages between departments |
| `inbox-digest.ts` | Digest a department's inbox |
| `read-artifacts.ts` | Read/scan department artifacts |
| `state-rw.ts` | Read/write state.json fields |
| `activity-log.ts` | Append or query activity log |
| `staleness-check.ts` | CPO staleness checker for UX/UI |

```bash
BUN=~/.bun/bin/bun
SCRIPTS=path/to/corporate-on-demand/scripts

# Scaffold
$BUN $SCRIPTS/scaffold.ts --name myproj --path ~/myproj --template saas

# Validate
$BUN $SCRIPTS/validate.ts --path ~/myproj

# Report
$BUN $SCRIPTS/report.ts --path ~/myproj

# Grade a department
$BUN $SCRIPTS/grade.ts --path ~/myproj --dept rnd --grade B --reason "Good specs"

# Board meeting
$BUN $SCRIPTS/board-meeting.ts --path ~/myproj

# Send inbox message
$BUN $SCRIPTS/inbox-send.ts --path ~/myproj --to rnd --from ceo --priority high \
  --title "Auth refactor" --body "Details"
```

---

## Documentation Map

### Core

| Doc | What |
|-----|------|
| [`strategy-guide.md`](references/strategy-guide.md) | 🗺️ **Start here** — classify project, choose depts & mechanisms |
| [`architecture.md`](references/architecture.md) | Folder structure, schedules, state.json schema |
| [`pipelines.md`](references/pipelines.md) | Mandatory pipeline rules per department |
| [`anti-slop.md`](references/anti-slop.md) | Quality contract, banned words, CEO grading |
| [`pitfalls.md`](references/pitfalls.md) | Failure modes with mitigations |
| [`setup.md`](references/setup.md) | Step-by-step cron setup guide |
| [`company-templates.md`](references/company-templates.md) | 6 project templates |

### Implementation Guides

| Guide | What |
|-------|------|
| [`impl-sprint-mode.md`](references/impl-sprint-mode.md) | 🚀 Temporary org-wide acceleration (6 levers, max 5 days) |
| [`impl-pivoting.md`](references/impl-pivoting.md) | 🔄 7-gate strategic direction changes |
| [`impl-labs.md`](references/impl-labs.md) | 🔬 R&D experimentation sandbox (default) |
| [`impl-confluence.md`](references/impl-confluence.md) | 📚 Shared knowledge base |
| [`impl-project-upgrade.md`](references/impl-project-upgrade.md) | 🔧 5-gate project upgrade flow |
| [`impl-cross-dept-meetings.md`](references/impl-cross-dept-meetings.md) | Cross-department meetings |
| [`impl-fast-track.md`](references/impl-fast-track.md) | Single-project acceleration |
| [`impl-incident-response.md`](references/impl-incident-response.md) | P1/P2/P3 incident handling |
| [`impl-dept-creation.md`](references/impl-dept-creation.md) | CEO creates new departments |
| [`impl-qa-dept.md`](references/impl-qa-dept.md) | QA department setup |
| [`impl-devops-dept.md`](references/impl-devops-dept.md) | DevOps department setup |
| [`impl-it-dept.md`](references/impl-it-dept.md) | IT department setup |
| [`impl-security-dept.md`](references/impl-security-dept.md) | Security department setup |
| [`impl-analytics-dept.md`](references/impl-analytics-dept.md) | Analytics department setup |
| [`impl-hr-dept.md`](references/impl-hr-dept.md) | HR department setup |
| [`impl-kpi-dashboard.md`](references/impl-kpi-dashboard.md) | KPI metrics dashboard |
| [`impl-dept-budgets.md`](references/impl-dept-budgets.md) | Department budget tracking |
| [`impl-testing-strategy.md`](references/impl-testing-strategy.md) | 7-layer testing strategy |
| [`impl-reporting-modes.md`](references/impl-reporting-modes.md) | Configure what delivers to Telegram |
| [`impl-schedule-optimization.md`](references/impl-schedule-optimization.md) | QA buffer + cron stagger |
| [`impl-gibbush.md`](references/impl-gibbush.md) | Pipeline-free experimentation days |
| [`impl-retrospectives.md`](references/impl-retrospectives.md) | Department retrospectives |
| [`impl-mentorship.md`](references/impl-mentorship.md) | Cross-department mentorship |
| [`impl-seasonal-events.md`](references/impl-seasonal-events.md) | Seasonal themes and events |
| [`impl-ecosystem.md`](references/impl-ecosystem.md) | Newsletter, SLAs, plugin framework |
| [`impl-publishing.md`](references/impl-publishing.md) | Publishing and distribution |
| [`impl-dev-workflows.md`](references/impl-dev-workflows.md) | TDD, E2E-first, spike — apply to ALL departments |
| [`impl-clevel-accountability.md`](references/impl-clevel-accountability.md) | CEO state writes, CTO gates, Board merger |
| [`impl-role-expansion.md`](references/impl-role-expansion.md) | Fill gaps in underutilized departments |
| [`impl-readme-ownership.md`](references/impl-readme-ownership.md) | PM owns README, QA validates |
| [`impl-self-improving-prompts.md`](references/impl-self-improving-prompts.md) | Distill CEO feedback into versioned prompt lines |
| [`impl-external-pt.md`](references/impl-external-pt.md) | Weekly OpenCode + DeepSeek PT, Security triage |
| [`impl-prompt-optimization.md`](references/impl-prompt-optimization.md) | DSPy + DeepEval + Promptfoo — skill improves its own task prompts |
| [`arcade-platform-changelog-2026-06.md`](references/arcade-platform-changelog-2026-06.md) | 11 process lessons from live ops |
| [`browser-game-testing.md`](references/browser-game-testing.md) | Browser E2E patterns, mobile QA checklist |
| [`qa-workflow-templates.md`](references/qa-workflow-templates.md) | Game verification, release gate, bug report |
| [`sprint-mode-upgrade-checklist.md`](references/sprint-mode-upgrade-checklist.md) | CEO SYSTEM.md sprintMode schema checklist |
| [`impl-directive-status-check.md`](references/impl-directive-status-check.md) | Post-escalation diagnostic |

### C-Suite & Governance

| Doc | What |
|-----|------|
| [`csuite-layer-plan.md`](references/csuite-layer-plan.md) | C-Suite design + tools |
| [`improvement-roadmap-csuite.md`](references/improvement-roadmap-csuite.md) | C-Suite improvement roadmap |

### Reference

| Doc | What |
|-----|------|
| [`example-arcade-platform.md`](references/example-arcade-platform.md) | Live case study — arcade platform |
| [`ideas.md`](references/ideas.md) | Expansion ideas backlog |
| [`migration-checklist.md`](references/migration-checklist.md) | Department migration checklist |
| [`pre-publish-checklist.md`](references/pre-publish-checklist.md) | Pre-publish quality gates |

---

## Anti-Slop Contract

Every department signs this contract. CEO enforces it.

**Banned words**: "enhance", "leverage", "streamline", "utilize", "robust", "comprehensive", "cutting-edge", "synergy", "holistic", "paradigm"

**Rules**:
- ❌ No vague changelogs ("improved performance")
- ❌ No placeholder code (`// TODO: implement`)
- ❌ No generic variable names (`data`, `temp`, `result`)
- ✅ Every change has a measurable before/after
- ✅ Every doc answers "what, why, how" concretely

CEO grades each department A-F. Consecutive D/F grades trigger corrective directives.

---

## Case Study: Arcade Platform

A browser-based arcade running on Docker in a homelab. 7 games (Snake, Pong, Breakout, Tetris, Space Invaders, Pac-Man, Frogger), 16 departments running autonomously, evolving 24/7.

**Results**:
- R&D autonomously built 4 additional games beyond the initial 3
- QA maintains 17+ consecutive clean cycles, zero bugs
- Creative department produces game scripts and visual direction
- Board self-governs — applies pressure before CEO even inspects
- Active pivot (`arcade-evolution`) managing LittleJS framework migration across all departments

See [`references/example-arcade-platform.md`](references/example-arcade-platform.md) for the full deployment reference.

---

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for the full version history. Current version: **v3.9.1**.

---

## Requirements

- [Hermes Agent](https://hermes-agent.nousresearch.com) or [OpenClaw](https://github.com/AizelNetwork/OpenClaw) (for cron job orchestration)
- [Bun](https://bun.sh) runtime (for TypeScript tools)
- Docker & Docker Compose (for project deployment)
- A Telegram bot (for reports — optional)

---

## License

MIT — use it, fork it, build your own corporation.

---

<div align="center">

*Powered by caffeine and questionable life choices ☕️*

**[Strategy Guide](references/strategy-guide.md)** · **[Architecture](references/architecture.md)** · **[Anti-Slop](references/anti-slop.md)** · **[Changelog](CHANGELOG.md)**

</div>
