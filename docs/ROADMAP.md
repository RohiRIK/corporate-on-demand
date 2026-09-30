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

**Stage 2 — Agents that can act. DONE.**
An agent reads its instructions, uses real tools, writes files and commits them
on its own branch, inside a per-job worktree. Verified live: commit `43768f4`,
`answer.txt` containing `SEVEN`, on the Kilo engine, chosen by model id.

A run is judged by its **event stream**, not its exit code: a terminal
`step_finish`, a completed tool, no error events, and a prompt long enough to
be a real instruction. A failed agent is never recorded as `ok`.

Two engines (`opencode` and Kilo, a fork of it) with failover on consecutive
failure. Measured in the image: Kilo 10/10, opencode 3/5 on the same prompt.

**Stage 3 — The org in code. DONE.**
`cod cycle` — every department derives work from its standing purpose and
proposes it to the CEO, then the ledger reconciles. `cod meet` — every role
speaks with a position about its own work, the CEO decides, and each decision
becomes a ledger item. `cod work run` dispatches it.

Verified on a fresh `cod init`: 2 departments proposed, 2 decisions, and the
CEO's decisions landed as `ceo -> cto` and `ceo -> engineering`.

Two things about that meeting are deliberately unfinished, and are marked as
such in `src/meeting.ts` rather than glossed: **the positions are computed, not
spoken by a model**, so it decides real work from real state and is a first
version rather than a discussion.

**Stage 4 — Review and merge. NOT STARTED.**
Nothing reviews and nothing lands. Agents commit to their own branch and stop.

**Stage 5 — The company runs itself. NOT STARTED.**
No cron drives the cycle, so the loop still needs a human to type `cod cycle`.
The cycle, the meeting and the dispatch are all built and verified; what is
missing is a scheduled tick that runs them.

### The agent skill bundle

`skills/agent/` ships six skills, injected into a job's `AGENTS.md` by the
worker's `skills` list: `git-discipline`, `testing`, `debugging`, `escalation`,
`reviewing`, `wrap-up`. `cod skills` lists them and audits a workspace against
them, because a name that does not resolve is skipped silently - and a silently
missing rule looks exactly like compliance.

Adding one is a JSON-free operation: copy `templates/skills/_TEMPLATE.md` to
`skills/agent/<name>/SKILL.md`.

---

## Stage 2 — Agents that can act (was: not started)

Superseded above; kept because the reasoning still applies to Stage 4. Agents
that cannot act make coordination theatre, which is why Stage 3 was not
attempted before this.

Still true, and now the constraint on Stage 4: **a reviewer watching an agent
that cannot act reviews nothing.**

**Not blocked. Decided: agents act automatically, and the CEO manages them.**
There is no human gate anywhere in the chain and no autonomy question to ask
Rohi. Tool use, commits, dispatch and merges are the CEO's to grant, not a
human's. Rohi opens the computer and looks at what they did.

Done when: a scheduled job produces a committed change on its own branch, under
the CEO's authority, and the change is recoverable if it dies halfway.

**What follows from "the CEO does all of it":** the blast-radius rule stops being
a safety rail and becomes the main control on what an agent may touch. It is
therefore Stage 2's problem, not Stage 3's — an agent that can write code needs
the boundary in the same stage that gives it the ability, or Stage 2 ships an
unbounded actor for one release.

---

## Stage 3 — The org in code

The company is designed, documented, and has no code. The supervisor is the CEO
by design; the blast-radius rule, the reviewer, the one-retry policy and the
merge policy are all written down and all unimplemented.

The work ledger exists and **nothing self-proposes**: `propose()` has exactly one
caller, the CLI, typed by a human. The reconciler, the fencing, the anti-loop
gate — all real, all waiting for an agent to feed them.

### Departments have a standing purpose

A department is not a list of crons. It has a reason to exist, it works toward
it, and its output is judged against it — as the deleted v3.8.0 skill had, and
as `cod work` does not. Without this, self-proposed work has nothing to be
proposed *for*, and the novelty guard catches only identical repeats of work
that was never anchored to an aim in the first place.

### The company meets

Once or twice a day, depending on the job. **The meeting body is whoever
exists** — derived from the roles in the workspace, never a hardcoded cast, so a
department joins by existing rather than by a code change.

The current body is **CEO + CTO + Engineering**. All three are *working* roles
with a standing purpose; CTO is not a meeting-only attendee, it has work of its
own. CISO, CPO and CFO join later by existing, which is the whole point of
deriving the cast rather than hardcoding one.

**The deleted version was not a meeting.** It was a script that collected
activity, read grades, listed the pipeline and escalations, and wrote markdown
minutes; no agent spoke and nothing was decided. The old cross-department
"meetings" were a CEO writing directive files into inboxes with no reply path.

A real meeting is the moment each role states a position, the CEO decides, and
the decision becomes work. **The product of a meeting is a decision, not
minutes.** It is also the only place the self-grading problem gets solved: if
Engineering proposes and grades its own work, the meeting is where that is
pushed back on. A report has no such moment.

**Two known weak spots are closed here, not later:** the duplicate-work guard
catches only byte-identical repeats, and "needs the CEO" is self-asserted by the
very agent it constrains. Both are trust boundaries, and a trust boundary that
trusts its subject is not one.

Done when: the company runs a cycle with nobody watching, holds meetings that
end in decisions, and its work is traceable to who decided what.

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

Surviving reboots already work. What remains is the operational surface at scale:
retention, cost, and what happens over weeks rather than days.

**Most of the "see what they did" work moved earlier, to Stage 2, and that is
the main change this decision caused.** Rohi's only interface with the whole
system is opening the computer and looking at what the agents did. That makes
"what happened while I was asleep" the product surface, not a diagnostic — so a
readable, complete answer to it has to exist *before* agents can act, not after.
A system that acts autonomously and can only be understood by reading raw logs is
a system nobody will run.

**The honest limit to carry into every stage:** a slow agent and a stuck agent
look identical from outside, and an agent doing useless work looks exactly like
an agent working. No local signal separates them. The only real defence is
grading the outcome after the fact — Stage 4. Design around that limit rather
than pretending to measure past it.

Done when: a week of unattended running can be understood after the fact
without having watched it happen, at a glance rather than by reading logs.

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
