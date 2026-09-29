# Changelog

All notable changes to `cod` are documented here.

**Note on history.** Entries below `[3.8.0]` describe the earlier
`corporate-on-demand` **skill** (departments, pipelines, CEO oversight). That
skill has been removed from this repository - it is preserved in git history at
`a549589` - and the project is now a single CLI. The entries are kept because
they are a real record of what shipped, not because any of it is still
installed.

---

## [Unreleased]

The `cod` CLI. This is a working implementation on branch `feat/infra-scratch`,
not yet tagged or released.

### Added

- **`cod` CLI** — a Bun + TypeScript tool that takes a workspace from an empty
  directory to a running agent container, credential-free.
  - `cod init <company>` — onboarding wizard. Writes a secret-free `cod.json`
    with company, departments and workers seeded from a JSON template, so a new
    department needs no code change.
  - `cod up` / `cod down` / `cod status` — one container per **workspace**, not
    one per agent. `up` starts in ~0.4s once the image exists. `down` is
    idempotent, and deliberately **keeps** the work volume so an agent's
    committed work survives a restart — which is why `cod purge` exists (see
    Ops below).
  - `cod image` — build the workspace image, reporting `cached` vs `built` so a
    slow cold build is never mistaken for a hang.
  - `cod supervise` — run the in-container scheduler and show what it registered.
  - `cod doctor` — host capability, image state, and the vendored binary, with
    the exact command to run when something is missing.
  - `cod config show` — resolved configuration and where each value came from.
- **Container image** (`cod-sandbox`) — Bun 1.3.12 and opencode 1.18.31, both
  version-pinned. The base image is pinned **by digest**, not by tag, so the
  container cannot change under you.
- **In-container cron on `Bun.cron`** — jobs are read from `cod.json` and
  registered by an in-container supervisor. A version guard refuses to start
  below Bun 1.3.12, where `Bun.cron` does not exist, rather than registering
  nothing and reporting itself healthy.
- **Security posture** (`docs/SECURITY_POSTURE.md`) — separates controls that
  are genuinely enforced from convention, and is re-checked against a live
  container on every clean-room run.
- **`verify.sh`** and **`scripts/cleanroom.sh`** — the first gates typecheck,
  tests and build inputs; the second runs the full flow from an empty directory
  through to a real agent producing output.
- **`cod logs` and `cod results`** — `logs` reads the JSONL event log (the
  answer to "what happened"); `results` reads one persisted file per run (what
  ran, when, and whether it worked). Both survive the container.
- **Bounded output, bounded concurrency, honest liveness** — captured process
  output is capped at 4 MB keeping the tail; at most `maxConcurrent` (default 2)
  scheduled jobs run at once, enforced by a real global gate (see Fixed below);
  `cod status` reports supervisor liveness separately from container state and
  exits 1 when a container is up but the schedule is dead.
- **`docs/OPEN_QUESTIONS.md`** — every question is now closed, each with its
  decision *and* its reasoning, so a later change is a revision with a reason
  rather than an accident.

### Fixed during this stage

- **Every cron job was firing hours off.** Docker defaults a container to UTC and
  `Bun.cron` fires on local time; nothing set a zone, so `0 2 * * *` ran at 05:00
  local and reported success. The workspace now carries a `timezone`, validated
  with `Intl`, written from the host by `cod init` and shown by `cod status`.
- **A fresh workspace crash-looped.** With zero enabled crons nothing held Bun's
  event loop open, so the supervisor exited at once and `--restart` restarted it
  forever. `cod up` on a brand new workspace produced an unusable container.
- `cod supervise` passed a shell script to `bun run`, which tried to parse it as
  JavaScript; the entrypoint also discarded the reason a workspace failed to
  parse, replacing it with a bare "refusing to guess".

### Added in the current pass

- **Per-job git worktrees** (`src/worktree.ts`) — one worktree and one branch per
  job, so two agents cannot collide on a path. Verified before implementation:
  five concurrent commits across five worktrees, all clean; git refuses two
  worktrees on one branch.
- **git inside the container**, with a repository initialised in `/work` on
  first start and left alone afterwards. `/work` is a **named volume**, so
  commits and worktrees survive `cod down && cod up` — measured, the container's
  writable layer is destroyed by `docker rm`.
- **Bounded restarts** — `on-failure:5` instead of `unless-stopped`, so a
  supervisor that crashes on startup cannot loop for ever.
- **In-flight job tracking** (`src/inflight.ts`) — a job announces itself before
  it runs, so a crash mid-job is named on the next start instead of vanishing.
  Follows the vocabulary Temporal and Celery use for the same problem.

