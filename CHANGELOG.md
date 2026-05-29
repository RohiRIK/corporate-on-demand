# Changelog

All notable changes to Corporate-on-Demand are documented here.

---

## [3.4.2] — 2026-05-31

### Added
- C-Suite management layer: CEO, CTO, CISO, CPO support
- Shared scripts: read-artifacts.ts, state-rw.ts, inbox-send.ts, inbox-digest.ts, activity-log.ts
- Role-specific scripts: csuite-report.ts, staleness-check.ts, grade.ts, board-meeting.ts
- Shared utilities library: scripts/lib/utils.ts
- CTO, CISO, CPO departments added to all scaffold templates
### Changed
- scaffold.ts updated with C-Suite departments and data-collection scripts

---

## [3.3.1] — 2026-05-29

### Added
- Testing strategy reference (`impl-testing-strategy.md`) — 7 layers: static analysis, API contract, browser E2E, visual regression, LAN accessibility, acceptance-driven dev, CEO spot-check
- Escalation flow with P1/P2/P3 severity definitions and response times
- Screenshot lifecycle management (active → archive → compress → delete)
- Migration checklist reference

---

## [3.3.0] — 2026-05-29

### Added
- 4 new departments: QA, IT, DevOps, Security with full SYSTEM.md, cron jobs, data-collection scripts
- Anti-slop contracts added to all new department SYSTEM.md files
- Grading rubrics (A-F) added to all 10 department SYSTEM.md files
- CEO domain boundaries (must not modify code directly)
- `fastTrack`, `incidentMode`, `meetings`, `metrics` fields in state.json

### Fixed
- `recentChanges`, `pendingEscalations`, `blockedTasks` rules injected into all 10 department cron prompts — departments now write to shared state
- Log naming standardized to `YYYYMMDDTHHMMSSZ-dept.json` across all departments
- Logs consolidated from department-level `logs/` dirs to central `logs/`
- Inbox done protocol fixed — items move to `inbox/done/` instead of `.done` suffix rename
- Morning report script updated to scan all 10 departments + new artifact directories

---

## [3.2.1] — 2026-05-29

### Added
- Strategic planning guide (`strategy-guide.md`) — maturity stages, department selection, mechanism matrix, schedule templates, growth triggers, 6 example builds
- Strategy guide set as first entry in SKILL.md routing table

---

## [3.2.0] — 2026-05-29

### Added
- 17 implementation guides for all 20 ideas: DevOps dept, IT dept, HR dept, QA dept, Security dept, Analytics dept, cross-dept meetings, fast-track, CEO dept creation, gibbush days, incident response, KPI dashboard, budgets, retrospectives, mentorship, seasonal events, newsletter, SLAs, R&D labs, plugins
- Implementation guides routing table in SKILL.md
- Ideas backlog (`ideas.md`) with 20 expansion ideas and priority matrix

### Changed
- Version bump to 3.2.0

---

## [3.1.0] — 2026-05-29

### Added
- README.md — ASCII banner, architecture flowchart, badges, full doc map, changelog section, maturity model visualization

---

## [3.0.0] — 2026-05-29

### Changed
- Major skill refactor per `create-skill` conventions
- SKILL.md slimmed to ~45-line router with reference-based architecture
- All content moved to `references/` directory

### Added
- 7 reference docs: architecture, pipelines, anti-slop, pitfalls, setup, company-templates, arcade-platform
- 4 TypeScript scripts: `validate.ts` (33→51 checks), `scaffold.ts`, `report.ts`, `add-department.ts`
- Company templates for 6 project types (game, saas, content, devtools, homelab, data)

---

## [2.0.0] — 2026-05-28

### Added
- Initial skill creation
- Corporate governance model: CEO, Board, R&D, UX/UI, Infra, PM
- Pipeline enforcement: mandatory department workflows
- Anti-slop contract: banned words, CEO grading (A-F)
- CORPORATE.md and DELEGATION.md governance docs
- Staggered cron scheduling across departments
- state.json coordination with pipeline tracking
- Inbox-based cross-department communication protocol
- Arcade Platform reference implementation: Snake, Pong, Breakout (+ Tetris, Space Invaders built autonomously by R&D)
