# Pitfalls & Failure Modes

> **Every pitfall the skill has ever hit, in one place.** The SKILL.md routing table
> points here. Don't duplicate pitfalls between SKILL.md and this file — keep this
> file canonical, SKILL.md points to it.
>
> **Organization:** Universal pitfalls (apply to any corporate-on-demand project) come
> first. Domain-specific pitfalls (game development, static hosting, browser-based
> content) live in the relevant case-study doc, e.g. `example-arcade-platform.md` or
> `arcade-platform-changelog-2026-06.md`.

---

## A. Universal — apply to every project

### A1. Pipeline Skipping
**Problem**: Agents jump straight to BUILD without research/spec/design steps, producing low-quality output.
**Mitigation**: Prompt must explicitly say: "If no spec exists for your current directive, write the spec. Do NOT build yet." CEO grades pipeline compliance.

### A2. Domain Bleed
**Problem**: R&D touches CSS, UX writes game logic, Infra modifies application code. Departments step on each other's work.
**Mitigation**: Each SYSTEM.md must have an explicit "you MUST NOT touch" list.
- R&D: "Do NOT modify CSS, design tokens, or layout files"
- UX: "Do NOT modify game logic, backend routes, or Docker configs"
- Infra: "Do NOT modify application code, only infrastructure and deployment"

### A3. Rebuild Conflicts
**Problem**: Two departments modify the same files simultaneously, causing conflicts or overwrites.
**Mitigation**: Staggered schedules with minimum 15-minute gaps. Never tighten below 15 minutes. If a department needs files another is likely editing, use inbox delegation instead.

### A4. Slop Creep
**Problem**: Without active oversight, agent output quality degrades over time — more filler words, vaguer reports, less useful artifacts.
**Mitigation**: CEO inspection loop is essential, not optional. Regular grading creates feedback pressure. Anti-slop contract in every SYSTEM.md. PM cross-checks logs for substance.

### A5. Inbox Pile-up
**Problem**: Departments ignore inbox items, leading to stale delegation tasks and blocked cross-department work.
**Mitigation**:
- Agents must process inbox at the start of every run
- CEO flags stale items (>3 cycles old) during inspection
- PM tracks inbox processing in status reports
- Escalation path: stale inbox → CEO directive → forced processing

### A6. State File Races
**Problem**: Two agents read/write state.json simultaneously, causing data loss or corruption.
**Mitigation**: Staggered schedules ensure only one agent runs at a time. The 15-minute gap provides margin. If using tighter schedules, implement file locking (flock). Never run two departments in parallel.

### A7. Log Bloat
**Problem**: Continuous logging without rotation fills disk and makes logs unusable for PM review.
**Mitigation**: PM or Infra department should rotate logs — keep last 50 entries per department. Implement in Infra's audit routine. CEO can directive log cleanup if sizes grow.

### A8. Snap Bun Sandbox
**Problem**: Snap-installed bun (`/snap/bin/bun`) is sandboxed and cannot access paths like `~/.hermes/`. Every `bun /path/to/script.ts` returns "Module not found".
**Fix**: Use the real bun binary at `~/.bun/bin/bun`. Piping also works: `cat script.ts | bun run -`.

### A9. Scaffold Missing Anti-Slop Contract
**Problem**: `add-department.ts` scaffolds a minimal SYSTEM.md without an anti-slop contract section. Validator fails on `/anti-slop/i` check.
**Fix**: After running `add-department.ts`, append the full anti-slop contract to each new department's SYSTEM.md. Never ship a department with just the scaffold output.

### A10. Browser Toolset Required for E2E Departments
**Problem**: QA, R&D, and CEO need browser tools for E2E smoke tests, pre-ship checks, and visual spot-checks. Default `enabled_toolsets` is `["terminal", "file"]` which blocks browser-based testing.
**Fix**: Set `enabled_toolsets: ["terminal", "file", "browser"]` for QA, R&D, CEO cron jobs.

