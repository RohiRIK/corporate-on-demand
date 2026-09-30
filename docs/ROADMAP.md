# Roadmap

The order of the big stages, and why each one comes after the one before it.
Deliberately high level: no tasks, no files, no commands. This is the shape, not
the plan. Each stage gets its own plan when it is reached.

**The criterion for "done" is always the same:** the thing works unattended, on a
real machine, with no human present. Anything less is infrastructure pretending
to be a product.

---

## Where we are

**Stage 0 — Trustworthy infrastructure. DONE.**
Crash-safe job tracking, crash-visible logs, persisted results, bounded
concurrency, the clean-room gate, and the six unattended-operation gaps closed
(working timezone, supervisor restart, result retention, CI, log redaction,
supervisor as PID 1).

**Stage 1 — Real model calls. DONE.**
A scheduled job makes a genuine credential-free model call and returns its
answer. Verified: a cron answered an arithmetic question the echo could not.

Everything below this line is unbuilt.

---

## Stage 2 — Agents that can act

**Today an agent returns text and is told it cannot change files.** No tools, no
worktree, no commits. It is a company of people who can only talk.

This is the stage that makes the rest worth doing. Everything after it is
coordination, and coordination over agents that cannot act is theatre.

The isolation machinery already exists and is tested — per-job git worktrees,
branch-per-job, a durable work volume. It is built and unused. This stage wires
an agent to it.

**This stage is blocked on one decision from Rohi: how much autonomy an agent
gets.** Tool use is currently withheld deliberately, because no decision has
been made about what an agent may touch. That decision is the stage.

Done when: a scheduled job produces a committed change on its own branch, and
the change is recoverable if it dies halfway.

---

## Stage 3 — The org in code

The company is designed, documented, and has no code. The supervisor is the CEO
by design; the blast-radius rule, the reviewer, the one-retry policy and the
merge policy are all written down and all unimplemented.

The work ledger exists and **nothing self-proposes**: `propose()` has exactly one
caller, the CLI, typed by a human. The reconciler, the fencing, the anti-loop
gate — all real, all waiting for an agent to feed them.

This stage makes departments propose their own work, the CEO consolidate and
dispatch, and blast radius actually route. It is the stage where the thing
becomes a company rather than a scheduler with agents attached.

**Two known weak spots are closed here, not later:** the duplicate-work guard
catches only byte-identical repeats, and "needs the CEO" is self-asserted by the
very agent it constrains. Both are trust boundaries, and a trust boundary that
trusts its subject is not one.

Done when: the company runs a cycle with nobody watching, and its work is
traceable to who decided what.

---

## Stage 4 — Review and merge

An agent finishes work. Something has to check it and something has to land it.

The policy is decided and not built: a reviewer checks scope, tests and
security — and nothing more; one retry with the review as feedback; the CEO
merges. Blast radius decides who is allowed to land it.

This is deliberately **after** Stage 3, not before. A reviewer watching an agent
that cannot act reviews nothing, and a merge policy over a company that does not
propose its own work has nothing to merge.

Done when: work reaches a shared branch having passed an independent check, and
a rejected attempt is retried once rather than argued about.

---

## Stage 5 — Many departments, running at once

One department, one workspace, proven. The scaling questions are real and
untested: bounded work per department so a noisy one cannot starve a quiet one,
ledger growth with no cap, and what happens when several workspaces share a host.

The container-name collision just fixed is the first bug this stage will produce
if it is not planned for. Per-department fairness and a ledger that does not grow
without bound belong here.

Done when: several departments run concurrently for weeks unattended without one
consuming the machine or starving the others.

---

## Stage 6 — Operating it for real

The difference between software that works and software that is used. Surviving
reboots already work; what is missing is the operational surface: knowing what
happened while nobody was watching, and knowing it cheaply.

**The honest limit to carry into this stage:** a slow agent and a stuck agent
look identical from outside, and an agent doing useless work looks exactly like
an agent working. No local signal separates them. The only real defence is
grading the outcome after the fact — which is Stage 4, not this one. Design
around that limit rather than pretending to measure past it.

Done when: a week of unattended running can be understood after the fact
without having watched it happen.

---

## What is deliberately not on this roadmap

Each of these is a decision nobody has made, and guessing at any of them would
optimise the wrong thing:

- **Paid models.** Every model is free and unauthenticated, so there is nothing
  to meter and a budget ceiling that never fires is theatre.
- **A GUI or a Telegram gateway.** Disk and CLI only. Settled, not deferred.
- **A second runtime.** One container, one workspace, credential-free. The
  security property is the absence of a credential, and adding a runtime adds
  places for one to hide.
- **More than CEO + CTO + Engineering.** The full C-suite is in git history if it
  is ever wanted. Three roles prove the shape; sixteen prove nothing faster.
