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

### The work ledger, the reconciler, and the anti-loop gate

The coordination layer, in `38b3683`, with three corruption bugs found by review
and fixed in `ba1d316`. All three are on the CLI, which is a hard project
requirement: `cod work list | propose | claim | commit` and `cod reconcile`.

- **The work ledger** (`src/work.ts`) — two layers, deliberately separated. The
  **files are the truth**, readable with `jq` and surviving total loss of the
  database; **the SQLite table is a cache** over them. *The ledger is a cache;
  the files are the truth.* Claim is a single `UPDATE … RETURNING`, and
  SQLite's write lock makes exactly one concurrent caller win: verified with
  **eight separate processes** racing for one item, exactly one winner. Processes
  and not promises, because the write lock is the mechanism and an in-process
  test cannot exercise it.

- **Fencing** — every commit is `WHERE id=? AND lease_epoch=?`. An agent killed
  mid-call is a **zombie, not a corpse**: if the supervisor re-dispatches, the
  new run writes, and then the old process wakes and clobbers it. A stale epoch
  updates zero rows. **Git worktree isolation does not prevent this** — both
  runs share the ledger, not the source tree. The epoch is also *consumed* by
  the commit that uses it, so a second writer at the same epoch is refused and a
  budget reclaim fences the worker it reclaimed.

- **The reconciler** (`src/reconcile.ts`) — the CEO's loop, **level-triggered**
  in the Kubernetes sense: it does not wait to be told what changed, it re-reads
  current state every tick and converges, so an event missed while the process
  was down self-heals instead of being lost. Anything edge-triggered would
  therefore be decoration, and the loop must be **idempotent** because cron
  re-fires it regardless. It rides the **existing 30s supervisor tick** and is
  wrapped so a ledger failure cannot take down every cron. Four jobs per pass:
  promote or reject proposals; reclaim work past its **per-item** budget; recover
  work whose acknowledgement was lost — by **reading the durable file, never
  re-running the job**, because re-running a finished job double-executes and
  double-bills it; report.

- **The anti-loop gate** — departments propose their own next work, so a
  proposal enters as `proposed` and **only the reconciler may promote it to
  `ready`**. Duplicates are refused by a `UNIQUE` index on `novelty_key`, a
  sha256 of department + goal + sorted target paths truncated to 32 hex chars.
  Real enforcement, not a prompt asking an agent to notice, and the brake on
  self-graded work. Blast radius is a **rule, not a judgement**: radius 2 is
  global and is refused whatever proposed it, radius 1 stays runnable, and the
  predicate is a separate pure function so the policy cannot drift.

**Deliberately not built**, recorded so a later change reads as a revision: the
9-state machine (cut to `proposed`/`ready`/`running`/`done`/`failed` plus
`attempts`; `claimed`/`review`/`merged`/`abandoned` are states for a pipeline and
reviewer that do not exist), a `priority` column (a column that is always a
constant is a lie in a schema), `tokens_used` (budget ceilings were closed
because every model is free, so a token counter is dead instrumentation), and a
computed `state_digest` (an expensive proxy for a signal the dispatcher emits
directly and free at each step).

**`blast_radius` is a policy hint, not an unspoofable control.** The rule is
enforced; the input is not. It is supplied by the proposing agent, so an agent
can declare `0` for global work, and the reconciler's refusal is only as strong
as that value. Stated plainly rather than described as a guarantee.

### Docs: the ledger, the reconciler, and the anti-loop gate

- `README.md` — the three features, the CLI surface with the flags as actually
  implemented in `src/index.ts` and `src/meta.ts`, and a **worked lifecycle
  whose every line is real captured output**: propose, a duplicate refused,
  unclaimable until `cod reconcile`, claim, a stale-epoch commit fenced, a good
  commit accepted, and a radius-2 proposal rejected. Test badge corrected from
  221 to the measured **257**.
- `docs/OPEN_QUESTIONS.md` — build-order steps 2–4 marked **Done**; the three
  corruption bugs recorded as design changes rather than code fixes; the
  `blast_radius` entry restated as *revised, not cut*, with its honest limit.
- `docs/AGENT_COMMUNICATION.md` — option 1 marked **implemented**, plus a new
  section on where the implementation diverged from the research and why.
- `skills/cod-system/` — a **Ledger invariants** section in `invariants.md`
  (the cache/truth rule, fencing, epoch consumption, the reconciler's exclusive
  right to promote, the result-file rule); the reconciler tick documented in
  `scheduling.md`; the ledger and reconciler added to `architecture.md`'s
  diagram and state-directory table; and a fourth "thing to know before editing
  anything" in `SKILL.md`.

**Verified by mutation, not only by assertion.** Removing the `lease_epoch`
predicate from `commit()` fails **18** tests; making proposals born `ready`,
which bypasses the CEO entirely, fails **12**. A test that passes against broken
code is worth nothing.

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

- **A ledger database file is committed to the repository**, at
  `proposed/work/ledger.sqlite` (32 KB), added in `ba1d316`. It is a runtime
  artifact from a test or a manual run in a directory called `proposed/`, not a
  fixture, and it should be removed and gitignored. Removing a tracked binary is
  a `git rm`, not a docs change, so it is reported rather than done.
