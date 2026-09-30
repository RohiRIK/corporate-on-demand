# Open questions

## Task execution — CLOSED: a scheduled job makes a real model call

A cron used to echo its task text back. It now resolves the worker, takes that
worker's own `model`, and runs `opencode run --pure --format json` inside the
container. The JSONL event stream is parsed for step-by-step progress and for the
answer, and the answer is what lands in the result file.

Verified end to end: a cron asked *"What is 17 plus 26?"* returned **`43`** in
4.65s at `cost 0`, credential-free.

**The verification detail matters more than the result.** The first check asked
the agent to *"reply with exactly: REAL_AGENT_OK"* and then searched the output
for that string — and the ECHO returns the task text verbatim, so it contained
the string and the check passed against a job that had done nothing. The task
must be one the echo cannot answer, or the check proves nothing.

What an agent may do is deliberately minimal, and each omission is a decision
rather than a gap: it returns text and is told it cannot change files. **No
`--auto`, no tool grant, no per-agent worktree, no merge, no retries.** Those
remain genuinely undecided. Review and merge policy are recorded above and are
unchanged by this.

Two facts about the runtime, both measured:

- `opencode run` **hangs on the host** (280s, no output) while the provider is
  reachable, so the driver spawns it inside the container where the supervisor
  already runs. The container deliberately has no docker binary and no socket.
- The driver uses `Bun.spawn`, not `node:child_process`. On this runtime
  `execFile` hangs to its own 40s timeout with empty output on the identical
  command, where `Bun.spawn` returns it in ~3.3s.

All questions below were open; each is now closed. Each was decided deliberately on
2026-09-29; the reasoning is kept here so a later change is a *revision* with a
reason, not an accident.

## 1. Model routing — CLOSED: per-worker model in `cod.json`

Each worker names its own model. No tiering, no escalation, and no global
default to fall back on.

The field already exists on the worker template, so this is mostly a decision
about who changes it: the config, not the code. Chosen over tier-by-role and
tier-by-difficulty because it can be changed later without a code change.

**The hazard is explicit:** a wrong value here is silently expensive. The
mitigation chosen is visibility, not a ceiling — see question 3.

## 2. Merge and review policy — CLOSED: the org approves, never a human

An agent finishes a task and has written files. What happens next is decided by
*authority*, not by a person.

- The **reviewer agent** checks three things and no more: **scope** (did it do
  what was asked and touch nothing else), **tests** (do they pass, no
  regressions), and **security** (no forbidden paths, no secrets written).
- On **rejection**: **one retry**, with the review as feedback. If that also
  fails, the task is reported and stops. It never loops on its own.
- On **approval**: merged by the **CEO (the supervisor)**, not by a human.

### The org

`cod` is a company of agents. **The supervisor IS the CEO** — one process, one
identity, holding executive authority. It is not a mechanism sitting above a
separate org.

- **Day one**: CEO, CTO, Engineering. CISO, CPO and CFO are deferred until CTO
  and Engineering are reliable — the recovered v3.8.0 list is in git history
  at `a549589` if they are wanted later.
- **Direction**: Engineering **self-organises** — it proposes its own next
  work. The CEO **consolidates and dispatches**, and intervenes only on
  escalation. The org chart is documentation first and control flow second.
- **Escalation is by blast radius**, and this is a *rule, not a judgement*: any
  change touching another department's area, or anything shared or global —
  schema, config, dependencies, the workspace file — goes to the CEO.
  Self-contained work stays with the department.

This is what makes the system autonomous: **there is no human in the loop at
any point.** Rohi approves nothing.

### The self-grading hazard, recorded

Departments propose their own next work, so an agent that can propose, approve
and grade itself has nobody checking it. The brake is structural rather than
advisory: the blast-radius rule (a department cannot widen its own remit) and
the reviewer (which is not the author) are the two places that limit this. Any
future change that lets an agent approve its own work removes both.

## 3. Budget ceilings — CLOSED: none, deliberately

No spend limits. Every model is free and unauthenticated, so there is nothing
to meter and a ceiling that never fires is theatre.

This becomes a real question **the moment a paid model enters the picture**.
See the credential rule in `docs/SECURITY_POSTURE.md` — that change needs a
decision, not a patch. Per-worker models (question 1) make that moment easier
to reach, which is the accepted trade for never paying for a model nobody
needed.

## 4. Cron result visibility — CLOSED: disk and CLI only

Reviews and results are written to disk. The supervisor confirms and acts on
them. Today that means two commands: `cod logs` for the event stream and
`cod results` for one persisted file per run. There is nothing else, and there
is deliberately no decision to record by hand.

