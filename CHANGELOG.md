# Changelog

All notable changes to Corporate-on-Demand are documented here.

---

## [3.8.0] — 2026-05-31

### Added
- **Self-improving prompts** — the org distills recurring CEO feedback into versioned SYSTEM.md prompt lines instead of letting a model freely rewrite prompts. Spec at `references/spec-self-improving-prompts.md`, impl guide at `references/impl-self-improving-prompts.md`
- Separation of duties: HR detects recurring corrections and grade trends, CTO drafts the one-line patch, CEO/Board approves. Hard rule — no department edits its own SYSTEM.md
- Owner-role SYSTEM.md identity lines (HR Prompt Signal / CTO Prompt Drafting / CEO Prompt Approval), authored with prompt-engineering standards: the two real gates (no self-editing, safety gates need human sign-off) stay forceful; the rest positive-framed
- Guardrails: prompt versioning, grade-trend before/after, revert-on-regression (0.15 over watch window), immutable safety gates, anchored grading to frozen golden refs + the human morning report
- Loop is **dormant until the v2 SQLite backbone lands** — it mines grades/directives/prompt-versions from `project.db`. Track A (prompt/governance docs) is built now; Track B (6 TS scripts) is deferred

### Changed
- `impl-retrospectives.md` — retro step 3 (SYSTEM.md updates) now points to the disciplined self-improving-prompts loop once v2 is available
- `references/ideas.md` — moved the entire remaining backlog (Gibbush, HR, KPI, Retrospectives, Mentorship, Seasonal, Newsletter, SLAs, Plugins) into the Shipped table to match their live impl guides; added a "Specced — awaiting v2 backbone" section for self-improving prompts

## [3.7.0] — 2026-05-31

### Changed
- Prompt-engineering pass across all live agent prompts (Tier A) and router/process docs (Tier B), applying Anthropic Claude 4.x best practices: positive framing over prohibition, added motivation/context, and discriminating genuine governance gates (kept forceful) from decorative emphasis (reframed)
- `anti-slop.md` — Anti-Slop Contract rewritten with positive framing, grading/audit motivation, and an "ambition lives in the specifics, never in adjectives" line that pushes bolder solutions without tripping the banned-buzzword list
- `pipelines.md` — R&D/UX/Infra enforcement now actively scout and pitch stronger technology (frameworks, architectures, modern CSS, observability) with concrete before/after and migration cost; spec/domain gates kept intact
- `company-templates.md` — added **Onboarding Combinations** menu: 11 ready-made org presets (department + C-tier sets) from Spike to Enterprise; stack stays dynamic (R&D pitches upgrades) rather than hardcoded
- `example-arcade-platform.md` — rewritten as an evolution story (lean Day-1 org/stack → growing toward Game Studio combination + LittleJS migration), matching the "org and stack upgrade themselves" design
- `setup.md` — slimmed to delegate org-shape decisions to `strategy-guide.md` + the combinations menu; added product-derived prompt-tailoring directive with before/after example; refreshed skeleton cron prompts
- `strategy-guide.md` — combinations cross-link, per-department impl-guide column, C-tier/Editorial pointers, and a "tailor each department to the product" principle
- `impl-security-dept.md` — Harden step now proposes stronger defenses proactively, not just flags what's broken
- `impl-devops-dept.md` — design-pipeline step now pitches stronger CI/CD (caching, parallel runs, better runners) with before/after

### Fixed
- `SKILL.md` — repaired broken Workflow Routing table (C-Suite/Confluence rows were orphaned outside the table by a stray blank line)
- `impl-project-upgrade.md` — replaced fragile `python3 -c` JSON validation with `jq empty`, aligning with repo tooling conventions

---

## [3.6.0] — 2026-05-31

### Added
- Sprint Mode (`impl-sprint-mode.md`) — temporary org-wide acceleration with 6 configurable levers: cron boost, parallel tracks, multi fast-track, C-suite cadence bump, daily standups, scope lock
- CEO/PM/Board can propose Sprint Mode organically through normal cycles
- Max 5-day duration with auto-expiry, Board governance, mandatory retrospective
- state.json `sprintMode` schema with full lever configuration
- R&D Labs (`impl-labs.md`) — promoted from ecosystem extra to default R&D capability. Experimentation sandbox with graduation path, abandonment tracking, CEO/CTO oversight
- Labs auto-created by scaffold.ts for all R&D departments across all 6 templates
- Labs section removed from `impl-ecosystem.md`, replaced with pointer to `impl-labs.md`

### Changed
- README.md full rewrite — updated architecture diagram (C-Suite, Creative, Labs, Sprint Mode), features table (16 features), maturity model (Stage 4 Enterprise), project structure (16 depts, confluence/, labs/), tools table (13 scripts), documentation map (25+ impl guides), case study (7 games/16 depts), changelog section replaced with pointer to CHANGELOG.md
- Requirements: added OpenClaw as alternative orchestrator to Hermes Agent
- Badges updated: version 3.6.0, 16 departments, 25+ impl guides, 45+ docs

---

## [3.5.0] — 2026-05-31

### Added
- Pivoting flow (`impl-pivoting.md`) — 7-gate process for strategic direction changes: proposal, impact assessment, plan, board vote, pipeline freeze, phased execution, completion
- 4 pivot types: architecture, product, tech-stack, delivery
- Confluence integration (`impl-confluence.md`) — 4 categories: decisions, technical, runbooks, postmortems
- Confluence baked into scaffold.ts (dirs, CORPORATE.md, state.json, SYSTEM.md)
- Project upgrade flow (`impl-project-upgrade.md`) — checklist for upgrading existing live projects to current skill version

### Fixed
- Removed duplicate nested `skills/corporate-on-demand/` directory (was causing `skill_view` ambiguity)

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