- **`work list --state <s>` cannot be used as a state filter, and it writes.**
  `--state` is the global *state directory* flag, so `cod work list --state ready`
  passes `ready` to `configFrom` as the state directory. Two consequences,
  both measured: it prints `work ledger is empty` while the rows exist, and
  because `openWork` does `mkdirSync` on the state dir, the run **creates a
  directory named after the state value in the current working directory** —
  `cod work list --state done` leaves behind `./done/work/ledger.sqlite`. Two
  meanings on one flag is the defect; renaming the filter is a `src/` change and
  was out of scope here.
- **The `epoch` table is dead.** It is created and seeded in `SCHEMA` and never
  read; `claim` takes `lease_epoch + 1` from the row. Harmless, but it is a
  second piece of state that looks load-bearing. Dropping it is a schema change.
- **The `rejected` state is never written.** It is in the `WorkState` union and
  the reconciler's report has a `rejected` bucket, but rejections are committed
  as `state='failed'` with a reason. A reader filtering on `state='rejected'`
  finds nothing.
- **`QUICKSTART.md` said 47 tests.** It had been carried over from an early
  stage and never corrected, while the badge and README said 221. A reader
  running the command saw a number that matched nothing. Corrected to the
  measured 221.

- **A doubled `/**` in `src/commands.ts` opened the purge doc comment.** It
  compiled, because the inner `/**` is just comment text, so nothing caught it.
  Reported here rather than fixed, since `src/` was out of scope for the docs
  pass; **fixed in `85cdc20`** immediately after. Recorded because a silent
  cosmetic defect that survives every test is exactly the kind that gets
  mistaken for intent later.
- **Two tests in `tests/limits.test.ts` are mislabelled, and one does not
  exercise what its name says.** `a released slot is handed to the next waiter`
  never creates a waiter — it acquires and releases in a loop and asserts
  `active() === 0`, which is the "no leak" check, not a hand-off check.
  `a throwing task still frees its slot` throws nothing; it calls
  `acquire`/`release` directly, and the `finally` it claims to cover is in
  `scheduler.ts`, not in the gate. The FIFO hand-off *is* covered, by
  `waiters are served in arrival order`. Left unfixed: `tests/` is out of
  scope for this change. The gate's behaviour is not in doubt — the other four
  tests measure it, and `scheduler.ts` releases in a `finally` by inspection.
- **A scheduled job still runs the echo driver, not real work.** The full path
  is real — a `Bun.cron` tick reaches a named agent, runs through
  `src/dispatch.ts`, reports each step, and the result comes back out — but the
  driver still echoes its input. A real driver replaces `echoDriver` and nothing
  above `dispatch` changes. An echo was chosen because it cannot fail for
  interesting reasons: if a scheduled job breaks, the cause is the scheduling,
  not the work.
- **The org in `docs/OPEN_QUESTIONS.md` is a design that now dispatches, but
  only its floor.** The decisions are closed and the fixed build order is
  complete — dispatcher, ledger with fencing, reconciler on the 30s tick, and
  the novelty gate all landed. What is still missing is everything above that
  floor: no reviewer agent, no merge step, and the driver is still the echo
  driver, so no work actually runs through the ledger yet. The ledger is
  correct and reachable; it is not yet fed by real agents.
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

## Unreleased - two engines, and a run is judged by its stream

- **A run is successful only if the stream proves it** (`src/assert.ts`). Exit
  code 0 is not evidence: we shipped a bug where an agent given no instructions
  completed the task anyway and the job looked fine. Now required: a terminal
  `step_finish`, at least one completed tool, no error events, and a prompt long
  enough to be a real instruction. Mutation-verified - every rule is load
  bearing.
- **A failed agent is no longer recorded as `ok`.** The assertion's verdict was
  in the job output the whole time and nothing read it, so a run that had just
  reported a provider outage was displayed as a success.
- **A second engine**: `@kilocode/cli` 7.8.1 (MIT), pinned, chosen by model id
  with no schema change. It is an opencode fork, so this diversifies the model
  pool rather than the failure modes - which is the honest reason to run both.
- **Rotation by measured success** (`src/registry.ts`). Per-model rot is
  documented, not imagined, and one pinned model is how we rode a free tier to
  a 25% success rate.
- **Three image fixes** found by running it: `bun add --global` installs into
  root's home (build passes, container cannot start); the kilo bin is a Node
  shim in an image with no Node; and `--auto` is required by BOTH engines but
  documented by neither.

## Unreleased - skills: agent-proof, and how to judge a run

- **New skill `agent-proof`** (`skills/agent-proof/`), for changes that touch
  agent execution, model calls, or the pass/fail decision. It holds what the
  dual-backend work taught the expensive way: the assertion contract and its
  order, the per-job relaxation that must not become a global one, the fixture
  that quietly becomes a passing lie, and the requirement that the layer
  *recording* a verdict actually reads it.