### A11. State Feedback Fields Stay Empty
**Problem**: `recentChanges`, `blockedTasks`, and `pendingEscalations` in state.json remain `[]` unless every department cron prompt explicitly says "after every action, append to recentChanges". Agents don't infer this from governance docs alone.
**Fix**: Every department cron prompt must contain explicit write instructions for these fields, including the exact JSON shape: `{"dept": "X", "action": "...", "artifact": "...", "timestamp": "ISO8601"}`.

### A12. Schema Migration Stale References
**Problem**: Renaming a state.json field (e.g. `gamePipeline` → `pipeline`) fixes the JSON but leaves stale references in cron prompts, scripts, and TS tools.
**Mitigation**: After any field rename, grep ALL consumers: state.json, cron prompts, shell scripts, TS tools, SYSTEM.md files. Run `validate.ts` + `report.ts` after migration.

### A13. New Department Checklist Gaps
**Problem**: `add-department.ts` scaffolds dirs + SYSTEM.md but does NOT create the data-collection shell script, the cron job, or the state.json department entry.
**Fix**: After scaffolding, manually create all three: shell script at `~/.hermes/scripts/arcade-<dept>.sh`, cron job with correct schedule/toolsets, and department entry in state.json.

### A14. Localhost Health Checks Hide LAN Failures
**Problem**: Department scripts that `curl localhost:PORT` report "healthy" even when LAN clients can't connect. Root cause: frontend JS hardcodes `localhost:3001` as the API URL, which resolves on the server but not on phones/tablets/other machines.
**Detection**: At least one department (QA or Infra) must grep frontend source for hardcoded `localhost` references. QA/R&D should open the site with browser tools and screenshot it.
**Fix**: Give QA, R&D, CEO the `browser` toolset (A10). Add a static-analysis check to QA's SYSTEM.md: "scan index.html for hardcoded localhost references".

### A15. QA Schedule Too Close to R&D/UX
**Problem**: If QA runs only 5 minutes after R&D or UX, it may start testing before the prior department finishes its build.
**Fix**: QA must run at least 20 minutes after R&D and UX. Recommended layout per 2-hour cycle: UX at :10, R&D at :20, QA at :40.

