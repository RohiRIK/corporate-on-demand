# Corporate-on-Demand — Ideas Backlog

Backlog of features and expansions. Items that have been built are marked as shipped with links to their implementation guides.

---

## ✅ Shipped

| # | Idea | Impl Guide | Version |
|---|------|-----------|---------|
| 1 | DevOps Department | Core skill | 3.0.0 |
| 2 | Cross-Department Meetings | `impl-cross-dept-meetings.md` | 3.4.0 |
| 3 | CEO-Driven Department Creation | Core skill (scaffold.ts) | 3.0.0 |
| 4 | Project Fast-Track | `impl-fast-track.md` | 3.4.0 |
| 5 | IT Department | Core skill | 3.0.0 |
| 8 | QA Department | Core skill | 3.0.0 |
| 9 | Incident Response | Core skill (Infra/CEO flow) | 3.0.0 |
| 11 | Department Budgets (Scope Tokens) | `impl-schedule-optimization.md` | 3.4.0 |
| 14 | Security Department | Core skill | 3.2.0 |
| 15 | Analytics Department | Core skill | 3.2.0 |
| 19 | R&D Labs / Skunkworks | `impl-labs.md` | 3.6.0 |

---

## 🔲 Backlog

### 6. Team Building Days (Gibbush)
Periodic creative/experimental cycles where normal pipelines are suspended.
- **Schedule**: CEO declares a gibbush day via directive (e.g., monthly or quarterly)
- **Rules during gibbush**:
  - Pipeline enforcement is relaxed — departments can experiment freely
  - R&D can prototype without research/pitch/spec
  - UX/UI can try wild design ideas
  - Cross-department collaboration encouraged
  - All output goes to a `gibbush/` folder per department
- **Post-gibbush**: Board reviews gibbush output in next meeting. Good ideas enter the normal pipeline. Bad ideas are documented as "tried, didn't work."
- **Guard**: CEO sets `gibbushMode: true` in state.json. Departments check this flag. Normal pipeline resumes automatically next cycle unless CEO extends.
- **Effort**: Low | **Impact**: Medium

### 7. HR Department
Agent performance tracking, onboarding new departments, and culture enforcement.
- **Focus**: Track department grades over time, identify consistently underperforming departments, propose corrective actions
- **Pipeline**: `collect-grades → analyze-trends → recommend → report`
- **Owns**: Performance history, grade trends, department health reports, onboarding docs for new departments
- **Does NOT own**: Actual grading (CEO does that), department content, code
- **Artifacts**: `performance/`, `onboarding/`, `reports/`
- **Effort**: Medium | **Impact**: Low — useful at scale, overkill early

### 10. KPI Dashboard & Metrics
Data-driven department evaluation beyond CEO gut-feel grading.
- **Metrics per department**:
  - R&D: games shipped, pipeline throughput, code quality
  - UX/UI: design docs produced, implementation rate, consistency with styleguide
  - Infra: uptime %, audit frequency, runbook coverage
  - PM: changelog freshness, documentation coverage, report cadence
  - Board: decisions made, action items completed
- **Implementation**: IT or PM maintains a `metrics.json` updated each cycle
- **Visualization**: Could render a simple HTML dashboard page on the platform itself
- **Effort**: Medium | **Impact**: Medium

### 12. Retrospectives
Periodic self-assessment where departments reflect on what worked and what didn't.
- **Schedule**: CEO triggers monthly or after major milestones
- **Process**:
  1. Each department writes a retro doc: what went well, what went badly, what to change
  2. Board synthesizes all retros into a company-wide retro summary
  3. CEO reviews and updates SYSTEM.md files if process changes are needed
- **Output**: `departments/<dept>/retros/<date>.md`
- **Effort**: Low | **Impact**: Medium

### 13. Mentorship / Department Shadowing
One department observes another's work to learn and cross-pollinate.
- **Implementation**: CEO writes a directive like "UX/UI: this cycle, also review R&D's latest spec and provide feedback in their inbox"
- **Purpose**: Breaks silos, catches blind spots, builds cross-functional understanding
- **Lightweight**: No new infrastructure — just a CEO directive pattern
- **Effort**: Low | **Impact**: Low

### 16. Seasonal Events & Themed Cycles
Time-based content changes to keep the platform fresh.
- **Examples**: Holiday themes, seasonal game challenges, weekly featured game
- **Implementation**: CEO declares a theme in state.json; UX applies visual changes; R&D adds themed game variants
- **Guard**: Theme changes are additive and reversible — original game/UI preserved
- **Artifacts**: `departments/uxui/themes/`, `departments/rnd/events/`
- **Effort**: Low | **Impact**: Medium

### 17. Internal Newsletter
Periodic digest of what happened across all departments — lighter than Board minutes.
- **Author**: PM department
- **Cadence**: Daily or every 4 cycles
- **Format**: 1-paragraph summary per department, pipeline status, fun stats
- **Delivery**: Written to `departments/pm/newsletters/<date>.md`, optionally sent to Telegram
- **Effort**: Low | **Impact**: Low

### 18. SLA Contracts Between Departments
Formal expectations for inter-department requests.
- **Examples**:
  - R&D → UX/UI: "design review within 2 cycles of inbox task"
  - Infra → all: "health audit published every cycle"
  - PM → all: "changelog updated within 1 cycle of any build"
- **Enforcement**: HR or IT tracks SLA compliance; CEO reviews in inspection
- **State**: `slaContracts: [{ from, to, commitment, metric }]` in state.json
- **Effort**: Low | **Impact**: Medium

### 20. External Partnerships / Plugin Ecosystem
Framework for accepting external contributions (mods, community games, plugins).
- **Concept**: Define a game submission format that external contributors can follow
- **PM owns**: Submission standards, review checklist, contributor docs
- **QA owns**: Testing submitted games
- **R&D owns**: Integration into the platform
- **Pipeline**: `submit → PM review → QA test → R&D integrate → CEO approve → ship`
- **Effort**: Low | **Impact**: Low

---

## Backlog Priority (remaining)

| Priority | Idea | Effort | Impact |
|----------|------|--------|--------|
| 1 | Retrospectives | Low | Medium |
| 2 | Team Building Days | Low | Medium |
| 3 | SLA Contracts | Low | Medium |
| 4 | Seasonal Events | Low | Medium |
| 5 | KPI Dashboard | Medium | Medium |
| 6 | Internal Newsletter | Low | Low |
| 7 | Mentorship / Shadowing | Low | Low |
| 8 | HR Department | Medium | Low |
| 9 | External Partnerships | Low | Low |
