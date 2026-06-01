---
name: corporate-on-demand
description: "Use when building an autonomous multi-agent system with department structure, mandatory pipelines, anti-slop governance, and CEO oversight. Also use when upgrading an existing corporate project to match a newer skill version."
version: 3.9.0
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

| Need | Reference |
|------|-----------|
| **Strategic planning — start here** | `references/strategy-guide.md` |
| Adding departments — full checklist | `references/migration-checklist.md` |
| Folder structure, schedules, state.json, delegation | `references/architecture.md` |
| Department pipelines & enforcement rules | `references/pipelines.md` |
| Banned words, quality grading, slop prevention | `references/anti-slop.md` |
| Failure modes & mitigations (7 pitfalls) | `references/pitfalls.md` |
| Step-by-step cron setup with code examples | `references/setup.md` |
| Template configs for different domains | `references/company-templates.md` |
| Arcade platform case study | `references/example-arcade-platform.md` |
| C-Suite layer (CEO/CTO/CISO/CPO) — design + planned tools | `references/csuite-layer-plan.md` |
| C-Suite improvement roadmap (next steps) | `references/improvement-roadmap-csuite.md` |
| Confluence — shared knowledge base (decisions, technical docs, runbooks) | `references/impl-confluence.md` |

### Implementation Guides

| Feature | Reference |
|---------|-----------|
| DevOps department | `references/impl-devops-dept.md` |
| Cross-department meetings | `references/impl-cross-dept-meetings.md` |
| Project fast-track | `references/impl-fast-track.md` |
| CEO department creation | `references/impl-dept-creation.md` |
| IT department | `references/impl-it-dept.md` |
| HR department | `references/impl-hr-dept.md` |
| QA department | `references/impl-qa-dept.md` |
| Team building (Gibbush) | `references/impl-gibbush.md` |
| Incident response | `references/impl-incident-response.md` |
| KPI dashboard & metrics | `references/impl-kpi-dashboard.md` |
| Department budgets | `references/impl-dept-budgets.md` |
| Retrospectives | `references/impl-retrospectives.md` |
| Mentorship / shadowing | `references/impl-mentorship.md` |
| Security department | `references/impl-security-dept.md` |
| Analytics department | `references/impl-analytics-dept.md` |
| Seasonal events / themes | `references/impl-seasonal-events.md` |
| **Testing strategy (E2E, escalation, TDD)** | `references/impl-testing-strategy.md` |
| **Development workflows (TDD, E2E-first, spike)** | `references/impl-dev-workflows.md` |
| **Reporting modes (MANDATORY setup)** | `references/impl-reporting-modes.md` |
| **Pre-publish checklist** | `references/pre-publish-checklist.md` |
| Schedule optimization (QA buffer) | `references/impl-schedule-optimization.md` |
| Publishing & distribution | `references/impl-publishing.md` |
| Full changelog | `CHANGELOG.md` |
| Directive propagation status check (post-escalation diagnostic) | `references/impl-directive-status-check.md` |
| QA workflow templates (game verification, release gate, bug report) | `references/qa-workflow-templates.md` |
| Browser-based game testing patterns (pixel checks, failure signatures) | `references/browser-game-testing.md` |
| **Pivoting — strategic direction changes** | `references/impl-pivoting.md` |
| **Sprint Mode — temporary org-wide acceleration** | `references/impl-sprint-mode.md` |
| **Sprint Mode upgrade checklist** | `references/sprint-mode-upgrade-checklist.md` |
| **R&D Labs — default experimentation sandbox** | `references/impl-labs.md` |
| **Public showcase — publishing a project repo** | `references/impl-public-showcase.md` |
| **README & public docs ownership** | `references/impl-readme-ownership.md` |
| **Public repo showcase `.gitignore`** | `templates/gitignore-public-repo` |
| **Upgrade live project to current skill version** | `references/impl-project-upgrade.md` |
| **Role expansion — fill gaps in underutilized departments** | `references/impl-role-expansion.md` |
| **C-Level accountability & merger (CEO state writes, CTO gates, Board expansion)** | `references/impl-clevel-accountability.md` |
| **Self-improving prompts (distill CEO feedback into prompt lines)** | `references/impl-self-improving-prompts.md` |
| Newsletter, SLAs, Plugins | `references/impl-ecosystem.md` |

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