**No Telegram gateway, and there never will be one.** That is settled, not
deferred. No bot, no push notification, no approval by message. A GUI was
discussed and explicitly declined. If one ever returns, the requirement is a
view of *the schedule and its results* — not an agent-activity dashboard.
`opencode web` is the latter and does not satisfy it.

*There is no `cod approve` / `cod reject`.* An earlier draft of this document
claimed both, describing a human decision that the rest of the design does not
permit. What exists is `cod logs` and `cod results`; the decision-maker is the
CEO, in process, per question 2.

## 5. Agent-to-agent communication — CLOSED: files are truth, SQLite WAL is the index

Full write-up: `docs/AGENT_COMMUNICATION.md`. Chosen after Leo's research; the
ranking was files+SQLite, then pure filesystem mailboxes, then a broker.

- **Truth layer** — every unit of work is a file, written
  `tmp → fsync(file) → rename() → fsync(dir)`, so a reader never sees a
  half-written message.
- **Coordination layer** — one SQLite file in WAL mode on the existing volume.
  Claim is a single `UPDATE … RETURNING`; SQLite's write lock gives real mutual
  exclusion with no broker and no second daemon.

**The invariant**: the ledger is a cache, the files are the truth.

**Fencing is mandatory, not an optimisation.** An agent killed mid-call is a
zombie, not a corpse: if it wakes after a re-dispatch it will clobber the newer
result. Every commit is `WHERE id=? AND lease_epoch=?`, so a stale epoch updates
zero rows. Git worktree isolation does *not* prevent this — both runs share the
ledger, not the source tree.

**Do not claim exactly-once messaging.** It is a property of a storage engine's
transaction log, not of a bus, and it evaporates once the effect leaves the log
into an LLM call and a worktree. At-least-once delivery plus a durable dedupe
key, an idempotent commit and a fencing token is the real target.

## 6. Supervision design — CLOSED

The research that produced questions 1–5 also proposed a supervision design
larger than this system needs. It was audited against the code and cut down.
What survives, and what does not, recorded here so the next change is a
deliberate one.

### Kept

- **The polling reconciler.** Level-triggered, Kubernetes-style: on each tick,
  compare desired state against actual state and converge. It is idempotent
  because cron re-fires it, so a missed tick costs nothing. **Landed** in
  `src/reconcile.ts`; it rides the existing 30s supervisor tick and is wrapped so
  a ledger failure cannot take down every cron.
- **The novelty gate.** Self-proposed work enters as `proposed`; only the
  reconciler's tick promotes it to `ready`. This is the anti-loop mechanism, and
  it is **real enforcement, not a prompt instruction** — the novelty key is a
  `UNIQUE` index, so a repeat proposal fails at the database rather than being
  asked not to happen. **Landed.**
- **Fencing** (question 5).
- **Two-stage escalation**, on a per-task Start-To-Close budget: at **1x**
  write `interrupt_requested`, which the dispatcher polls at its next step
  boundary; at **2x** bump `lease_epoch` so the next write is fenced out. Never
  kill a job on a heuristic.

### Cut, deliberately

- **The 9-state machine** — cut to `proposed` / `ready` / `running` / `done` /
  `failed`, plus an attempts counter and `rejected`. The extra states encoded
  transitions this system has no mechanism to trigger.
- **A `priority` column** — nothing in the system can compute a priority that
  means anything. A column that is always a constant is a lie in a schema.
- **`blast_radius` as a *computed* 0/1/2 column.** The rule is real (question 2)
  but nothing can *measure* a radius, so a computed integer would invent
  precision the system cannot produce. **Revised, not simply cut:** the column
  exists, and it is **supplied by the proposing agent** — `--blast 0|1|2`, or
  NULL. A non-integer is refused rather than silently stored as NULL, which
  would have passed every comparison and dispatched global work without the CEO.
  See the honest limit below.
- **`tokens_used`** — dead instrumentation. Budget ceilings were closed in
  question 3 because every model is free, so there is nothing to count toward.
- **`state_digest = hash(workspace files)`** — an expensive proxy for a signal
  the dispatcher already emits directly, and free, at every step.

### Do not rebuild what exists

`inflight.ts`, `liveness.ts`, `results.ts`, `worktree.ts` and `log.ts` already
cover more of the proposed design than the research assumed. The research was
written against a system with no crash recovery, no in-flight tracking and no
durable results; this one has had all three since `ea7fa48`.

### Build order, fixed

Non-negotiable, because each step is the precondition for the next and the
order is what keeps the anti-loop mechanism real:

1. **The dispatcher**, with a per-step callback. **Done** — `src/dispatch.ts`,
   on the live path.
2. **SQLite schema**, and `claim`/`commit` with fencing. **Done** —
   `src/work.ts`.
