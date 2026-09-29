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
- **Direction**: Engineering **self-organises**. The CEO intervenes only on
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
them. `cod approve <id>` / `cod reject <id>` records a decision that the
supervisor then follows; `cod results` shows what ran.

**No Telegram gateway, and there never will be one.** That is settled, not
deferred. No bot, no push notification, no approval by message. A GUI was
discussed and explicitly declined. If one ever returns, the requirement is a
view of *the schedule and its results* — not an agent-activity dashboard.
`opencode web` is the latter and does not satisfy it.

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

## What comes next

Not infrastructure. The remaining work is the dispatch layer itself:
`src/task.ts` still runs `echoTask`, and the org above is a design that nothing
dispatches yet. That is the next seam, and it is deliberately the first place
the decisions above start paying for themselves.
