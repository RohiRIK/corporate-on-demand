# Corporate-on-Demand — Ideas for Future Implementation

Backlog of features and expansions. CEO can prioritize and approve.

---

## 1. DevOps Department
Dedicated department separate from Infra. Focus: CI/CD pipelines, automated testing, build automation, deployment strategies, rollback procedures.
- **Pipeline**: `audit-ci → design-pipeline → implement → verify`
- **Owns**: build scripts, test runners, deployment automation, release tagging
- **Does NOT own**: application code, runtime infrastructure, monitoring
- **Relationship to Infra**: Infra owns runtime (Docker, networking, health). DevOps owns the path from code to runtime.

## 2. Cross-Department Meetings
Scheduled sessions where 2-3 departments collaborate on shared concerns. Not a Board meeting — focused working sessions.
- **Format**: CEO writes a meeting task to both departments' inboxes with agenda, expected output, and deadline
- **Output**: Joint decision doc in both departments' folders
- **Examples**:
  - R&D + UX/UI: game design review before build phase
  - Infra + DevOps: deployment pipeline design
  - PM + Board: quarterly planning alignment
- **Schedule**: CEO triggers ad-hoc via directive, not on fixed cron

## 3. CEO-Driven Department Creation
CEO can autonomously decide to create a new department when workload or scope demands it.
- **Trigger**: CEO identifies a gap during inspection — work that no department owns
- **Process**:
  1. CEO writes a proposal to `departments/ceo/directives/new-dept-<name>.md`
  2. Board reviews and approves in next meeting minutes
  3. CEO runs `add-department.ts` script to scaffold
  4. CEO creates cron job and data-collection script
  5. CEO writes initial directive to new department's inbox
- **Guard**: Board must acknowledge in minutes before department goes live

## 4. Project Promotion / Fast-Track
Mechanism for CEO to accelerate a specific project through the pipeline.
- **Use case**: A game or feature is high-priority — skip the "one step per cycle" rule
- **Implementation**: CEO sets `fastTrack: "<project>"` in state.json
- **Effect**: R&D can do 2 pipeline steps in one cycle for that project
- **Constraint**: Fast-track directive must include justification and expiry (e.g., "2 cycles")
- **Logging**: Every fast-track must be logged with reason and outcome

## 5. IT Department
Internal tooling and developer experience for the agents themselves.
- **Focus**: Agent workspace maintenance, script health, log rotation, state.json integrity, inbox cleanup
- **Pipeline**: `scan → report → fix → verify`
- **Owns**: data-collection scripts, state.json schema validation, inbox format enforcement, stale artifact cleanup
- **Does NOT own**: application code, infrastructure, department content
- **Value**: Agents break things — IT keeps the corporate system itself healthy

## 6. HR Department
Agent performance tracking, onboarding new departments, and culture enforcement.
- **Focus**: Track department grades over time, identify consistently underperforming departments, propose corrective actions
- **Pipeline**: `collect-grades → analyze-trends → recommend → report`
- **Owns**: Performance history, grade trends, department health reports, onboarding docs for new departments
- **Does NOT own**: Actual grading (CEO does that), department content, code
- **Artifacts**:
  - `performance/` — grade history per department per week
  - `onboarding/` — templates for new department SYSTEM.md, first-run checklists
  - `reports/` — weekly HR reports with trends and recommendations

## 7. Team Building Days (Gibbush)
Periodic creative/experimental cycles where normal pipelines are suspended.
- **Schedule**: CEO declares a gibbush day via directive (e.g., monthly or quarterly)
- **Rules during gibbush**:
  - Pipeline enforcement is relaxed — departments can experiment freely
  - R&D can prototype without research/pitch/spec
  - UX/UI can try wild design ideas
  - Cross-department collaboration encouraged
  - All output goes to a `gibbush/` folder per department
- **Post-gibbush**: Board reviews gibbush output in next meeting. Good ideas enter the normal pipeline. Bad ideas are documented as "tried, didn't work."
- **Goal**: Prevent staleness. Let agents explore without bureaucracy. Innovation day.
- **Guard**: CEO sets `gibbushMode: true` in state.json. Departments check this flag. Normal pipeline resumes automatically next cycle unless CEO extends.