- **`references/traps.md`** is the part worth the read. Eight failures that each
  looked fine while happening: the agent that completed the task with no
  instructions, the correct verdict recorded as `ok: true`, a flag stripped
  because `--help` did not mention it, a global install that passed the build and
  broke the container, a Node shim in an image with no Node, and a live test on
  the runner's 5-second default that passed only by luck.
- **`scripts/probe-live.sh`** reports the three numbers a single successful call
  hides: answered, **truncated** (answered, but the stream lost its tail - these
  exit 0 and any exit-code check counts them as passes), and no-answer. Verified
  against a healthy model, a rate-limited one, and a missing binary.
- **`cod-system` 1.1.0** cross-references it, because the map is where someone
  lands first.

## Unreleased - an agent skill library, and typos you can see

- **Four new agent skills** under `skills/agent/`, injected into every job a
  worker is given:
  - `escalation` - what is the department's and what is the CEO's. Names the
    radius-2 paths and says what to do when the useful work is global: do the
    local part now, propose the global part with a reason.
  - `debugging` - reproduce, read the whole error, explain the cause in one
    sentence BEFORE changing anything. Calls out the trap that costs the most
    time: a change that makes the error disappear is a hypothesis.
  - `reviewing` - scope, correctness, tests, boundary, secrets. Says what not to
    do: do not rewrite it, do not approve because it is small.
  - `wrap-up` - run the thing, look at what actually changed, commit, never
    push. And report what you did NOT do.
- **`templates/skills/_TEMPLATE.md`** for authoring more, with the two rules that
  keep the bundle healthy: copy the directory rather than nesting (nested skills
  make lookup ambiguous, and ambiguity means an agent runs without its rules),
  and keep each under ~40 lines because it is injected on every job.
- **`cod skills`** lists the bundle and audits the workspace against it. This
  closes a real gap: a skill name that did not resolve used to be skipped
  silently, so a typo produced an agent running with NO rule and nothing on the
  surface saying why. For a company with nobody watching, a quietly missing rule
  looks exactly like compliance. Now the typo is named and attributed to the
  worker who named it.
- Engineering workers carry `git-discipline, testing, debugging, escalation,
  wrap-up`; CTO carries `escalation, reviewing, wrap-up`.

## Unreleased - the review verdict is recorded, and where landed work goes

- **A rejected item is reviewed ONCE, and the verdict survives a restart.** The
  bug was worse than "it just sits": `landWork` wrote no state on `rejected`, so
  the item stayed `done` and every tick re-reviewed it with a model, for ever -
  and both guards were module-level `Set`s that a restart emptied. Now one row
  per item in a `review` table, written through a single helper every return
  path goes through.
- **`cod work blocked`** - the queue that did not exist, oldest first, with the
  reviewer's own reason. **`cod status`** counts it, because a status line that
  only says "up" cannot say three items are waiting.
- **`buildWorkspaceSpec`** extracted out of `up()`. The mounts are the security
  boundary and an inline literal cannot be asserted on at all.
- **Opt-in `landing.repo`**, so reviewed work can reach a shared repository.
  Absent by default; the default mount list is asserted by name and by count,
  and the docker socket cannot be smuggled in through the new field.
- 547 tests, `verify.sh` PASS. All seven new guards mutation-verified.

## Unreleased - two open items closed, and the one only CI found

- **`cod work unblock <id> [why]`** - clears a terminal review so an item can be
  looked at again. Refused for a LANDED item, which is in master already.
  Deliberately manual.
- **`landing.repo` is validated at `cod up`**, before the container exists: a
  path that is missing, is not a repository, or has no `origin` is refused by
  name, each with its own fix. Checking it later meant checking it per merge.
- **The merge no longer depends on an ambient git identity.** Four `landWork`
  tests passed locally and failed on CI with `git merge failed`, because the
  container sets a global identity and the runner does not. Real, not a test
  artefact.
- 560 tests, `verify.sh` PASS with no global git identity.

## Unreleased - a rejection is a demand for a fix, and the fix gets worked on

- **A retried item is now BRIEFED with the reviewer's objection.** It never was:
  `landWork` wrote the words onto `work.reason` and nothing read it, so a retry
  re-ran the identical prompt.
- **`maxRetries` above 1 was inert** - `alreadyRetried` was a boolean. Now a
  durable integer, default 3, configurable via `governance.maxReviewRetries`.
- **Objections accumulate** across attempts instead of overwriting.
- **A mechanical finding is terminal at any cap**, before the model is asked.
- **`cod work unblock` archives rather than deletes** the verdict, so an
  unblocked item is no longer indistinguishable from a new one.
- 583 tests. Every new guard mutation-verified; two gaps found and closed.

## Unreleased - unblock can no longer quietly skip an outstanding objection

- **`cod work unblock` refuses an item that is MID-RETRY** and quotes the
  reviewer's outstanding objection. Found by Alex: the old behaviour let a
  person bypass the review loop without the objection ever being fixed.
- **`--override` records an `OPERATOR OVERRIDE`**, never a resolution, so the
  record cannot imply the reviewer changed their mind.
- 587 tests.
