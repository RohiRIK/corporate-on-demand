# Example: Arcade Platform

> **Note:** This is a real, live deployment — the first Corporate-on-Demand project. It runs autonomously 24/7 and is publicly accessible. — Reference Implementation

## Live Experience

- **Live site**: https://arcade.rohi-lab.org
- **Source repo**: https://github.com/RohiRIK/arcade-platform (public)
- **Hosting**: GitHub Pages (static files, no backend)
- **Auto-deploy**: No-agent cron pushes to GitHub every 2h → GitHub Actions workflow deploys to Pages
- **Custom domain**: CNAME via Cloudflare (DNS only, no proxy) → GitHub Pages SSL

## Evolution at a Glance

This project started lean and upgraded itself, exactly as the system intends:

| Phase | Org | Stack |
|-------|-----|-------|
| Day 1 (default start) | 6 departments (CEO, R&D, UX/UI, Infra, PM, Board), no C-tier | Node.js/Express + nginx, hand-rolled vanilla-JS canvas games, Docker Compose |
| Day 2-3 (organic growth) | +QA, DevOps, IT, Security, Analytics, Creative, CTO, CISO, CPO, CFO (16 depts) | Still vanilla JS, but C-Suite governance layer added |
| Current (v3.8.0) | +HR = 17 departments, full C-Suite, self-improving prompts | Migrating to **LittleJS** via `arcade-evolution` pivot. Backend removed — pure static site on GitHub Pages |

The stack was never fixed: R&D scouted a stronger engine, pitched it with before/after data, and the org is now migrating through a 5-phase pivot. This is the design, not a one-off. See `pipelines.md` (tech-scouting enforcement) and `impl-pivoting.md`.

## Project

- Path: `~/arcade-platform`
- Architecture: Static HTML/CSS/JS served by GitHub Pages. No backend, no Docker, no server.
- Engine: Migrating to LittleJS (Phase 2 of 5 in `arcade-evolution` pivot)
- Deployment: Push to `main` → GitHub Actions → GitHub Pages at https://arcade.rohi-lab.org

## Department Structure (current — 17 departments)

```
departments/
├── CORPORATE.md, DELEGATION.md
├── ceo/       — Oversight, grading, directives, sprint mode activation
├── cto/       — Technical oversight, prompt drafting (self-improving)
├── ciso/      — Security oversight, compliance audits
├── cpo/       — Product quality, visual consistency, staleness checks
├── cfo/       — Scope budgets, token allocation tracking
├── rnd/       — Research, pitch, spec, build games, labs
├── uxui/      — Design system, UI improvements, layout reviews
├── infra/     — Infrastructure audits (exempt from pivot)
├── pm/        — Changelogs, standards, README ownership, coordination
├── board/     — Strategy, risk, meeting minutes, sprint mode governance
├── qa/        — Testing, regression, end-to-end validation
├── devops/    — CI/CD, deploy pipeline, post-deploy smoke tests
├── security/  — Security audits, vulnerability scanning (exempt from pivot)
├── it/        — Routine scans, state.json validation, inbox format checks
├── analytics/ — Metrics, quality scoring, data-driven insights
├── creative/  — Game feel, visual identity, sound design, gameplay scripts
└── hr/        — Grade collection, prompt signal (self-improving prompts)
```

## Cron Schedule (20 jobs)

### Operational (every 2h)
| Name | Schedule | Script | Role |
|------|----------|--------|------|
| arcade-board-meeting | `0 */2 * * *` | arcade-board.sh | Strategy & governance |
| arcade-rnd | `20 */2 * * *` | arcade-rnd.sh | Game development |
| arcade-hr | `25 */2 * * *` | arcade-hr.sh | Grade collection & prompt signals |
| arcade-infra | `55 */2 * * *` | arcade-infra.sh | Infrastructure audits |
| arcade-it | `45 */2 * * *` | arcade-it.sh | Routine scans |
| arcade-deploy | `45 */2 * * *` | arcade-deploy.sh | Auto git push (no-agent) |

### Operational (odd hours, every 2h)
| Name | Schedule | Script | Role |
|------|----------|--------|------|
| arcade-devops | `0 1-23/2 * * *` | arcade-devops.sh | CI/CD & deploy |
| arcade-uxui | `10 1-23/2 * * *` | arcade-uxui.sh | Design reviews |
| arcade-creative | `30 1-23/2 * * *` | arcade-creative.sh | Game feel & art |
| arcade-qa | `40 1-23/2 * * *` | arcade-qa.sh | Testing & regression |
| arcade-pm | `50 1-23/2 * * *` | arcade-pm.sh | Docs & coordination |