## 8. QA Department
Dedicated testing and quality assurance — separate from CEO's manual inspection.
- **Focus**: Automated testing, regression detection, game playability verification, cross-browser checks
- **Pipeline**: `test-plan → execute-tests → report-bugs → verify-fixes`
- **Owns**: Test plans, bug reports, regression logs, acceptance criteria verification
- **Does NOT own**: Fixing bugs (delegates to R&D/UX), infrastructure, deployment
- **Trigger**: Runs after R&D builds — checks new games/features work correctly
- **Tool**: Could use browser automation to actually play-test games programmatically

## 9. Incident Response Protocol
Structured process when something breaks in production.
- **Trigger**: Infra audit detects unhealthy containers, API errors, or downtime
- **Process**:
  1. Infra writes incident report to `departments/infra/incidents/<timestamp>.md`
  2. Infra attempts immediate fix per existing runbook
  3. If fix fails → escalate to CEO inbox with severity (P1/P2/P3)
  4. CEO can declare incident mode — suspends normal pipeline, all departments focus on fix
  5. Post-incident: PM writes postmortem, Board reviews in next meeting
- **Artifacts**: `incidents/`, `postmortems/`
- **State flag**: `incidentMode: { active: true, severity: "P1", description: "..." }` in state.json

## 10. KPI Dashboard & Metrics
Data-driven department evaluation beyond CEO gut-feel grading.
- **Metrics per department**:
  - R&D: games shipped, pipeline throughput (days research→build), code quality
  - UX/UI: design docs produced, implementation rate, consistency with styleguide
  - Infra: uptime %, audit frequency, runbook coverage
  - PM: changelog freshness, documentation coverage, report cadence
  - Board: decisions made, action items completed
- **Implementation**: IT or PM maintains a `metrics.json` updated each cycle
- **CEO uses**: Metrics alongside grades for objective evaluation
- **Visualization**: Could render a simple HTML dashboard page on the platform itself

## 11. Department Budgets (Scope Tokens)
Limit how much each department can change per cycle to prevent runaway modifications.
- **Concept**: Each department gets N "change tokens" per cycle (e.g., 3 file modifications, 1 new file)
- **Enforcement**: Department logs its changes; CEO audits token usage
- **Purpose**: Prevents a single department from making 20 changes in one run and breaking things
- **Scaling**: CEO can increase/decrease tokens per department based on trust/grades
- **State**: `budgets: { rnd: { tokens: 5, used: 0 }, ... }` in state.json

## 12. Retrospectives
Periodic self-assessment where departments reflect on what worked and what didn't.
- **Schedule**: CEO triggers monthly or after major milestones
- **Process**:
  1. Each department writes a retro doc: what went well, what went badly, what to change
  2. Board synthesizes all retros into a company-wide retro summary
  3. CEO reviews and updates SYSTEM.md files if process changes are needed
- **Output**: `departments/<dept>/retros/<date>.md`
- **Value**: Departments evolve their own processes — not just CEO top-down

## 13. Mentorship / Department Shadowing
One department observes another's work to learn and cross-pollinate.
- **Implementation**: CEO writes a directive like "UX/UI: this cycle, also review R&D's latest spec and provide feedback in their inbox"
- **Purpose**: Breaks silos, catches blind spots, builds cross-functional understanding
- **Lightweight**: No new infrastructure — just a CEO directive pattern

## 14. Security Department
Proactive security hardening and vulnerability scanning.
- **Focus**: Docker image scanning, dependency audits, CSP headers, input sanitization review
- **Pipeline**: `scan → assess → harden → verify`
- **Owns**: Security audits, vulnerability reports, hardening runbooks, CSP policy
- **Does NOT own**: Feature code, infrastructure operations, UI
- **Cadence**: Could run less frequently (every 6h or daily) since security posture changes slowly