### A16. Hermes Skill Distribution — No Self-Serve Registry
**Problem**: `hermes skills publish --to clawhub` prints "not yet supported". No CLI command to push a skill into the Hermes hub.
**Current options**: (1) Direct URL install: `hermes skills install https://raw.githubusercontent.com/<owner>/<repo>/main/SKILL.md`. (2) Tap: `hermes skills tap add <owner>/<repo>`. (3) `--to github --repo <owner>/<repo>` creates a PR on your own repo. (4) ClawHub web submit at `https://clawhub.ai/publish-skill` (OpenClaw's registry, not Hermes-native).
**Bottom line**: GitHub direct URL + taps are the reliable distribution path for now.

### A17. Publish Readiness
**Problem**: Skills with hardcoded `/home/<user>/` paths, stale version numbers, "Hermes Agent" as author, and project-specific reference files (with real IPs/paths) fail review or confuse other users.
**Fix**: Before publishing, run the checklist in `create-skill` skill's `references/publish.md`. Key items: grep for hardcoded home paths, verify version matches CHANGELOG, set real author, rename project-specific files to `example-*.md` with disclaimer.

### A18. Skill Changes Without Version Bump + Changelog
**Problem**: Agent modifies skill files but forgets to bump the version in SKILL.md frontmatter and update CHANGELOG.md. User has to ask "did you update the version and changelog?" — this should never happen.
**Fix**: Every skill modification — no matter how small — MUST include in the same action batch: (1) version bump in SKILL.md frontmatter, (2) CHANGELOG.md entry with what changed. Treat version+changelog as part of the atomic unit of work, not a follow-up step.

### A19. Gate-skipping During Pivots
**Problem**: The 7-gate pivot flow is strictly sequential. Skipping causes departments to miss assessments or votes.
**Mitigation**: Complete the transition checklist before advancing `pivot.phase`. Data-collection scripts should also check `state.json pivot.active` and inject pivot context when true (otherwise departments ignore pivots unless CEO manually updates every directive).

### A20. Inconsistent Script Variable Names
**Problem**: Scripts use `PROJ` or `PROJECT` for project path. Bulk-patching must handle both.
**Fix**: New scripts should use `PROJ` (majority convention). When patching old scripts, grep for both.

### A21. Cron Stagger Overflow
**Problem**: `scaffold.ts` minute offsets can wrap past 59 with >5 depts.
**Fix**: Modulo or cap at 55 with smaller increments.

### A22. Labs Is a Default R&D Capability, Not Optional
**Problem**: When creating an R&D department (scaffold or manual) and skipping the labs directory, you lose the experimentation sandbox.
**Fix**: Always include `labs/` directory and Labs section in SYSTEM.md. See `impl-labs.md`.

### A23. Skill Update ≠ Project Upgrade
**Problem**: After adding a feature to the skill, live projects don't get it automatically.
**Fix**: Always check if projects need the 5-gate upgrade flow (`impl-project-upgrade.md`).

### A24. csuite-report.ts Only Supports 4 Roles
**Problem**: `csuite-report.ts` only supports ceo, cto, ciso, cpo. CFO is not supported.
**Fix**: When upgrading C-Suite scripts, skip CFO or extend the script first.

### A25. Sprint Mode Schema Missing From CEO SYSTEM.md
**Problem**: When upgrading a project to include Sprint Mode, the CEO's SYSTEM.md must include the full `sprintMode` state.json schema (all fields: `cronOverrides`, `parallelTracks`, `fastTrackDepts`, `standupEnabled`, `scopeLock`, `sprintObjectives`, `log[]`, `expiresAt`, `maxDurationDays`). Without the schema, the CEO writes incomplete sprintMode objects and Sprint Mode silently fails.
**Fix**: Include the full schema in CEO's SYSTEM.md. Also ensure `confluence/sprints/` directory exists for standups and retrospectives.

### A26. Sprint Mode Cron Overrides Are Declarative, Not Automatic
**Problem**: When the CEO writes `cronOverrides` in state.json, nothing actually changes the real cron job schedules.
**Fix**: The operator (user or orchestrator agent) must update the cron jobs to match. Document this clearly in CEO's SYSTEM.md — either the CEO sends an inbox message to the operator, or a script reads cronOverrides and applies them. Without this, Sprint Mode activation is cosmetic.

### A27. HR Department Must Include Sprint Mode Section
**Problem**: When creating HR (manually or via scaffold) and skipping the Sprint Mode section, urgent P1 directives requiring SYSTEM.md changes can sit unprocessed.
**Fix**: Include the same Sprint Mode check-at-cycle-start section that all other departments have. The `impl-hr-dept.md` reference should include this.

### A28. Self-Improving Prompts: HR Is the Canonical Owner
**Problem**: The Prompt Signal role (surface recurring corrections → write [PROMPT-CANDIDATE] to CTO inbox) belongs to HR. PM-as-signal is a workaround.
**Fix**: When creating a project that will use self-improving prompts, always create an HR department. When upgrading from PM-as-signal to proper HR: (1) create HR dept with Prompt Signal section, (2) remove the signal section from PM's SYSTEM.md, (3) update CTO's "Prompt Drafting" section to reference HR instead of PM.

### A29. GitHub Pages Without Autonomous Push
**Problem**: If a project has a push-triggered GitHub Actions workflow (e.g. Pages deploy), someone must push.
**Fix**: DevOps owns this — either via a separate no-agent deploy cron or inline in its script. Don't leave the user as the manual pusher. See `references/impl-devops-dept.md` § "Git Deploy Ownership".

### A30. Agent Doing Department Work Directly (HARD RULE)
**Problem**: When the user asks for a change to a corporate project (fix a bug, add a feature, change the UI, update infrastructure), the agent must NOT do it. The agent is the Board/CEO — issuing orders, not writing code or running ops. This includes infrastructure changes: don't run `docker compose down`, don't edit `docker-compose.yml`, don't modify CI configs.
**Fix**: Write a confluence decision document, update CEO directives in state.json, and send inbox messages to the responsible departments. If the user says "remove Docker" the correct response is a decision doc + DevOps inbox, not `rm docker-compose.yml`. If you catch yourself about to edit any project file directly: STOP, write the confluence doc instead.
**Only exception**: P1-CRITICAL security exposure where no cron cycle will run in time — document as incident, notify CEO, file directive for department to properly own it.

### A31. Cron Prompt ≠ SYSTEM.md — Inbox Is a Silent Blackhole
**Problem**: A department's SYSTEM.md can say "Check inbox FIRST every cycle" but if the cron script's LLM prompt doesn't mention inbox at all, the agent never reads it. SYSTEM.md is reference material the agent *can* consult; the cron prompt is what it *actually does*. **Every department cron prompt MUST explicitly include inbox processing as Step 0.** Don't rely on SYSTEM.md alone. Real example: HR ran 200+ cycles ignoring 5 P1 inbox messages because the prompt only said "analyze grades."
**Fix**: When creating a new department, audit the cron prompt against SYSTEM.md for missing steps. Critical behaviors (inbox processing, pivot protocol, workflow bridging) must be explicitly in the prompt, not just SYSTEM.md.

### A32. Deploy Gap — Fixes in Repo but Not Live
**Problem**: R&D can fix a bug and QA can verify the fix locally, but if DevOps doesn't push to the deploy target (GitHub Pages, Docker, etc.), the live site stays broken.
**Fix**: The deploy cron/script should compare local HEAD SHA with what's actually deployed and flag drift. Don't assume "fix merged = fix deployed."
**Diagnostic pattern**: When bugs are reported on production, always test localhost too. If localhost passes but production fails → deploy gap (just push). If both fail → genuinely unfixed.

### A33. HR Workflow Bridge Without Mechanics
**Problem**: Telling HR to "bridge workflows into SYSTEM.md" without defining HOW leads to inconsistent or missing integration.
**Fix**: HR needs explicit steps: monitor `confluence/workflows/`, check CEO approval status, evaluate applicability per department, patch SYSTEM.md with mandatory selection rules, verify next-cycle compliance. See `references/impl-hr-dept.md` § "Workflow Bridge."

### A34. PM Passive on Workflow Gaps
**Problem**: PM only creates workflows when asked — and nobody asks.
**Fix**: PM must actively scan outbox reports for ad-hoc patterns and propose formalized workflows. PM's outbox must include a "Workflow Gap Analysis" section every cycle. See `references/impl-dev-workflows.md` § "PM — Continuous Workflow Authorship Process."

### A35. scaffold.ts Doesn't Create `confluence/workflows/`
**Problem**: New projects start without a workflow library.
**Fix**: After scaffolding, manually create `confluence/workflows/` with at least a `README.md` index and seed initial workflows (TDD, E2E-first, Spike). HR and PM will have nothing to bridge until workflows exist. See `references/setup.md` § "Step 3.5" and `references/qa-workflow-templates.md` for QA templates.

### A36. Manually-Created Departments Miss Standard Sections
**Problem**: When a department is created by hand (not via scaffold.ts or add-department.ts), it will miss sections that all other departments have — Sprint Mode, Confluence, Pivot, Labs, etc.
**Fix**: After manually creating a department, always cross-reference an existing department's SYSTEM.md to verify all standard sections are present. The upgrade checklist (`impl-project-upgrade.md`) should include a step to diff every department's section headers against a canonical list.

### A37. Not Every Reference Belongs in SKILL.md Routing Table
**Problem**: The `references/` directory holds two kinds of files: (1) operational references that agents need during cron cycles (these go in the routing table), and (2) planning/spec/research docs for future work (these do NOT go in the routing table). Adding future-work specs to the routing table pollutes the agent's decision space with irrelevant options.
**Fix**: Example: `spec-v2-db-migration.md` lives in references/ but is NOT in SKILL.md — it's a planning doc, not an operational guide.

### A38. Git Conflicts When Pulling Skill Updates
**Problem**: The skill repo accumulates local modifications from autonomous cron operations (CHANGELOG.md, SKILL.md, scripts).
**Fix**: Before `git pull`: `git stash`, pull, then `git stash pop`. If pop conflicts, use `git checkout --theirs <file>` for skill-canonical files (SKILL.md, CHANGELOG.md) since upstream is the source of truth for those.

### A39. Underutilized Departments Burn Tokens on "All Nominal"
**Problem**: If a department reports "no issues" for 10+ consecutive cycles, it's underutilized — not proof the system is healthy.
**Fix**: Don't merge or remove it. Instead, expand its charter with real gaps: Infra → add Lighthouse CI, post-deploy smoke tests, bundle size tracking. IT → add inbox watchdog (escalate stuck P0/P1 after 2 cycles), dependency audit (`npm outdated`), cross-department sync validation (state.json vs reality), documentation freshness. DevOps → add post-deploy verification (hash comparison), deploy diff reports, Playwright E2E, release notes. Implementation: write a `confluence/decisions/` doc, send HR an inbox message with the new SYSTEM.md sections, notify each department via inbox. Success metric: zero "nothing to do" cycles — every cycle produces actionable data.

### A40. Grep-Only Smoke Tests Miss Interactive Content Bugs
**Problem**: A post-deploy smoke test that greps HTML for keywords only verifies markup structure — it does NOT verify that games/interactive features actually work.
**Fix**: Canvas-based content, JS-driven UIs, and games require E2E tests with a real browser (Playwright/Puppeteer) that launch the feature, send input, and verify the output changes. When setting up QA for projects with interactive content, always include browser-based E2E tests alongside structural smoke tests.

### A41. No Formalized Dev Workflows = Ad-Hoc Code With No Tests
**Problem**: Without explicit workflow documents, R&D defaults to "write code, ship it, QA will catch it" — and QA defaults to grep.
**Fix**: Create `confluence/workflows/` with TDD, E2E-first, Spike, and Creative Pipeline docs. HR must bridge these into department SYSTEM.md files with mandatory selection rules. PM/QA/R&D continuously author new workflows from lessons learned. See `references/impl-dev-workflows.md`.

### A42. Workflows Scoped Only to R&D/QA
**Problem**: Workflows apply to ALL departments, not just code-writing ones. PM identifies gaps across the entire org. HR bridges workflows into every relevant SYSTEM.md.
**Fix**: A workflow like "bug report" applies to QA, but "incident response" might apply to DevOps, Security, and Infra. If you only give workflows to R&D and QA, the rest of the org stays ad-hoc. See `references/impl-dev-workflows.md` § "Scope — ALL Departments".

### A43. HR Bottleneck on Urgent Directive Propagation
**Problem**: When CEO issues P1 directives that require SYSTEM.md changes (e.g. "QA must now do browser-based E2E"), the change doesn't take effect until HR processes its inbox AND updates the target department's SYSTEM.md. If HR's cron cycle runs late or skips, downstream departments (QA, R&D) keep executing stale prompts — producing false PASS reports.
**Fix**: After issuing urgent directives, track HR's next cycle and verify SYSTEM.md was actually patched before the target department's next run. If HR misses the window, escalate or consider direct SYSTEM.md patch as emergency exception. The status-check pattern: (1) list inbox files vs done/ files, (2) grep target SYSTEM.md for expected new content, (3) check log timestamps for cycle evidence.

### A44. HR Approval Chain for SYSTEM.md Is Unnecessary Overhead
**Problem**: The original flow "HR diagnoses → CTO drafts → CEO approves → SYSTEM.md updated" adds 3 cycle delays for propagating decisions that are already CEO-approved.
**Fix**: HR should write directly to department SYSTEM.md files when the source decision lives in `confluence/decisions/` (which means it's already approved). HR's SYSTEM.md should say "you diagnose AND write directly" — not "you diagnose, CTO drafts, CEO approves." HR's role is propagation, not gatekeeping. Add a "Workflow Bridge" section to HR SYSTEM.md: every cycle, check `confluence/decisions/` and `confluence/workflows/` for new entries, identify affected departments, write new rules directly into their SYSTEM.md, and send inbox confirmation.

### A45. CEO Phase Mapping Must Reference the Execution Plan, Not Count Files
**Problem**: If CEO SYSTEM.md says "count js/games/*.js and set phase accordingly," the mapping will drift from the actual execution plan (e.g. Phase 3 = "3-5 games" vs reality = "all 7 games").
**Fix**: CEO SYSTEM.md must reference the gate execution plan document (`confluence/decisions/*-gate*-execution-plan.md`) and define phases by their *completion criteria*, not file counts. Also add an explicit instruction: "When ALL completion criteria for the current phase are met, you MUST advance executionPhase AND update all department directives with next-phase tasks. Do not wait." Without this, CEO confirms "Phase 3 complete" in its log but leaves executionPhase=3, blocking the entire org.

### A46. CEO Frequency Matters — 3x/Day Causes Overnight Stalls
**Problem**: At 3x/day (08:00, 14:00, 22:00), a 10h overnight gap means no phase advancement, no directive updates, no escalation handling for half the day while departments burn cycles idle.
**Fix**: CEO at `0 */4 * * *` (6x/day) to match CTO cadence. Max 4h gap between inspections. Board already runs every 2h and can escalate, but can't substitute for CEO's state.json writes and directive authority.

### A47. C-Level Log-Only Accountability (state.json blackhole)
**Problem**: CEO may write "QA downgraded to D" in its output log but never update `state.json departmentGrades`, `ceoDirectives`, or `pivot.executionPhase`. Result: no department knows about the downgrade, directives reference stale phases, and the org flies blind.
**Fix**: CEO SYSTEM.md must include a **Mandatory State Updates** section listing every state.json field that must be written each cycle, with a verification step (read-back) at the end. Same pattern applies to CTO — if CTO identifies a P0 but doesn't send DEPLOY BLOCKED to DevOps inbox, the deploy goes out anyway. Every C-Level decision must produce either a state.json write or an inbox message — if it's only in the log, it didn't happen.

### A48. C-Suite Role Bloat — Merge Underutilized Executives Into Board
**Problem**: CISO, CPO, CFO as separate cron jobs often produce identical "all clean" reports for 30+ cycles. 3 separate jobs = 9 runs/day with near-zero actionable output.
**Fix**: Merge their responsibilities into Board's expanded agenda: security posture (was CISO), product quality (was CPO), budget/utilization tracking (was CFO), plus stuck-work detection. Pause the individual cron jobs, update Board SYSTEM.md with expanded agenda sections, deprecate the merged departments' SYSTEM.md files. Net savings: ~6 fewer cron runs/day with identical coverage. Keep CEO and CTO as separate jobs — they need distinct cycle frequencies and toolsets.

### A49. Workflows Connected Without CEO Review
**Problem**: New workflows authored by departments can be generic or low-quality.
**Fix**: Route through CEO review before HR integrates them into SYSTEM.md files. A workflow-watcher cron job (no-agent, monitoring `confluence/workflows/` for new files) alerts when review is needed.

### A50. Changelog/Journey Log Goes Stale — No Department Owns It
**Problem**: Projects with a `changelog.json` (or similar public-facing log) will go stale unless a department explicitly owns updates.
**Fix**: PM is the natural owner — they already track completions. Assign PM changelog ownership in their SYSTEM.md: "After detecting a significant event (game shipped, phase change, major decision), append an entry to `changelog.json`." For richer public storytelling, add a `journey.json` with narrative entries (date, title, narrative paragraph written in human voice) and a toggle in the UI. Creative should review journey entries for tone — no corporate-speak. R&D builds the toggle UI, UX/UI designs the view.

### A51. Local Dev Environment Must Match Production Exactly
**Problem**: If production is GitHub Pages (static files over HTTP), local dev must be the same — `python3 -m http.server` or `bunx serve` from the public directory. Not nginx in Docker, not a Node backend proxying files. Testing on a different stack than production means bugs pass locally and break live (or vice versa).
**Fix**: When Docker exists from a pre-static era, DevOps must remove it entirely — don't just "stop using it," delete the files so nobody accidentally rebuilds and tests against the wrong environment. Formalize this in `confluence/workflows/local-dev-server.md`.

### A52. Pre-Push QA Gate Is Mandatory for Static Sites
**Problem**: Because GitHub Pages deploys on every push to main, there is no staging environment — push = production.
**Fix**: The workflow must enforce: R&D self-tests on localhost → QA verifies on localhost → QA APPROVE → only then DevOps pushes. Without this gate, "testing on production" becomes the default, and broken games ship to users. Create `confluence/workflows/local-dev-server.md` and `build-test-deploy.md` to formalize the pipeline. See also `references/impl-dev-workflows.md`.

### A53. Auto-Deploy Cron Bypasses QA Gate Silently
**Problem**: If a `no_agent` deploy cron runs `git add -A && git push` on a schedule, it ships whatever R&D wrote — untested, unreviewed — straight to production. Establishing a "QA must approve before push" rule is useless if the deploy cron doesn't check for approval.
**Fix**: Deploy script must check for a gate file (`departments/qa/approvals/ready-to-push`) before pushing. If it exists, push and delete the file (one approval per deploy). If it doesn't exist, skip the push and send a P0 alert ("code waiting, QA has not approved"). QA's SYSTEM.md must include instructions to create the gate file only after localhost verification. The deploy cron should deliver alerts to Telegram (not `local`) so the owner sees blocked deploys.

### A54. PT Reports Become Shelf-Ware Without Security Triage
**Problem**: Running a weekly PT scan is useless if findings sit in a file nobody reads.
**Fix**: Security must own the triage: break each CRITICAL/HIGH/MEDIUM finding into a separate inbox task for the owning department (R&D for code, DevOps for infra, CTO for architecture), with file, line, PoC, deadline (CRITICAL=next cycle, HIGH=2 cycles, MEDIUM=1 week), and a tracking table at `departments/security/pt-tracking/`. Generic "review the PT report" inbox messages don't work — departments need specific tasks with specific files. Security also verifies fixes before marking RESOLVED. See `references/impl-external-pt.md` § "Security Department as Triage Owner".

### A55. Nobody Reviews Department Output for Relevance
**Problem**: Departments run autonomously but no one checks whether their work is still relevant after architecture changes.
**Fix**: CTO must own a per-cycle department relevance review checking: (1) does work reflect current architecture? (2) are they referencing things that still exist? (3) is output actionable or ceremony? (4) are pending inbox items addressed? CTO writes reviews to `departments/cto/reviews/`. Board enforces CTO reviews exist. See `confluence/decisions/*-cto-department-review.md` pattern. After ANY architecture pivot, proactively audit every department's scope — don't wait for someone to notice the waste.

### A56. README Goes Stale Silently
**Problem**: Architecture changes happen through cron cycles but nobody updates the README.
**Fix**: PM must own README.md with an explicit maintenance section in their SYSTEM.md. QA validates it. See `references/impl-readme-ownership.md`. Especially critical for public repos — the README is the first thing visitors see.

### A57. New Department Gaps Compound
**Problem**: When adding a department manually (not via scaffold), it's not just Sprint Mode that gets missed — it's every standard section: Confluence, Pivot, Labs, Sprint Mode, README awareness, etc.
**Fix**: After manually creating ANY department, diff its SYSTEM.md section headers against an existing department (e.g. R&D) and add all missing sections. The `validate.ts` script catches structural issues but not missing content sections.

### A58. PM Tracks Decisions as Completions (Decision ≠ Execution)
**Problem**: PM will mark a task "complete" the moment a decision doc is filed or an inbox is sent — before the executing department has done anything.
**Fix**: PM SYSTEM.md must include a mandatory task status lifecycle: `planned` (decision filed) → `in progress` (department acknowledged) → `pending verification` (department says done) → `complete` (independently verified). A task is never "complete" without evidence of execution AND verification. When creating PM via scaffold or manually, include this status table in SYSTEM.md § "Task Status Tracking".

### A59. Security Audits Go Stale After Architecture Pivots
**Problem**: When the deployment target changes (e.g. Docker+backend → GitHub Pages static), Security will keep auditing the old stack unless explicitly told to update scope.
**Fix**: After ANY architecture pivot, send Security an inbox with: (1) what infrastructure was removed, (2) what the new deployment target is, (3) what the new audit checklist should cover. Also consider external PT (e.g. OpenCode + DeepSeek) for a fresh-eyes review that isn't anchored to the old checklist.

### A60. PM/Task Tracking Marks Decisions Complete Before Execution
*(Universal version of A58 — applies beyond PM to any tracker)*: A decision filed = `planned` at best, never `complete`. The container is still running until someone verifies the container is gone. See A58 for PM-specific lifecycle.

---

## B. Domain-Specific — games / interactive content

> These pitfalls apply to projects with canvas-based content, JS-driven UIs, or
> mobile-touched games. They live here (not in SKILL.md) because they don't apply to
> non-interactive projects like SaaS, content sites, or devtools.

### B1. Games Can Ship With Zero Touch Support
**Problem**: Breakout shipped with only keyboard and mouse handlers — no `touchstart`/`touchmove`/`touchend` at all. On iOS/mobile it was completely unplayable.
**Fix**: Add `touchmove`/`touchstart` listeners that map to the same state as keyboard (e.g. paddle position from touch X coordinate, tap to launch ball). Quick audit:
```bash
for f in frontend/public/js/games/*.js; do
  if ! grep -qiE 'touch|pointer|Pointer' "$f"; then
    echo "NO TOUCH: $f"
  fi
done
```

### B2. Mobile Touch Controls Are a Separate Failure Class
**Problem**: Desktop QA passes ≠ mobile works. Touch buttons dispatch synthetic `keydown` events — three common failures: (1) game listens on `window` but touch dispatches to `document` (events don't bubble up), (2) first keypress sets direction AND starts game (ArrowUp = instant wall death), (3) no `keyup` on `touchend` so held-key games get stuck.
**Fix**: After any game QA pass, run the mobile checklist in `references/browser-game-testing.md` § "Mobile QA Checklist."

---

## C. Domain-Specific — static hosting / GitHub Pages

> Applies when production target is GitHub Pages, Netlify, Vercel-static, S3+CloudFront,
> or any "static files over HTTP" deployment.

### C1. Static Sites Must Not Have Docker At All
**Problem**: If the production target is GitHub Pages (or any static host), Docker has no role — not for dev, not for testing, not for "nginx header verification." GitHub Pages doesn't use nginx, so testing with nginx means testing a different environment than production.
**Fix**: Remove `docker-compose.yml`, `Dockerfile`, `nginx.conf`, and any backend directory from the repo entirely. Local dev = `python3 -m http.server 8080` or `bunx serve` from the public directory. This matches production exactly: static files over HTTP, nothing else. If Docker artifacts exist from a pre-static era, issue a decision to DevOps to clean them up — don't leave dead infrastructure in the repo.

### C2. Custom Domain + Cloudflare for GitHub Pages
**Problem**: When setting up a custom domain with Cloudflare proxy enabled (orange cloud), SSL cert provisioning fails.
**Fix**:
1. User adds CNAME in Cloudflare pointing to `<user>.github.io`
2. Set proxy to DNS-only (grey cloud) — Cloudflare proxy blocks GitHub's SSL cert provisioning
3. `gh api repos/OWNER/REPO/pages -X POST -f build_type=workflow` to enable Pages
4. `gh api repos/OWNER/REPO/pages -X PUT -f cname=domain -f build_type=workflow` to set the domain
5. Add `CNAME` file containing the domain to the deployed directory (e.g. `frontend/public/CNAME`)
6. Re-trigger the workflow
**Diagnose**: 404 with `server: cloudflare` = proxy still orange-clouded. 404 with `server: GitHub.com` = Pages enabled but deploy hasn't run yet. SSL cert takes 1-5 min after DNS switches to grey cloud. Verify with `dig DOMAIN CNAME +short` (should show `<user>.github.io`) and `dig DOMAIN +short` (should show `185.199.*` GitHub IPs, not Cloudflare IPs).

---

## D. Cross-References

- Pitfalls specific to live Arcade Platform operations: `arcade-platform-changelog-2026-06.md`
- Sprint Mode: `impl-sprint-mode.md`
- Pivoting: `impl-pivoting.md`
- Workflows: `impl-dev-workflows.md`
- Self-improving prompts: `impl-self-improving-prompts.md`
- External PT: `impl-external-pt.md`
