# Invariants

The rules that most changes should be measured against. Breaking one is how
this system goes from "contained" to "catastrophic".

## The three rules

1. **Never mount `/var/run/docker.sock` into this container.** No exceptions,
   not even for debugging. It is host root. The clean-room fails the run if any
   bind names it.
2. **Never add a credential to this workspace.** No model API key, no registry
   token, no `.env`. This is what keeps the worst case at "source code leaves
   the host". Every model is free and unauthenticated, so there is nothing to
   meter - and a `sk-…` appearing in the repo would hand a compromised agent a
   budget.
   - Redaction strips known credential *shapes* from anything the system writes.
     It is a safety net, not permission: a secret in prose or an unknown format
     still gets through, and `cod.json` is not rewritten.
3. **Never describe a prompt-level rule as a mitigation.** "Never read
   `/work/other`", "never exfiltrate" - these reduce accidents. They have zero
   value against a determined injection. If a control is not in the enforced
   table in `container.md`, it is a policy, and policies live in the prompt.

## Ledger invariants

- **THE LEDGER IS A CACHE. THE FILES ARE THE TRUTH.** Any change that treats the
  `work` table as authoritative is how a lost job becomes a lost job permanently.
- **Fencing is not an optimisation.** Every commit is
  `WHERE id=? AND lease_epoch=?`. An agent killed mid-call is a **zombie, not a
  corpse**: if the supervisor re-dispatches, the new run finishes and writes, and
  then the old process wakes and clobbers it. A stale epoch updates zero rows.
  **Git worktree isolation does not prevent this** — both runs share the ledger,
  not the source tree.
- **Consume the epoch.** `commit()` bumps it. Without that, two writers holding
  the same epoch both succeed and the last write wins.
- **Only the reconciler may promote a proposal.** Departments propose their own
  next work, so a proposal enters as `proposed` and the CEO's tick alone moves it
  to `ready`. A department cannot put itself on the run queue.
- **The duplicate gate is a `UNIQUE` index, not a prompt.** The novelty key is a
  sha256 of department + goal + sorted target paths, truncated to 32 hex chars.
  Enforcement at the database is the only kind that survives a determined agent.
- **The reconciler is idempotent.** Cron re-fires it regardless; running it
  twice must equal running it once.
- **The result file is written by `commit()` and nowhere else.** Its existence is
  the evidence the work finished. Written at propose time, it is evidence of
  nothing — and the reconciler, which reads it, completes claimed work on the
  next tick having run none. This shipped in `38b3683` and was found by review.
- **`blast_radius` is a policy hint, not a control.** The rule is enforced
  (radius 2 is refused whatever proposed it), but the number is agent-supplied.
  An agent can declare `0` for global work. Do not describe it as a guarantee.

## Structural invariants

- **One container per workspace.** The unit of isolation is the workspace, not
  the agent. Adding a second container per agent is a different architecture,
  not a configuration change.
- **One branch per git worktree.** Git refuses two worktrees on the same branch.
  This is the mechanism that makes concurrent job writes safe.
- **Never rewrite `cod.json`.** It is the operator's file, mounted read-only.
- **Truncation is always reported.** A bounded read that silently truncates is
  worse than an unbounded one, because it looks like the whole truth.
- **Every failure leaves a trace.** Results are written from a `finally`;
  prunes are logged; rejected cron jobs are named. Silence is the failure mode.

## The recurring lesson

Every serious bug in this repo's history was **invisible to the unit tests and
found by running a real container** or by a review of code the tests claimed to
cover:

- the timezone, off by three hours, reporting success;
- UID 1000 already taken, failing the image build;
- the supervisor wrapper being a shell script handed to `bun run`;
- a fresh workspace crash-looping because nothing held the event loop open;
- `sed` on the workspace file creating seven directories where three belonged;
- the ledger marking claimed work `done` without running any of it, because the
  reconciler read a file that `propose()` had written;
- the "real concurrency" test using `spawnSync` in a loop, so eight processes
  ran one after another and nothing was ever racing.

The ledger bugs are the sharper lesson: **the suite was green and the assertions
were wrong**, because the tests described the buggy behaviour. A green suite is
not evidence. Before claiming a change works, run the real thing and quote its
output:

```sh
sh scripts/cleanroom.sh /tmp/cod-verify   # empty dir -> a real agent working
```

**And mutate it.** An assertion proves the code does what you wrote. To prove
the test would notice if it stopped, break the code deliberately and count the
failures — measured on the current tree: removing the `lease_epoch` predicate
from `commit()` fails **18** tests, and making proposals born `ready` (bypassing
the CEO entirely) fails **12**.
