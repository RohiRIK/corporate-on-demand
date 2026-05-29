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

*Departments. Pipelines. Anti-slop. CEO oversight. Runs while you sleep.*

[![Version](https://img.shields.io/badge/version-3.2.1-blue?style=flat-square)]()
[![Hermes](https://img.shields.io/badge/hermes--agent-skill-purple?style=flat-square)](https://hermes-agent.nousresearch.com)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)]()
[![Departments](https://img.shields.io/badge/departments-11%2B-orange?style=flat-square)]()
[![Ideas](https://img.shields.io/badge/ideas-20-yellow?style=flat-square)]()
[![Docs](https://img.shields.io/badge/docs-32%20files-brightgreen?style=flat-square)]()

</div>

---

## What is this?

A [Hermes Agent](https://hermes-agent.nousresearch.com) skill that turns cron jobs into an autonomous corporation. Each department is an AI agent running on a schedule — with its own identity, mandatory pipeline, quality contract, and inbox. A CEO agent inspects everything twice daily and issues directives.

**The result**: your project improves itself while you sleep. You wake up to a morning report of what happened overnight.

```
                              ┌─────────────────┐
                              │    👤 Human      │
                              │  (morning report │
                              │   @ 08:00)       │
                              └────────┬─────────┘
                                       │ reads
                              ┌────────▼─────────┐
                              │   🤵 CEO Agent   │
                              │  inspects 10:00  │
                              │  inspects 22:00  │
                              │  grades A-F      │
                              │  issues directives│
                              └────────┬─────────┘
                                       │ oversees
                    ┌──────────────────┼──────────────────┐
                    │                  │                   │
           ┌────────▼──────┐  ┌───────▼───────┐  ┌───────▼───────┐
           │  🏛️ Board     │  │  state.json   │  │  📬 Inboxes   │
           │  coordinates  │  │  shared brain  │  │  cross-dept   │
           │  sets agenda  │  │  directives    │  │  communication│
           └───────┬───────┘  │  pipeline      │  └───────────────┘
                   │          │  grades        │
    ┌──────────────┼──────────│──────────────┐
    │              │          │              │
┌───▼───┐    ┌────▼───┐  ┌──▼────┐   ┌────▼───┐
│ 🔬 R&D │    │ 🎨 UX  │  │ 🔧    │   │ 📋 PM  │
│       │    │  /UI   │  │ Infra │   │        │
│research│    │research│  │ audit │   │ review │
│  ↓    │    │  ↓    │  │  ↓    │   │  ↓     │
│ pitch │    │design │  │runbook│   │changelog│
│  ↓    │    │  ↓    │  │  ↓    │   │  ↓     │
│ spec  │    │ build │  │execute│   │standards│
│  ↓    │    │       │  │       │   │         │
│ build │    │       │  │       │   │         │
└───────┘    └───────┘  └───────┘   └─────────┘
  :25 */2h     :15 odd    :50 */2h    :40 odd

           ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
             Advanced departments (add as needed)
           │                                     │
            🛡️ QA    🔒 Security   📊 Analytics
           │ 🖥️ IT    👷 DevOps    👥 HR         │
           └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

---

## Quick Start

### 1. Scaffold a project

```bash
BUN=~/.bun/bin/bun
$BUN scripts/scaffold.ts --name my-arcade --path ~/my-arcade --template game
```

Templates: `game` | `saas` | `content` | `devtools` | `homelab` | `data`

### 2. Validate the setup

```bash
$BUN scripts/validate.ts --path ~/my-arcade
# 33 checks: SYSTEM.md, state.json, inboxes, pipelines, boundaries
```

### 3. Set up cron jobs

See [`references/setup.md`](references/setup.md) for the full cron setup with Hermes Agent.

### 4. Watch it run

Morning report arrives at 08:00 on Telegram. CEO inspects at 10:00 and 22:00. Departments run every 2 hours overnight. You wake up to a changelog.

---

## Features at a Glance

| Feature | What it does |
|---------|-------------|
| 🏢 **Department system** | Each agent has identity, scope, pipeline, and domain boundaries |
| 📋 **Mandatory pipelines** | R&D: research→pitch→spec→build. No skipping steps. |
| 🚫 **Anti-slop contract** | Banned words list, concrete output rules, CEO grades A-F |
| 📬 **Inbox communication** | Cross-department tasks via structured inbox files |
| 🧠 **Shared state** | `state.json` — directives, pipeline status, grades, escalations |
| 🤵 **CEO oversight** | Twice-daily inspection, corrective directives, quality enforcement |
| 📰 **Morning report** | Daily briefing of overnight work delivered to Telegram |
| ⚡ **Fast-track** | CEO can accelerate high-priority projects through the pipeline |
| 🎉 **Gibbush days** | Pipeline-free experimentation cycles to prevent staleness |
| 🚨 **Incident response** | P1/P2/P3 severity, incident mode, postmortems |
| 📊 **KPI dashboard** | Objective metrics per department, not just gut-feel grading |
| 🔧 **20 expansion ideas** | Full implementation guides ready to activate |

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
Stage 4: Enterprise    ──→  + HR + Analytics + specialized teams (11+)
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
│   ├── ceo/
│   │   ├── SYSTEM.md           # CEO identity & inspection workflow
│   │   ├── directives/         # CEO directives archive
│   │   ├── reviews/            # Inspection reports
│   │   └── inbox/              # Escalations from departments
│   ├── rnd/
│   │   ├── SYSTEM.md           # R&D identity & pipeline
│   │   ├── research/           # Game/feature research docs
│   │   ├── pitches/            # Pitch documents
│   │   ├── specs/              # Implementation specs
│   │   └── inbox/              # Tasks from other depts
│   ├── uxui/                   # Design, CSS, user experience
│   ├── infra/                  # Docker, health, networking
│   ├── pm/                     # Documentation, changelogs
│   └── board/                  # Strategy, meeting minutes
├── state.json                  # Shared coordination brain
├── logs/                       # Per-cycle JSON logs
└── docker-compose.yml          # Infrastructure
```

---

## Tools

| Script | Purpose |
|--------|---------|
| `scripts/scaffold.ts` | Scaffold entire project from template |
| `scripts/validate.ts` | Run 33 structural checks on deployment |
| `scripts/report.ts` | Generate status report with grades and metrics |
| `scripts/add-department.ts` | Add a department to an existing project |

```bash
BUN=~/.bun/bin/bun
SCRIPTS=path/to/corporate-on-demand/scripts

# Scaffold
$BUN $SCRIPTS/scaffold.ts --name myproj --path ~/myproj --template saas

# Validate
$BUN $SCRIPTS/validate.ts --path ~/myproj

# Report
$BUN $SCRIPTS/report.ts --path ~/myproj

# Add department
$BUN $SCRIPTS/add-department.ts --path ~/myproj --name qa \
  --focus "Testing and regression" --pipeline "test-plan,execute,report"
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
| [`pitfalls.md`](references/pitfalls.md) | 8 failure modes with mitigations |
| [`setup.md`](references/setup.md) | Step-by-step cron setup guide |
| [`company-templates.md`](references/company-templates.md) | 6 project templates |

### Implementation Guides

| Guide | Effort | Impact |
|-------|--------|--------|
| [`impl-cross-dept-meetings.md`](references/impl-cross-dept-meetings.md) | Low | ⬆️⬆️⬆️ |
| [`impl-fast-track.md`](references/impl-fast-track.md) | Low | ⬆️⬆️⬆️ |
| [`impl-incident-response.md`](references/impl-incident-response.md) | Low | ⬆️⬆️⬆️ |
| [`impl-dept-creation.md`](references/impl-dept-creation.md) | Med | ⬆️⬆️⬆️ |
| [`impl-qa-dept.md`](references/impl-qa-dept.md) | Med | ⬆️⬆️⬆️ |
| [`impl-kpi-dashboard.md`](references/impl-kpi-dashboard.md) | Med | ⬆️⬆️ |
| [`impl-devops-dept.md`](references/impl-devops-dept.md) | Med | ⬆️⬆️ |
| [`impl-it-dept.md`](references/impl-it-dept.md) | Med | ⬆️⬆️ |
| [`impl-gibbush.md`](references/impl-gibbush.md) | Low | ⬆️⬆️ |
| [`impl-dept-budgets.md`](references/impl-dept-budgets.md) | Low | ⬆️⬆️ |
| [`impl-retrospectives.md`](references/impl-retrospectives.md) | Low | ⬆️⬆️ |
| [`impl-security-dept.md`](references/impl-security-dept.md) | Med | ⬆️⬆️ |
| [`impl-seasonal-events.md`](references/impl-seasonal-events.md) | Low | ⬆️ |
| [`impl-mentorship.md`](references/impl-mentorship.md) | Low | ⬆️ |
| [`impl-analytics-dept.md`](references/impl-analytics-dept.md) | Med | ⬆️ |
| [`impl-hr-dept.md`](references/impl-hr-dept.md) | Med | ⬆️ |
| [`impl-ecosystem.md`](references/impl-ecosystem.md) | Med | ⬆️ |

### Reference

| Doc | What |
|-----|------|
| [`arcade-platform.md`](references/arcade-platform.md) | Live case study — arcade platform deployment |
| [`ideas.md`](references/ideas.md) | Full backlog of 20 expansion ideas |

---

## Anti-Slop Contract

Every department signs this contract. CEO enforces it.

**Banned words**: "enhance", "leverage", "streamline", "utilize", "robust", "comprehensive", "cutting-edge", "synergy", "holistic", "paradigm"

**Rules**:
- ❌ No vague changelogs ("improved performance")
- ❌ No placeholder code (`// TODO: implement`)
- ❌ No generic variable names (`data`, `temp`, `result`)
- ✅ Every change has a measurable before/after
- ✅ Every game must be fun for 2+ minutes
- ✅ Every doc answers "what, why, how" concretely

CEO grades each department A-F. Consecutive D/F grades trigger corrective directives.

---

## Case Study: Arcade Platform

A browser-based arcade running on Docker in a homelab. 3 initial games (Snake, Pong, Breakout), 6 departments running autonomously, evolving 24/7.

**Overnight results** (first night):
- R&D: researched Tetris, wrote pitch, advanced pipeline
- Infra: baseline health audit, container restart runbook
- Board: 5 meeting cycles with cross-department directives, escalated UX/UI for stalling
- The system self-governed — Board applied pressure before CEO even inspected

See [`references/arcade-platform.md`](references/arcade-platform.md) for the full deployment reference.

---

## Changelog

### v3.2.1 — 2026-05-29
**Strategic planning guide**
- Added `references/strategy-guide.md` — 7-step decision framework
- Maturity model: Stage 0 (idea) → Stage 4 (enterprise)
- Department selection matrix with "when to add" triggers
- Mechanism decision matrix (19 mechanisms, effort/impact)
- Cron schedule templates for small/medium/large orgs
- Growth and shrinking triggers
- 6 example builds (arcade, SaaS, homelab, content, CLI, data)

### v3.2.0 — 2026-05-29
**17 implementation guides**
- Full implementation docs for all 20 ideas
- Each guide: SYSTEM.md template, state.json schema, step-by-step setup, guards
- Departments: DevOps, IT, HR, QA, Security, Analytics
- Mechanisms: cross-dept meetings, fast-track, dept creation, gibbush, incident response, KPI dashboard, budgets, retrospectives, mentorship, seasonal events
- Ecosystem: newsletter, SLAs, R&D labs, plugin framework

### v2.0.0 — 2026-05-28
**Initial release — Corporate-on-Demand**
- Core architecture: departments, pipelines, anti-slop, CEO oversight
- 4 TypeScript tools: scaffold, validate, report, add-department
- 6 project templates: game, SaaS, content, devtools, homelab, data
- 8 pitfalls with mitigations
- Arcade platform case study
- 20 expansion ideas backlog

---

## Requirements

- [Hermes Agent](https://hermes-agent.nousresearch.com) (for cron job orchestration)
- [Bun](https://bun.sh) runtime (for TypeScript tools)
- Docker & Docker Compose (for project deployment)
- A Telegram bot (for reports — optional)

---

## License

MIT — use it, fork it, build your own corporation.

---

<div align="center">

*Built with [Hermes Agent](https://hermes-agent.nousresearch.com) — the AI that runs while you sleep.*

**[Strategy Guide](references/strategy-guide.md)** · **[Architecture](references/architecture.md)** · **[Anti-Slop](references/anti-slop.md)** · **[Ideas](references/ideas.md)**

</div>
