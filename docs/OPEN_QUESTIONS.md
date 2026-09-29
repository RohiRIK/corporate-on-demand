# Open questions

All questions that were open are now closed. Each was decided deliberately on
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
  because cron re-fires it, so a missed tick costs nothing.
- **The novelty gate.** Self-proposed work enters as `proposed`; only the
  CEO's tick promotes it to `ready`. This is the anti-loop mechanism, and it is
  **real enforcement, not a prompt instruction** — the novelty key is a
  `UNIQUE` index, so a repeat proposal fails at the database rather than being
  asked not to happen.
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
- **`blast_radius` as a computed 0/1/2 column.** Blast radius is a *rule*
  (question 2), not a number: nothing can measure it yet, so storing an integer
  would invent precision the system cannot produce. The rule stays in prose
  until something can evaluate it.
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
2. **SQLite schema**, and `claim`/`commit` with fencing.
3. **`reconcile()`** on the existing 30s tick.
4. **The novelty key**, as a `UNIQUE` index.

### Two limits recorded honestly

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
