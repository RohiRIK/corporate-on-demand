# Example: Arcade Platform

> **Note:** This is a real deployment example. Replace paths and IPs with your own. — Reference Implementation

First deployment of Corporate-on-Demand system.

## Project
- Path: `/slug/arcade-platform`
- Stack: Node.js/Express backend (port 3001) + nginx static frontend (port 3000)
- Docker Compose, 2 containers, auto-restart

## Department Structure
```
departments/
├── CORPORATE.md, DELEGATION.md
├── ceo/    — SYSTEM.md, directives/, reviews/, inbox/
├── rnd/    — SYSTEM.md, research/, pitches/, specs/, prototypes/, inbox/
├── uxui/   — SYSTEM.md, research/, designs/, styleguide/, inbox/
├── infra/  — SYSTEM.md, runbooks/, audits/, inbox/
├── pm/     — SYSTEM.md, changelogs/, standards/, reports/, inbox/
└── board/  — SYSTEM.md, minutes/, strategy/, inbox/
```

## Cron Jobs
| Name | Schedule | Script | Domain |
|------|----------|--------|--------|
| arcade-board-meeting | `0 */2 * * *` | arcade-board.sh | Strategy |
| arcade-rnd | `25 */2 * * *` | arcade-rnd.sh | Games |
| arcade-infra | `50 */2 * * *` | arcade-infra.sh | Docker/ops |
| arcade-uxui | `15 1-23/2 * * *` | arcade-uxui.sh | Frontend |
| arcade-pm | `40 1-23/2 * * *` | arcade-pm.sh | Docs |
| arcade-ceo-inspection | `0 10,22 * * *` | arcade-ceo.sh | Oversight |
| arcade-morning-report | `0 8 * * *` | arcade-morning-report.sh | Daily briefing |

## Adding a Game (R&D pipeline)
1. Research → `departments/rnd/research/<game>.md`
2. Pitch → `departments/rnd/pitches/<game>.md`
3. Spec → `departments/rnd/specs/<game>.md`
4. Build:
   - `backend/src/games/<name>/meta.json`: `{name, description, version, category, color}`
   - `frontend/public/index.html`: ICONS entry, `startXxx()` function, `launchGame()` case
5. Rebuild: `docker compose up -d --build`
6. Verify: `curl -s http://localhost:3001/api/health`

## Access
- Local: http://localhost:3000
- Network: http://10.10.20.189:3000

## Alignment Status (2026-05-28)
All 33 validate.ts checks pass. Gaps fixed:
- state.json uses `pipeline` (not `gamePipeline`)
- All SYSTEM.md files have domain-boundary rules
- All departments have `inbox/done/` dirs
- CEO SYSTEM.md has inspection workflow
- Cron prompts reference correct field names
- Orphan `arcade-improve.sh` deleted