### The dispatcher, and the two bugs the audit behind it found

An audit of the supervision design against the actual code turned up two bugs
in shipped code. Both are now pinned by tests that would have failed before.

- **`src/dispatch.ts`** — where a job actually happens, now on the live path.
  The supervisor calls `dispatch(cron, echoDriver, { onStep })` rather than
  `echoTask` directly. The contract: a driver is `driver(cron, step)`, where
  `step(kind, label)` is a **boundary** — it checks for a stop request *before*
  the next chunk of work, then records that the previous step completed. Step
  numbers are assigned by the harness, not the driver, so a driver cannot lie
  about how far it got. A failing `onStep` sink cannot fail the job; losses are
  counted and surfaced as "N progress report(s) lost". `shouldStop` is polled
  only *between* steps, never during one.

  It exists because the supervision design assumed a per-step agent loop to
  attach a progress heartbeat to. `echoTask` is synchronous, so it has no step
  boundaries and cannot express "step 3 of 7" — a progress schema designed
  against a synchronous contract is a schema written for a program that was
  never designed. So the loop came first, and the contract is the deliverable.
  `echoDriver` keeps today's behaviour while a real driver is written; `echoTask`
  is retained in `src/task.ts` as the reference shape, and `TaskResult` remains
  the result contract.

- **`settleJob` deleted the wrong marker.** It matched filenames by *substring*
  and deleted the first match, so with crons named `build` and `build-docs` both
  in flight, settling `build` deleted `build-docs`'s marker and left its own —
  readdir order chose the victim. `build` then reported as abandoned for ever
  while `build-docs` lost the evidence it was still running. `beginJob` now
  returns the exact marker name and `settleJob` deletes exactly that, which also
  fixes two concurrent runs of the *same* cron, a case no name search could
  distinguish.

- **`maxConcurrent` was enforced nowhere.** Each cron called
  `runWithLimit(maxConcurrent, [oneClosure])` — a single-element array, and
  `runWithLimit` spawns `min(limit, tasks.length)`, so it always spawned exactly
  one. Ten crons firing at the same minute ran ten jobs at once while the limit
  was read, logged, stored in the heartbeat, and used for nothing. Replaced with
  `createGate` in `src/limit.ts`: one shared global ceiling, FIFO waiters,
  released in a `finally` so a throwing job cannot leak a slot and permanently
  shrink the limit.

  The concurrency test measures peak overlap from *inside* the tasks, since that
  is the only place true overlap is observable. Asserting on scheduling order
  would have passed against the broken version — which is how the bug survived.

### Ops: the things that were missing on a real machine

- **`cod purge`** (`src/purge.ts`) — the counterpart to `cod down`, which
  deliberately *keeps* the work volume so an agent's committed work survives a
  restart, which meant volumes accumulated one per workspace for ever. It
  refuses without `--purge`, derives the volume name from the workspace path so
  it can never be aimed at another volume, and stops the container first because
  Docker refuses to remove a volume that is still in use. `scripts/cleanroom.sh`
  now purges its own throwaway workspace, so a clean-room run leaves zero
  volumes and zero containers behind.
- **A git identity in the image** (`docker/Dockerfile.sandbox`) —
  `git config --global user.email` / `user.name` are set image-wide. With them
  unset, an agent that ran `git init` in *any* directory outside `/work` could
  not commit ("Author identity unknown"), and the failure was invisible: the
  agent's work did not save and nothing logged why. Not a credential — just a
  name for commits authored inside an ephemeral container.
- **`ops/cod-workspace@.service`** — a templated systemd unit so a workspace
  survives a **host** reboot. Docker's `on-failure:5` survives a daemon restart,
  not a reboot. Validated with `systemd-analyze verify`, which caught
  `ExecStartPre` placed in `[Unit]`: systemd *silently ignores* that, so it would
  have been a runtime surprise rather than a startup error. See `ops/README.md`.

### The locked architecture

- **The org approves, never a human.** `cod` is a company of agents; the
  supervisor *is* the CEO. Day one is CEO + CTO + Engineering. A reviewer agent
  checks scope, tests and security and nothing more; on rejection there is one
  retry with the review as feedback, then it stops and reports. Engineering
  self-organises and proposes its own next work; the CEO consolidates and
  dispatches, intervening only on escalation. **Escalation is by blast radius, a
  rule and not a judgement**: anything cross-department or global — schema,
  config, dependencies, the workspace file — goes to the CEO. There is no human
  in the loop at any point. The self-grading hazard is recorded explicitly:
  departments that propose their own work could end up approving and grading
  themselves, and the blast-radius rule plus the independent reviewer are the
  only two brakes. Any change letting an agent approve its own work removes
  both.