3. **`reconcile()`** on the existing 30s tick. **Done** — `src/reconcile.ts`,
   called from the supervisor's `setInterval` in `src/supervisor.ts`.
4. **The novelty key**, as a `UNIQUE` index. **Done** —
   `CREATE UNIQUE INDEX ux_work_novelty` on `work(novelty_key)`.

The order is what kept the anti-loop mechanism real: a proposal that is not
already non-runnable is not a gate, it is a field.

### What landed, and what the reviews then found

The four steps above landed in `38b3683`. An independent review of that commit
found three live corruption bugs, all fixed in `ba1d316` — recorded here because
the fixes change the design, not just the code:

- **Claimed work was marked done without running.** `propose()` wrote the result
  file and the reconciler used bare `existsSync()` as proof the work had been
  paid for, so the file existed before any work happened and the first tick
  after any claim completed the item. **The result file is now written by
  `commit()` and nowhere else**, so its existence means something, and the
  reconciler *parses* it and trusts it only when it records a finished state.
- **A reclaim did not fence the worker it reclaimed.** The budget rule set
  `state='failed'` but left the epoch alone, so the overrunning worker — never
  killed, only declared — overwrote the verdict with its own success.
- **An epoch was never consumed.** `lease_epoch` was only ever bumped by `claim`,
  so a second writer holding the same epoch overwrote the first. It is last
  write wins for anyone holding the current epoch.

Two of these are *the same class of defect as the misnamed tests*: the suite was
green and the assertions were wrong, because the tests described the buggy
behaviour. Two old tests asserted the buggy behaviour and were corrected rather
than deleted.

### Four limits recorded honestly

- **`blast_radius` is a policy hint, not an unspoofable control.** The
  reconciler enforces the rule correctly — radius 2 is refused whatever proposed
  it, via the pure predicate `needsCeo` — but the *input* is agent-supplied. An
  agent that declares `0` for global work is not caught. The refusal is only as
  strong as the value the proposer chose, and that is the honest ceiling on
  question 2's "a rule, not a judgement": the rule is enforced, the number is
  not earned.
- **The novelty key catches byte-identical repeats only.** "Do the same thing
  twice" is detected when department, goal and target paths hash the same. A
  department that rewords its goal produces a different key and is let through.
  Reworded goals are normal LLM output, not an edge case. Semantic dedupe is a
  different problem and is not solved here.
- **Slow-but-fine is indistinguishable from stuck.** No local signal separates
  them: a job making progress on a long model call looks exactly like a job
  hung on one. The mitigation is a **per-task Start-To-Close budget**, never a
  global threshold — a global one fires on whichever healthy job happens to be
  longest, which is the definition of a heuristic.
- **Busywork detection is undecidable from telemetry.** Whether a step advanced
  the goal is a question about meaning, and no counter answers it. So the
  defence is to **grade the outcome at the reviewer gate** (question 2), not to
  ship a semantic-progress scorer that measures nothing and looks like it
  measures something.

## Closed: the blast radius is now DERIVED, not self-asserted (2026-09-30)

`blast_radius` was an integer the PROPOSING AGENT filled in. That means the rule
constrained the thing it was supposed to constrain: an agent wanting to ship a
global change simply wrote `0` and was believed.

It is now derived from the TARGET PATHS. `--blast` may narrow, never widen -
and it cannot narrow *past* global either, which is the subtle half: `min(derived,
proposed)` looked safe and was not, because an agent writing `0` for work naming
`src/workspace.ts` got exactly the authority it asked for. Global is a ceiling
only the CEO can lift.

Verified live: a department proposed a schema change naming `src/workspace.ts`
while declaring `--blast 0`. The reconciler rejected it without the agent ever
running.

## Closed: the CEO can dispatch, and the work happens in the container

`cod work run <id>` hands the job to the container, because the ledger and the
`/work` volume are the container's and the host has neither - a host-side
dispatch failed with "no git repository at /work", which is true and useless.
The container has no Docker binary and no socket by design, so the seam runs
the other way: `docker.execIn` on the host, `src/run-work-cli.ts` inside.

Verified live end to end: the CEO dispatched a self-contained item, a real
credential-free model wrote `answer.txt`, and committed it as `3e63ab6` on
branch `cod/w-munreomi-b7661c`. The worktree was released; the commit stayed.

## Closed: the dispatched agent did not read its instructions (2026-09-30)

A ledger item is addressed to a DEPARTMENT - "engineering". `run-work-cli.ts`
resolved the worker with

    departments.flatMap(d => d.workers).find(w => w.name === item.to_agent)

which asks for a WORKER named "engineering", while the worker is called
"builder". It therefore always returned `undefined`, the
`if (worker && department)` guard skipped `writeInstructions` entirely, and a
real model went to work with no purpose, no rules and no blast radius.

