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
| 6 | Team Building Days (Gibbush) | `impl-gibbush.md` | 3.3.0 |
| 7 | HR Department | `impl-hr-dept.md` | 3.3.0 |
| 10 | KPI Dashboard & Metrics | `impl-kpi-dashboard.md` | 3.4.0 |
| 12 | Retrospectives | `impl-retrospectives.md` | 3.4.0 |
| 13 | Mentorship / Shadowing | `impl-mentorship.md` | 3.4.0 |
| 16 | Seasonal Events & Themed Cycles | `impl-seasonal-events.md` | 3.4.0 |
| 17 | Internal Newsletter | `impl-ecosystem.md` | 3.4.0 |
| 18 | SLA Contracts Between Departments | `impl-ecosystem.md` | 3.4.0 |
| 20 | External Partnerships / Plugin Ecosystem | `impl-ecosystem.md` | 3.4.0 |

---

## 🔬 Specced — awaiting v2 backbone

### Self-Improving Prompts
The org distills recurring CEO feedback into versioned SYSTEM.md prompt lines — HR detects, CTO drafts, CEO/Board approves, no department edits its own prompt.
- **Spec**: `spec-self-improving-prompts.md` · **Impl guide**: `impl-self-improving-prompts.md`
- **Status**: Dormant until the v2 SQLite backbone (`plan-v2-honker-sqlite-vec.md`) lands — the loop mines grades, directives, and prompt versions from `project.db`.
- **Track A (done)**: prompt/governance layer — impl guide, owner-role SYSTEM.md lines, retro wire-in.
- **Track B (deferred)**: 6 TS scripts (prompt-version, feedback-mine, grade-trend, prompt-propose, prompt-apply, prompt-revert).