## 15. Analytics Department
User behavior tracking and insights (local-only, privacy-respecting).
- **Focus**: Which games are played most, average session duration, drop-off points, peak usage times
- **Pipeline**: `collect → analyze → report → recommend`
- **Implementation**: Backend logs anonymous game events; Analytics reads and summarizes
- **Output**: Weekly insights report to CEO and Board
- **Feeds into**: R&D priorities (which games to improve), UX decisions (what's confusing)

## 16. Seasonal Events & Themed Cycles
Time-based content changes to keep the platform fresh.
- **Examples**: Holiday themes, seasonal game challenges, weekly featured game
- **Implementation**: CEO declares a theme in state.json; UX applies visual changes; R&D adds themed game variants
- **Guard**: Theme changes are additive and reversible — original game/UI preserved
- **Artifacts**: `departments/uxui/themes/`, `departments/rnd/events/`

## 17. Internal Newsletter
Periodic digest of what happened across all departments — lighter than Board minutes.
- **Author**: PM department
- **Cadence**: Daily or every 4 cycles
- **Format**: 1-paragraph summary per department, pipeline status, fun stats
- **Delivery**: Written to `departments/pm/newsletters/<date>.md`, optionally sent to Telegram
- **Value**: Quick read for the human operator to understand system health without reading every report

## 18. SLA Contracts Between Departments
Formal expectations for inter-department requests.
- **Examples**:
  - R&D → UX/UI: "design review within 2 cycles of inbox task"
  - Infra → all: "health audit published every cycle"
  - PM → all: "changelog updated within 1 cycle of any build"
- **Enforcement**: HR or IT tracks SLA compliance; CEO reviews in inspection
- **State**: `slaContracts: [{ from, to, commitment, metric }]` in state.json

## 19. R&D Labs / Skunkworks
Separate experimental track outside the main pipeline.
- **Purpose**: Try risky or unconventional ideas without blocking the main game pipeline
- **Implementation**: R&D gets a `labs/` folder; experimental work doesn't need pitch/spec
- **Guard**: Labs output NEVER goes to production directly — must enter normal pipeline to ship
- **CEO trigger**: "R&D: spend this cycle on labs — explore <wild idea>"
- **Post-lab**: Successful experiments get promoted to research → pitch → spec → build

## 20. External Partnerships / Plugin Ecosystem
Framework for accepting external contributions (mods, community games, plugins).
- **Concept**: Define a game submission format that external contributors can follow
- **PM owns**: Submission standards, review checklist, contributor docs
- **QA owns**: Testing submitted games
- **R&D owns**: Integration into the platform
- **Pipeline**: `submit → PM review → QA test → R&D integrate → CEO approve → ship`

---

## Implementation Priority (suggested)

| Priority | Idea | Effort | Impact |
|----------|------|--------|--------|
| 1 | Cross-department meetings | Low | High — unblocks collaboration |
| 2 | Project fast-track | Low | High — CEO gets urgency lever |
| 3 | CEO department creation | Medium | High — system can grow organically |
| 4 | IT department | Medium | Medium — keeps the system healthy |
| 5 | DevOps department | Medium | Medium — separation of concerns |
| 6 | Team building days | Low | Medium — prevents staleness |
| 7 | HR department | Medium | Low — useful at scale, overkill early |
| 8 | QA department | Medium | High — catches bugs before users |
| 9 | Incident response | Low | High — structured reaction to failures |
| 10 | KPI dashboard | Medium | Medium — data-driven decisions |
| 11 | Department budgets | Low | Medium — prevents scope creep |
| 12 | Retrospectives | Low | Medium — continuous process improvement |
| 13 | Mentorship / shadowing | Low | Low — knowledge transfer |
| 14 | Security department | Medium | High — proactive hardening |
| 15 | Analytics department | Medium | Medium — user behavior insights |
| 16 | Seasonal events | Low | Medium — keeps content fresh |
| 17 | Internal newsletter | Low | Low — visibility across departments |
| 18 | SLA contracts | Low | Medium — accountability |
| 19 | R&D labs / skunkworks | Medium | Medium — moonshot projects |
| 20 | External partnerships | Low | Low — plugin/mod ecosystem |