### Analytics (every 4h)
| Name | Schedule | Script | Role |
|------|----------|--------|------|
| arcade-analytics | `30 */4 * * *` | arcade-analytics.sh | Metrics & insights |

### C-Suite (every 6-8h)
| Name | Schedule | Script | Role |
|------|----------|--------|------|
| arcade-cto | `0 */6 * * *` | arcade-cto.sh | Technical oversight |
| arcade-security | `0 */6 * * *` | arcade-security.sh | Security audits |
| arcade-ciso | `30 */8 * * *` | arcade-ciso.sh | Compliance |
| arcade-cpo | `15 */8 * * *` | arcade-cpo.sh | Product quality |
| arcade-cfo | `45 */8 * * *` | arcade-cfo.sh | Budget tracking |

### CEO & Reports
| Name | Schedule | Script | Role |
|------|----------|--------|------|
| arcade-ceo-inspection | `0 10,22 * * *` | arcade-ceo.sh | Grading & directives |
| arcade-morning-report | `0 8 * * *` | arcade-morning-report.sh | Morning briefing (Telegram) |
| arcade-evening-report | `0 20 * * *` | arcade-evening-report.sh | Evening briefing (Telegram) |

## Key Features in Production

### Self-Improving Prompts
HR collects department grades → identifies patterns → writes `[PROMPT-CANDIDATE]` to CTO inbox when 3+ corrections detected → CTO drafts prompt patch → CEO approves. No department edits its own prompt.

### Pivot System
Active pivot `arcade-evolution`: migrating from vanilla JS to LittleJS engine.
5 phases: Foundation → Snake → Remaining 6 games → Polish → Cleanup.
7-gate approval process, all departments assessed impact before execution began.

### Sprint Mode
Available but not yet activated. CEO, PM, or Board can propose. 6 levers: cron boost, parallel tracks, multi-fast-track, C-suite cadence bump, daily standups, scope lock. Max 5 days, auto-expires, retrospective required.

### GitHub Pages Deployment
- No-agent deploy cron pushes changes every 2h
- GitHub Actions workflow deploys `frontend/public/` to Pages
- Custom domain `arcade.rohi-lab.org` via Cloudflare CNAME (DNS only)
- Post-deploy smoke test planned (DevOps building)

### Operator Rules (AGENTS.md)
The operator (Hermes agent) does NOT write code. All work flows through:
1. Confluence decisions → `confluence/decisions/`
2. CEO directives → `state.json`
3. Inbox messages → `departments/<dept>/inbox/`
4. Departments execute on their cron cycles

Exception: P1-CRITICAL security issues where no department cycle will run in time.

## Adding a Game (R&D pipeline)
1. Research → `departments/rnd/research/<game>.md`
2. Pitch → `departments/rnd/pitches/<game>.md`
3. Spec → `departments/rnd/specs/<game>.md`
4. Build → `frontend/public/js/games/<game>.js` (LittleJS-based)
5. Register in `frontend/public/index.html` GAMES array
6. Auto-deploys on next push cycle

## Lessons Learned

1. **Start lean, grow organically.** 6 departments on Day 1, 17 by Day 3. Each addition was driven by a real need (QA after bugs shipped, DevOps after manual deploys, HR after prompt quality gaps).
2. **Backend is optional.** What started as a 2-container Docker app (Express + nginx) became a pure static site on GitHub Pages. The autonomous system doesn't need a backend — it reads/writes files directly.
3. **The operator must not code.** Early mistake: the operator made direct code fixes. Now enforced via AGENTS.md — all work flows through the department pipeline. This is critical for the system to self-improve.
4. **Custom domain + Cloudflare: use DNS only.** Cloudflare proxy (orange cloud) blocks GitHub Pages SSL cert provisioning. Set to grey cloud (DNS only).
5. **Self-improving prompts need a dedicated department.** PM was initially the prompt signal source, but that breaks separation — PM can't objectively grade itself. HR was created as the canonical owner.
6. **Config panels must not be public.** A self-improvement Config tab was exposed on the public site. Caught and removed as P1-CRITICAL. Lesson: security audit the live site after every architecture change.

## Alignment Status (2026-05-31)
- 17 departments, all with SYSTEM.md, inbox/done/, pipeline sections
- All departments have pivot, sprint mode, and confluence sections
- Active pivot: arcade-evolution (Phase 2 — Snake on LittleJS)
- v3.8.0 features: Sprint Mode, Labs, self-improving prompts, HR department
- Auto-deploy to GitHub Pages operational
- Morning/evening reports delivered to Telegram