- **Gate-skipping during pivots.** The 7-gate pivot flow is strictly sequential. Complete the transition checklist before advancing `pivot.phase`. Skipping causes departments to miss assessments or votes.
- **Pivot-blind cron prompts.** Data-collection scripts should check `state.json pivot.active` and inject pivot context when true. Without this, departments ignore pivots unless CEO manually updates every directive.
- **Inconsistent script variable names.** Scripts use `PROJ` or `PROJECT` for project path. Bulk-patching must handle both. New scripts should use `PROJ` (majority convention).
- **Cron stagger overflow.** scaffold.ts minute offsets can wrap past 59 with >5 depts. Fix: modulo or cap at 55 with smaller increments.
- **Labs is a default R&D capability, not optional.** When creating an R&D department (scaffold or manual), always include `labs/` directory and Labs section in SYSTEM.md. See `impl-labs.md`.
- **Skill update ≠ project upgrade.** After adding a feature to the skill, live projects don't get it automatically. Always check if projects need the 5-gate upgrade flow (`impl-project-upgrade.md`).
- **csuite-report.ts only supports 4 roles: ceo, cto, ciso, cpo.** CFO is not supported. When upgrading C-Suite scripts, skip CFO or extend the script first.
- **Sprint Mode schema missing from CEO SYSTEM.md.** When upgrading a project to include Sprint Mode, the CEO's SYSTEM.md must include the full `sprintMode` state.json schema (all fields: `cronOverrides`, `parallelTracks`, `fastTrackDepts`, `standupEnabled`, `scopeLock`, `sprintObjectives`, `log[]`, `expiresAt`, `maxDurationDays`). Without the schema, the CEO writes incomplete sprintMode objects and Sprint Mode silently fails. Also ensure `confluence/sprints/` directory exists for standups and retrospectives.
- **Sprint Mode cron overrides are declarative, not automatic.** When the CEO writes `cronOverrides` in state.json, nothing actually changes the real cron job schedules. The operator (user or orchestrator agent) must update the cron jobs to match. Document this clearly in CEO's SYSTEM.md — either the CEO sends an inbox message to the operator, or a script reads cronOverrides and applies them. Without this, Sprint Mode activation is cosmetic.
- **HR department must include Sprint Mode section.** When creating HR (manually or via scaffold), include the same Sprint Mode check-at-cycle-start section that all other departments have. The `impl-hr-dept.md` reference should include this.
- **Self-improving prompts: HR is the canonical owner.** The Prompt Signal role (surface recurring corrections → write [PROMPT-CANDIDATE] to CTO inbox) belongs to HR. When creating a project that will use self-improving prompts, always create an HR department. Only if the project genuinely cannot have HR (e.g. minimal 5-dept setup), fall back to PM as the signal source — but this is a workaround, not the design. When upgrading a project from PM-as-signal to proper HR, remember to: (1) create HR dept with Prompt Signal section, (2) remove the signal section from PM's SYSTEM.md, (3) update CTO's "Prompt Drafting" section to reference HR instead of PM.
- **GitHub Pages without autonomous push.** If a project has a push-triggered GitHub Actions workflow (e.g. Pages deploy), someone must push. DevOps owns this — either via a separate no-agent deploy cron or inline in its script. Don't leave the user as the manual pusher. See `references/impl-devops-dept.md` § "Git Deploy Ownership".
- **Agent doing department work directly (HARD RULE).** When the user asks for a change to a corporate project (fix a bug, add a feature, change the UI), the agent must NOT code it. Write a confluence decision document, update CEO directives in state.json, and send inbox messages to the responsible departments. The departments handle execution through their cron cycles. The agent acts as the Board/CEO — issuing orders, not writing code. If the user says "make the site do X", the correct response is: (1) write `confluence/decisions/` doc with full spec, (2) update `ceoDirectives` in state.json, (3) send inbox messages with priority to affected departments, (4) push so crons pick it up. Priority escalation: use `Priority: P1-CRITICAL` in inbox messages and "P1-CRITICAL:" prefix in directives for urgent work (e.g. security issues like exposed config panels). **Do NOT code the fix yourself and then revert it** — this wastes commits and confuses git history. If you catch yourself about to edit frontend code, game code, CI/CD, or any department-owned file: STOP, write the confluence doc instead. The AGENTS.md in the project should encode this rule. Only exception: P1-CRITICAL security exposure where no cron cycle will run in time — document as incident, notify CEO, file directive for department to properly own it.
- **Custom domain + Cloudflare for GitHub Pages.** When setting up a custom domain: (1) user adds CNAME in Cloudflare pointing to `<user>.github.io`, (2) set proxy to DNS-only (grey cloud) — Cloudflare proxy blocks GitHub's SSL cert provisioning, (3) `gh api repos/OWNER/REPO/pages -X POST -f build_type=workflow` to enable Pages, then `gh api repos/OWNER/REPO/pages -X PUT -f cname=domain -f build_type=workflow` to set the domain, (4) add `CNAME` file containing the domain to the deployed directory (e.g. `frontend/public/CNAME`), (5) re-trigger the workflow. Common failures: 404 with `server: cloudflare` in headers means proxy is still orange-clouded; 404 with `server: GitHub.com` means Pages is enabled but the deploy hasn't run yet — re-trigger workflow. SSL cert provisioning takes 1-5 minutes after DNS switches to grey cloud. Verify with `dig DOMAIN CNAME +short` (should show `<user>.github.io`) and `dig DOMAIN +short` (should show `185.199.*` GitHub IPs, not Cloudflare IPs).
- **Cron prompt ≠ SYSTEM.md — silent directive blackhole.** A department's SYSTEM.md can say "Check inbox FIRST every cycle" but if the cron script's LLM prompt doesn't mention inbox at all, the agent never reads it. SYSTEM.md is reference material the agent *can* consult; the cron prompt is what it *actually does*. Audit every department's cron script prompt against its SYSTEM.md to ensure critical behaviors (inbox processing, pivot protocol, workflow bridging) are explicitly in the prompt, not just SYSTEM.md. HR was the first casualty: 5 P1 directives sat unprocessed because `arcade-hr.sh` only said "analyze grades" — never mentioned inbox.
- **Cron prompt vs SYSTEM.md divergence (critical).** A department's SYSTEM.md may say "check inbox first" but if the cron prompt doesn't mention inbox, the LLM ignores it. The cron prompt is what the LLM actually executes — SYSTEM.md is reference material the LLM may or may not read. **Every department cron prompt MUST explicitly include inbox processing as Step 0.** Don't rely on SYSTEM.md alone. When creating a new department, audit the cron prompt against SYSTEM.md for missing steps. Real example: HR ran 200+ cycles ignoring 5 P1 inbox messages because the prompt only said "analyze grades."
- **Deploy gap — fixes in repo but not live.** R&D can fix a bug and QA can verify the fix locally, but if DevOps doesn't push to the deploy target (GitHub Pages, Docker, etc.), the live site stays broken. The deploy cron/script should compare local HEAD SHA with what's actually deployed and flag drift. Don't assume "fix merged = fix deployed."
- **HR workflow bridge without mechanics.** Telling HR to "bridge workflows into SYSTEM.md" without defining HOW leads to inconsistent or missing integration. HR needs explicit steps: monitor `confluence/workflows/`, check CEO approval status, evaluate applicability per department, patch SYSTEM.md with mandatory selection rules, verify next-cycle compliance. See `references/impl-hr-dept.md` § "Workflow Bridge."
- **PM passive on workflow gaps.** PM must actively scan outbox reports for ad-hoc patterns and propose formalized workflows. Without an explicit scanning process, PM only creates workflows when asked — and nobody asks. PM's outbox must include a "Workflow Gap Analysis" section every cycle. See `references/impl-dev-workflows.md` § "PM — Continuous Workflow Authorship Process."
- **scaffold.ts doesn't create `confluence/workflows/`.** New projects start without a workflow library. After scaffolding, manually create `confluence/workflows/` with at least a `README.md` index and seed initial workflows (TDD, E2E-first, Spike). HR and PM will have nothing to bridge until workflows exist. See `references/setup.md` § "Step 3.5" and `references/qa-workflow-templates.md` for QA templates.
- **Manually-created departments miss standard sections.** When a department is created by hand (not via scaffold.ts or add-department.ts), it will miss sections that all other departments have — Sprint Mode, Confluence, Pivot, Labs, etc. After manually creating a department, always cross-reference an existing department's SYSTEM.md to verify all standard sections are present. The upgrade checklist (`impl-project-upgrade.md`) should include a step to diff every department's section headers against a canonical list.
- **Not every reference belongs in SKILL.md routing table.** The `references/` directory holds two kinds of files: (1) operational references that agents need during cron cycles (these go in the routing table), and (2) planning/spec/research docs for future work (these do NOT go in the routing table). Adding future-work specs to the routing table pollutes the agent's decision space with irrelevant options. Example: `spec-v2-db-migration.md` lives in references/ but is NOT in SKILL.md — it's a planning doc, not an operational guide.
- **Git conflicts when pulling skill updates.** The skill repo accumulates local modifications from autonomous cron operations (CHANGELOG.md, SKILL.md, scripts). Before `git pull`: `git stash`, pull, then `git stash pop`. If pop conflicts, use `git checkout --theirs <file>` for skill-canonical files (SKILL.md, CHANGELOG.md) since upstream is the source of truth for those.
- **Underutilized departments burn tokens on "all nominal."** If a department reports "no issues" for 10+ consecutive cycles, it's underutilized — not proof the system is healthy. Don't merge or remove it. Instead, expand its charter with real gaps: Infra → add Lighthouse CI, post-deploy smoke tests, bundle size tracking. IT → add inbox watchdog (escalate stuck P0/P1 after 2 cycles), dependency audit (`npm outdated`), cross-department sync validation (state.json vs reality), documentation freshness. DevOps → add post-deploy verification (hash comparison), deploy diff reports, Playwright E2E, release notes. Implementation: write a `confluence/decisions/` doc, send HR an inbox message with the new SYSTEM.md sections, notify each department via inbox. Success metric: zero "nothing to do" cycles — every cycle produces actionable data.
- **Grep-only smoke tests miss interactive content bugs.** A post-deploy smoke test that greps HTML for keywords (`launchGame`, `data-game`, no `Backend offline`) only verifies markup structure — it does NOT verify that games/interactive features actually work. The Arcade Platform shipped with a completely broken Pac-Man (spawn inside wall, unplayable) for 197 department cycles because QA only grepped HTML. Canvas-based content, JS-driven UIs, and games require E2E tests with a real browser (Playwright/Puppeteer) that launch the feature, send input, and verify the output changes. When setting up QA for projects with interactive content, always include browser-based E2E tests alongside structural smoke tests.
- **Mobile touch controls are a separate failure class.** Desktop QA passes ≠ mobile works. Touch buttons dispatch synthetic `keydown` events — three common failures: (1) game listens on `window` but touch dispatches to `document` (events don't bubble up), (2) first keypress sets direction AND starts game (ArrowUp = instant wall death), (3) no `keyup` on `touchend` so held-key games get stuck. After any game QA pass, run the mobile checklist in `references/browser-game-testing.md` § "Mobile QA Checklist."
- **No formalized dev workflows = ad-hoc code with no tests.** Without explicit workflow documents, R&D defaults to "write code, ship it, QA will catch it" — and QA defaults to grep. Create `confluence/workflows/` with TDD, E2E-first, Spike, and Creative Pipeline docs. HR must bridge these into department SYSTEM.md files with mandatory selection rules. PM/QA/R&D continuously author new workflows from lessons learned. See `references/impl-dev-workflows.md`.
- **Workflows scoped only to R&D/QA.** Workflows apply to ALL departments, not just code-writing ones. PM identifies gaps across the entire org. HR bridges workflows into every relevant SYSTEM.md. A workflow like "bug report" applies to QA, but "incident response" might apply to DevOps, Security, and Infra. If you only give workflows to R&D and QA, the rest of the org stays ad-hoc. See `references/impl-dev-workflows.md` § "Scope — ALL Departments".
- **HR bottleneck on urgent directive propagation.** When CEO issues P1 directives that require SYSTEM.md changes (e.g. "QA must now do browser-based E2E"), the change doesn't take effect until HR processes its inbox AND updates the target department's SYSTEM.md. If HR's cron cycle runs late or skips, downstream departments (QA, R&D) keep executing stale prompts — producing false PASS reports. Mitigation: after issuing urgent directives, track HR's next cycle and verify SYSTEM.md was actually patched before the target department's next run. If HR misses the window, escalate or consider direct SYSTEM.md patch as emergency exception. The status-check pattern: (1) list inbox files vs done/ files, (2) grep target SYSTEM.md for expected new content, (3) check log timestamps for cycle evidence.
- **C-Level log-only accountability (state.json blackhole).** CEO may write "QA downgraded to D" in its output log but never update `state.json departmentGrades`, `ceoDirectives`, or `pivot.executionPhase`. Result: no department knows about the downgrade, directives reference stale phases, and the org flies blind. Fix: CEO SYSTEM.md must include a **Mandatory State Updates** section listing every state.json field that must be written each cycle, with a verification step (read-back) at the end. Same pattern applies to CTO — if CTO identifies a P0 but doesn't send DEPLOY BLOCKED to DevOps inbox, the deploy goes out anyway. Every C-Level decision must produce either a state.json write or an inbox message — if it's only in the log, it didn't happen.
- **C-Suite role bloat — merge underutilized executives into Board.** CISO, CPO, CFO as separate cron jobs often produce identical "all clean" reports for 30+ cycles. Instead of 3 separate jobs (9 runs/day), merge their responsibilities into Board's expanded agenda: security posture (was CISO), product quality (was CPO), budget/utilization tracking (was CFO), plus stuck-work detection. Pause the individual cron jobs, update Board SYSTEM.md with expanded agenda sections, deprecate the merged departments' SYSTEM.md files. Net savings: ~6 fewer cron runs/day with identical coverage. Keep CEO and CTO as separate jobs — they need distinct cycle frequencies and toolsets.
- **Workflows connected without CEO review.** New workflows authored by departments can be generic or low-quality. Route through CEO review before HR integrates them into SYSTEM.md files. A workflow-watcher cron job (no-agent, monitoring `confluence/workflows/` for new files) alerts when review is needed.
- **README goes stale silently.** Architecture changes happen through cron cycles but nobody updates the README. PM must own README.md with an explicit maintenance section in their SYSTEM.md. QA validates it. See `references/impl-readme-ownership.md`. Especially critical for public repos — the README is the first thing visitors see.
- **New department gaps compound.** When adding a department manually (not via scaffold), it's not just Sprint Mode that gets missed — it's every standard section: Confluence, Pivot, Labs, Sprint Mode, README awareness, etc. After manually creating ANY department, diff its SYSTEM.md section headers against an existing department (e.g. R&D) and add all missing sections. The `validate.ts` script catches structural issues but not missing content sections.

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