- **Budget ceilings: none, deliberately.** Every model is free and
  unauthenticated, so there is nothing to meter and a ceiling that never fires is
  theatre. This becomes real the moment a paid model is added.
- **Cron result visibility: disk and CLI only.** There is no Telegram gateway
  and there never will be one — settled, not deferred. No bot, no push, no
  approval by message. (`cod approve` / `cod reject` do not exist; the doc that
  claimed them was wrong.)
- **Agent-to-agent communication:** files are the durable record
  (`tmp → fsync → rename → fsync(dir)`, so a reader never sees a half-written
  message); SQLite in WAL mode is the coordination index. A broker is premature
  for three agents in one container. **Fencing is mandatory**: every commit is
  `WHERE id=? AND lease_epoch=?`, so an agent killed mid-call — a zombie, not a
  corpse — cannot clobber a newer result. Git worktree isolation does *not*
  prevent this; both runs share the ledger, not the source tree. Exactly-once
  messaging is *not* claimed: it is a property of a storage engine's transaction
  log, not of a bus, and it evaporates once the effect leaves the log into an
  LLM call and a worktree. **The governing invariant: the ledger is a cache, the
  files are the truth.**
- **The supervision design was cut down, deliberately.** Kept: the polling
  reconciler (level-triggered, idempotent because cron re-fires it), the novelty
  gate (self-proposed work enters as `proposed`; only the CEO's tick promotes it
  to `ready` — the anti-loop mechanism, and real enforcement via a `UNIQUE`
  index, not a prompt), fencing, and two-stage escalation (at 1x budget write
  `interrupt_requested`; at 2x bump `lease_epoch` so the next write is fenced
  out; never kill on a heuristic). Cut: the 9-state machine (reduced to
  proposed/ready/running/done/failed + attempts + rejected), a `priority` column,
  `blast_radius` as a computed 0/1/2 column (nothing can measure it yet, so an
  integer would invent precision the system cannot produce), `tokens_used`
  (dead instrumentation, since budget ceilings were closed because every model
  is free), and `state_digest = hash(workspace files)` (an expensive proxy for a
  signal the dispatcher emits directly and free at each step). `inflight.ts`,
  `liveness.ts`, `results.ts`, `worktree.ts` and `log.ts` already cover more of
  the design than the research assumed — do not rebuild them.

  Build order is fixed and non-negotiable: (1) dispatcher with a per-step
  callback, (2) SQLite schema + claim/commit with fencing, (3) `reconcile()` on
  the existing 30s tick, (4) novelty key. Two limits recorded honestly: **slow
  but fine is indistinguishable from stuck** by any local signal, so use a
  per-task Start-To-Close budget and never a global threshold; and **busywork
  detection is genuinely undecidable** from telemetry, so defend by grading the
  outcome at the reviewer gate rather than shipping a semantic-progress scorer
  that measures nothing.

### Known limitations

- **A scheduled job still runs the echo driver, not real work.** The full path
  is real — a `Bun.cron` tick reaches a named agent, runs through
  `src/dispatch.ts`, reports each step, and the result comes back out — but the
  driver still echoes its input. A real driver replaces `echoDriver` and nothing
  above `dispatch` changes. An echo was chosen because it cannot fail for
  interesting reasons: if a scheduled job breaks, the cause is the scheduling,
  not the work.
- **The org in `docs/OPEN_QUESTIONS.md` is a design nothing dispatches yet.**
  The decisions are closed, the build order is fixed, and step 1 (the
  dispatcher) has landed. SQLite, fencing, `reconcile()` and the novelty gate
  have not.
- **No agent-to-agent isolation.** One container, one filesystem, one uid. This
  is the accepted cost of "one container, many agents"; see
  `docs/SECURITY_POSTURE.md`.
- **No budget ceiling, deliberately** — every model is free, so there is nothing
  to meter. Revisit when a paid model is added.
- `Bun.cron` does not support `@every`. Use a standard 5-field expression.
- No inter-agent file locking, and no ledger: the ledger described in
  `docs/AGENT_COMMUNICATION.md` is a decision, not yet code.
- Log redaction catches known credential *shapes*. A secret in prose, a novel
  token format, or one split across two lines is not caught; it is a safety net,
  not a guarantee. `cod.json` is not rewritten — redaction covers what the system
  writes, not what you type.
- A workspace is not started automatically on a **host** reboot unless you
  install `ops/cod-workspace@.service`. Docker's `on-failure:5` covers a daemon
  restart only.

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