It survived because THE JOB SUCCEEDED. The agent was competent enough to create
the file without being told it could, so the output looked right and the
missing prompt was invisible. That is the same trap as a check that greps a
self-report: the work passing is not evidence the work was directed.

`src/assign.ts` now bridges department to worker, and:
- an addressee that resolves to NOTHING is a refusal (exit 3), never a
  "run it anyway" - running with no instructions is the worst default there is;
- the instruction write is unconditional and its path is `existsSync`-checked,
  so a file that is not written is a hard failure rather than a silent skip;
- the hand-off is printed, because a department choosing its own worker is the
  system being autonomous, and autonomy you cannot audit is merely unlogged.

Proven live with a real credential-free model: the dispatched agent opened
AGENTS.md and quoted the rule verbatim - "Do not push, merge, or force-push. You
have no authority to land anything." - a line that exists only in the file.

## Closed: provider flakiness and silent failure (2026-09-30)

The single free model we were pinned to failed roughly 3 calls in 4, exiting 1
with empty stderr - `agent exited 1: no detail` - which could not be told apart
from our own bug, a timeout, or a provider outage.

**Measured, inside the real image, as user 1000:1000, credential-free, cost 0:**

| engine | model | result |
|---|---|---|
| opencode | `opencode/space-bunny-free` | 3/5 |
| kilo | `kilo/kilo-auto/free` | 5/5 |
| kilo | `kilo/stepfun/step-3.7-flash:free` | 5/5 |

An earlier afternoon measured opencode at ~25% and kilo at 12/12. The opencode
number MOVES: the provider recovers, and the pinned single model is the actual
problem. Treat both figures as one sample on one prompt, not a benchmark.

**What changed:**

1. **A run is judged by its stream, not its exit code** (`src/assert.ts`). A run
   passes only with a terminal `step_finish`, at least one completed tool, no
   error events, and a prompt long enough to be a real instruction. Mutation-
   verified: removing any one of the five rules breaks the suite.
2. **A second engine** (`@kilocode/cli`, MIT, pinned 7.8.1). It is an opencode
   FORK, so this diversifies the model pool but not the failure modes - which
   is the honest reason to run both rather than to replace.
3. **Rotation by measured success** (`src/registry.ts`), because per-model rot
   is documented rather than imagined: muse-spark 500s, `mimo-v2.5-free`
   rate-limited, `deepseek-v4-flash-free` retired upstream.
4. **A failed agent is no longer recorded as `ok`.** The assertion's verdict was
   in the job output the whole time and nothing read it, so a run that had just
   reported a provider outage was displayed as a success. Found by reading the
   raw result record instead of the pretty line.

## Closed: a read-only job has no tool call (2026-09-30)

`expectTools: false` on a cron, defaulting to **true**. Per job, deliberately:
a global relaxation is how the wrong-reason class comes back, because then every
job may claim work it did not do. The default matters more than the flag.

It is a narrower pass, not a bypass - a read-only job must still finish cleanly,
report no errors, and have been given a real prompt. Proven live: three
consecutive read-only jobs on the Kilo engine, all `ok`, none using a tool or
touching a commit.

## Answered by measurement: the truncation bug did not reproduce (2026-09-30)

20 calls in the image, 10 per engine, watching for the exact signature - it
answered but the stream has no terminal `step_finish`:

| engine | answered | truncated | provider failure |
|---|---|---|---|
| `kilo/kilo-auto/free` | 10/10 | **0** | 0 |
| `opencode/space-bunny-free` | 8/10 | **0** | 2 |

So it did not reproduce on either engine, in this sample. That is **not** proof
it is fixed: the report is under container latency on LONGER AGENTIC runs, and
20 short arithmetic calls are not that. The assertion keeps its truncation rule
regardless - it is cheap and the bug is documented - and the honest conclusion
is "not observed", not "not present".

What remains true either way: two engines give a health SIGNAL, not
independence, because Kilo is a fork. That is stated rather than implied away.

## Closed: the `ref` id is now joined to the log (2026-09-30)

`ref=err_...` is the join key between the JSONL error event and the engine's own
log, and the failure line now carries the resolved entry.

Two measured facts made the first version useless, and both were found by
looking inside the image rather than by reasoning:

- **The engines use different log directories.** opencode writes under
  `~/.local/share/opencode/log`, Kilo under `~/.local/share/kilo/log`, because
  Kilo is a fork that renamed the data directory. Searching only opencode's
  meant every Kilo failure silently found nothing - which is indistinguishable
  from there being nothing to find.
- Kilo's combined log file is literally named `opencode.log`.

Bounded to one line, never throws, and says "no log entry found" rather than
staying silent. Silence is the bug this replaces.
