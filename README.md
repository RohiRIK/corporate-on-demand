<div align="center">

```
 ██████╗  ██████╗ ██████╗
██╔════╝ ██╔═══██╗██╔══██╗
██║       ██║   ██║██████╔╝
██║       ██║   ██║██╔══██╗
╚██████╗  ╚██████╔╝██║  ██║
 ╚═════╝   ╚═════╝ ╚═╝  ╚═╝
```

**A credential-free container workspace for scheduled AI agents**

One container per workspace. On-device cron. No API key.

[![Bun](https://img.shields.io/badge/bun-1.3.12-white?style=flat-square&logo=bun)](https://bun.sh)
[![opencode](https://img.shields.io/badge/opencode-1.18.31-blue?style=flat-square)](https://github.com/sst/opencode)
[![Tests](https://img.shields.io/badge/tests-293%20passing-brightgreen?style=flat-square)]()
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)]()

</div>

---

## What this is

`cod` takes a directory from empty to a scheduled AI agent, with no credentials
anywhere in the picture.

```sh
git clone https://github.com/RohiRIK/corporate-on-demand.git
cd corporate-on-demand
bun install
sh scripts/vendor-opencode.sh    # REQUIRED before verify.sh - see below

./src/index.ts init acme --yes    # write cod.json
```

`scripts/vendor-opencode.sh` is a required setup step, not an optional extra. It
fetches the 177 MB agent binary, which is deliberately **not** committed; CI runs
it in a step of the same name before verifying. Skipping it makes `verify.sh` and
the image tests fail, and both now say so by name.

```
./src/index.ts status             # confirm the schedule is live
```

That is the whole path. **No API key, no login, no configuration.** The model is
free and opencode runs unauthenticated — which is not just convenient, it is the
main security property: there is no credential for a compromised agent to spend,
exfiltrate, or use against a metered endpoint.

## Why one container for all agents

Isolation is per **workspace**, not per agent. Every worker shares one container,
one filesystem, one uid, and one network namespace.

That is a deliberate trade. Running a container per agent costs real startup time
and real memory, and gives you isolation you did not ask for. The cost is that
agents can see each other's files — see [invariants](skills/cod-system/references/invariants.md)
for what that does and does not mean, and for the worktree design that fixes it.

## The dispatch seam

A scheduled job does not echo its way through the supervisor any more. It goes
through `src/dispatch.ts`:

```ts
driver(cron, step)          // step(kind, label) is a BOUNDARY
dispatch(cron, driver, { onStep, shouldStop })
```

`step` is a boundary, not a progress ping: it checks for a stop request *before*
the next chunk of work begins, then records that the previous step finished. So
`shouldStop` is polled only between steps and never during one — a step is a
model call or a subprocess, and there is no honest way to interrupt one from
outside.

Two properties are the reason this is not a loop with a callback bolted on:

- **Step numbers are assigned by the harness, not the driver.** A driver cannot
  lie about how far it got. `step_no` is a fact about the loop, not a
  self-report, which is the whole basis of stall detection.
- **A failing `onStep` cannot fail the job.** A supervisor that dies because
  logging threw is worse than one that loses a progress line. Losses are
  counted and surfaced in the result as "N progress report(s) lost" rather than
  swallowed silently.

### What a job actually does

**A scheduled job makes a real model call.** The supervisor resolves the cron to
its worker, takes that worker's own `model` from the workspace, and runs it
through `opencode run --pure --format json` inside the container. The JSONL event
stream is parsed for progress and for the answer, and the answer is what lands in
the result file.

```ts
// src/agent.ts - the real thing
opencode run --pure --format json -m opencode/space-bunny-free --title cod-nightly "<prompt>"
```

Verified end to end: a cron asked *"What is 17 plus 26?"* returned **`43`** in
4.65s at `cost 0`. A task the echo cannot answer is the only honest proof, so
that is the check — see the note in `CHANGELOG.md` about a verification that
passed against a job that had done nothing.

What an agent may do is deliberately **minimal**: it returns text, and it is
told it cannot change files. No `--auto`, no tool grant, no worktree per agent,
no merge. Those are open decisions, not omissions.

Two facts worth knowing if you run this yourself:

- `opencode run` **hangs on the host** — measured 280s with no output — so the
  driver spawns it inside the container, which is where the supervisor already
  runs. The container deliberately has no docker binary and no socket.
- The driver uses `Bun.spawn`, not `node:child_process`. On this runtime
  `execFile` hangs to its own timeout on the identical command, while
  `Bun.spawn` returns it in ~3.3s.

`echoDriver` remains as the deterministic reference implementation and is the
fallback when a workspace names no worker; `echoTask` in `src/task.ts` is off
the live path entirely. `TaskResult` remains the result contract between the
supervisor and the work.

## The work ledger

`src/work.ts`. Two layers, deliberately separated.

**The files are the truth.** A human reads them with `jq`, and they survive
total loss of the database. **The SQLite table is a cache over them** — an index
that makes claim and commit atomic and that can be rebuilt from the files.

> **THE LEDGER IS A CACHE. THE FILES ARE THE TRUTH.**
> Anything that treats the table as authoritative is how a lost job becomes a
> lost job permanently.

**Claiming** is a single statement:

```sql
UPDATE work SET state='running', lease_owner=?, lease_epoch=lease_epoch+1, ...
 WHERE id=(SELECT id FROM work WHERE state='ready' ORDER BY created_seq LIMIT 1)
 RETURNING *
```

SQLite's write lock makes exactly one concurrent caller win. Verified on this
runtime: **eight separate processes raced for one pending item and exactly one
claimed it.** The test spawns them concurrently rather than in a loop — an
earlier version used `spawnSync` in a loop, so the eight ran one after another
and nothing was ever racing.

**Processes, not promises.** The mechanism under test is the write lock, and an
in-process test cannot exercise it. Eight in-process promises would pass against
a ledger with no mutual exclusion at all.

**Fencing is not optional.** Every commit is:

```sql
UPDATE work SET state=?, reason=?, lease_owner=NULL, lease_epoch=lease_epoch+1
 WHERE id=? AND lease_epoch=? RETURNING *
```

An agent killed mid-call is a **zombie, not a corpse**. If the supervisor
re-dispatches, the new run finishes and writes — and then the old process wakes
and clobbers it. A stale epoch updates zero rows and the commit is refused.

**Git worktree isolation does not prevent this.** Both runs share the *ledger*,
not the source tree.

The epoch is also **consumed** by the commit that uses it, which is load-bearing
twice: a second writer holding the same epoch (a retried ack, a double signal)
now matches zero rows instead of overwriting, and a budget reclaim fences the
worker it reclaimed.

**Durability.** Every file is written `tmp → fsync(file) → rename() →
fsync(dir)`, so a reader never sees a half-written message. **WAL is legitimate**
because SQLite requires every process on one host and refuses network
filesystems — which is exactly the shape this system already has.

## The reconciler

`src/reconcile.ts`. The CEO's loop, and it is **level-triggered**: the idea
transfers from a Kubernetes controller. It does not wait to be told what changed.
Every tick it re-reads current state and converges on desired state, so an event
missed while the process was down self-heals on the next tick instead of being
lost for ever.

The consequence, and the reason it is a function over rows rather than a
callback: **anything edge-triggered would be decoration.** A "worker finished"
hook would add nothing the loop does not already re-derive.

It must therefore be **idempotent**, because cron re-fires it whether or not the
last tick did anything — running it twice must equal running it once.

It rides the **existing 30s supervisor tick** rather than adding a timer, and it
is wrapped so a ledger failure cannot take down every cron in the workspace.

Four jobs per pass:

1. **Promote or reject proposals.** Only the reconciler may make a proposal
   runnable.
2. **Reclaim work past its budget.** Per item, never global: one global
   threshold either kills legitimate slow work or tolerates a hung job, and
   usually does both.
3. **Recover work whose acknowledgement was lost.** It **reads the durable
   file**, and never re-runs the job. The case is "work was paid for, the ack
   was lost" — re-running would double-execute and double-bill a job that
   already finished.
4. **Report**, and do nothing else.

## The anti-loop gate

Departments propose their own next work, so a proposal enters as `proposed` and
**only the reconciler may promote it to `ready`**. A department cannot put
itself on the run queue.

Duplicate proposals are refused by a `UNIQUE` index on `novelty_key` — a sha256
of department + goal + sorted target paths, truncated to 32 hex chars. This is
**real enforcement, not a prompt asking an agent to notice**, and it is the
brake on self-graded work.

Blast radius is a **rule, not a judgement**. Radius 2 is global and is refused
by the reconciler whatever proposed it; radius 1 is cross-department and stays
runnable. The predicate is a separate pure function (`needsCeo`) so the policy
is testable and cannot drift.

**`blast_radius` is currently supplied by the agent, so this is a policy hint,
not an unspoofable control.** An agent can submit `0` for global work, and the
reconciler's refusal is only as strong as that input.

## The CLI surface

All of this is reachable from the command line, which is a hard project
requirement. Flags below are as implemented in `src/index.ts` and `src/meta.ts`.

```sh
cod work list [--state <s>] [--json]
cod work propose --from <agent> --to <agent> --goal <text> \
                 [--payload <t>] [--paths a,b] [--blast 0|1|2] [--kind <k>]
cod work claim [--owner <name>] [--to <agent>]
cod work commit <id> --epoch <n> [--reason <text>] [--failed]
cod reconcile
```

The work-item id is a **positional argument**, not `--id`. It was a flag
advertised in `--help` and wired to nothing, and it was removed rather than left
as a trap one commit away from being live.

**One caveat, stated rather than hidden:** `--state` is *also* the global
state-directory flag, so `cod work list --state ready` cannot filter by state —
`ready` is taken as the state directory. The examples below therefore set
`COD_STATE_DIR` and pass no `--state`. See the changelog for the full defect.

### The lifecycle, worked

Every line below is real output from this repository, not an illustration.

```console
$ cod work propose --from engineering --to engineering \
      --goal "add a healthcheck to the compose file" \
      --paths docker/compose.yml --blast 1
proposed w-mun3fld6-256770 (state proposed; it is NOT runnable until the CEO reconciles it)

$ cod work propose --from engineering --to engineering \
      --goal "add a healthcheck to the compose file" \
      --paths docker/compose.yml --blast 1
refused: already proposed as w-mun3fld6-256770 (state proposed); re-proposing identical work is refused

$ cod work list
w-mun3fld6-256770  proposed  engineering -> engineering  epoch=0 attempts=0  blast=1

$ cod work claim --owner worker-a
nothing to claim

$ cod reconcile
promoted w-mun3fld6-256770 to ready

$ cod work claim --owner worker-a
claimed w-mun3fld6-256770 as worker-a (lease_epoch 1, attempt 1)

$ cod work commit w-mun3fld6-256770 --epoch 0 --reason "the zombie result"
commit REFUSED: fenced: lease_epoch 0 is stale (current 1); a newer run owns this item

$ cod work commit w-mun3fld6-256770 --epoch 1 --reason "the real result"
committed w-mun3fld6-256770 as done

$ cod work list
w-mun3fld6-256770  done  engineering -> engineering  epoch=2 attempts=1  blast=1  (the real result)
```

The proposal is **unclaimable until `cod reconcile` runs**, the duplicate is
refused at the database rather than asked not to happen, the stale-epoch commit
is fenced, and the good one is accepted. Note `epoch=2` after a commit at epoch
1: the epoch was consumed.

Global work is refused by the rule, whatever proposed it:

```console
$ cod work propose --from engineering --to engineering --goal "change the schema" --blast 2
proposed w-mun3mb6l-a276f9 (state proposed; it is NOT runnable until the CEO reconciles it)

$ cod reconcile
rejected w-mun3mb6l-a276f9

$ cod work list
w-mun3mb6l-a276f9  failed  engineering -> engineering  epoch=1 attempts=0  blast=2  (blast radius is global; the CEO must dispatch this itself)
```

## Deliberately not built

These are decisions, not omissions.

- **The 9-state machine**, cut to `proposed` / `ready` / `running` / `done` /
  `failed` plus an `attempts` counter. `claimed`, `review`, `merged` and
  `abandoned` are states for a pipeline and a reviewer that do not exist.
- **A `priority` column.** Nothing in the system can compute a priority that
  means anything. A column that is always a constant is a lie in a schema.
- **`tokens_used`.** Budget ceilings were closed because every model is free, so
  a token counter is dead instrumentation.
- **A computed `state_digest`.** An expensive proxy for a signal the dispatcher
  emits directly, and free, at each step.

## Commands

| | |
|---|---|
| `cod init <name>` | onboarding; writes a secret-free `cod.json` |
| `cod up` / `down` | start / stop the workspace container (`down` is idempotent) |
| `cod status` | container state **and** schedule state, separately |
| `cod supervise` | run the in-container scheduler by hand |
| `cod logs` | the event log — the answer to "what happened" |
| `cod results` | persisted job results — what ran, and did it work |
| `cod image` | build the workspace image |
| `cod doctor` | host checks, with the fix for anything missing |
| `cod purge` | remove the work volume and every commit in it (`--purge` confirms) |
| `cod work` | the work ledger: `list`, `propose`, `claim`, `commit` |
| `cod reconcile` | one pass of the CEO's loop; also runs on the supervisor's 30s tick |
| `cod config show` | resolved configuration and where each value came from |

Exit codes: `0` success, `1` retryable runtime failure, `2` deterministic usage
or configuration error.

## What is actually verified

Not claimed — measured, and re-checked by `scripts/cleanroom.sh` on every run:

- one container per workspace, starting in **~0.4s** once the image exists
- a cron job firing on a real minute boundary, inside a real container
- an agent producing real output, at **zero cost**, with no credential on disk
- 11 security controls read back off a live container via `docker inspect`
- **293 tests**, clean strict typecheck

The ledger and the reconciler are verified by **mutation, not only by assertion**.
An assertion proves the code does what you wrote; a mutation proves the test
would notice if it stopped. Measured on this tree:

| Mutation | Result |
|---|---|
| Remove the `lease_epoch` predicate from `commit()` | **18 tests fail** |
| Make proposals born `ready`, bypassing the CEO entirely | **12 tests fail** |

A test that passes against broken code is worth nothing.

One more, from the same pass: the "eight concurrent processes" test used
`spawnSync` in a loop, so the processes ran one after another and nothing was
ever racing. The property was real; the test was not proving it.

## Documentation

The system explains itself in [`skills/cod-system/`](skills/cod-system/SKILL.md) —
for anyone changing it, not just running it. It includes the gotchas this
codebase learned the hard way, so the next person meets them as warnings rather
than as bugs.

| | |
|---|---|
| [architecture](skills/cod-system/references/architecture.md) | how the pieces fit, and why the seams are where they are |
| [onboarding](skills/cod-system/references/onboarding.md) | creating and configuring a workspace |
| [container](skills/cod-system/references/container.md) | what is enforced, what is not |
| [scheduling](skills/cod-system/references/scheduling.md) | cron, concurrency, and the syntax that bites |
| [recovery](skills/cod-system/references/recovery.md) | what happens when the supervisor dies |
| [invariants](skills/cod-system/references/invariants.md) | the rules most changes are measured against |

## Running on boot

Docker's `--restart on-failure:5` survives a **daemon** restart, not a **host**
reboot — after a reboot the container is simply gone. A templated systemd unit
closes that:

```sh
sudo install -m 644 ops/cod-workspace@.service /etc/systemd/system/
sudo systemctl enable --now cod-workspace@acme.service
```

It was validated with `systemd-analyze verify`, which caught `ExecStartPre`
placed in `[Unit]` — systemd *silently ignores* that, so it would have been a
runtime surprise rather than a startup error. See [ops/README.md](ops/README.md).

## Verifying it yourself

```sh
sh verify.sh                        # typecheck, tests, build inputs
sh scripts/cleanroom.sh /tmp/cod    # empty dir -> a real agent working
```

The clean-room rebuilds the image from a clean cache, starts a real container,
runs a real agent call, and tears the whole thing down — including purging its
own throwaway workspace, so a run leaves zero volumes and zero containers
behind. It is the check that a new user needs no manual step.

## Not yet done

Honest limits. The decisions that were open are closed and recorded in
[docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) — with the reasoning, so a
later change reads as a revision rather than an accident.

- **The driver is still the echo driver.** The dispatch *contract* is real and
  on the live path — steps, boundaries, fencing-friendly stop polling — but
  `echoDriver` does no work. A real driver implements the same contract; nothing
  above `dispatch` changes.
- **No agent-to-agent isolation** (see above).
- **Job isolation is per-worktree**, on its own git branch. The merge policy is
  decided (the org approves, never a human — question 2 in the open-questions
  doc) but not implemented; no merge step runs yet.
- **`blast_radius` is self-asserted by the proposer.** The rule is enforced
  correctly, but the input is not: an agent can submit `0` for global work. It
  is a policy hint, not an unspoofable control.
- **The novelty key catches byte-identical repeats only.** A department that
  rewords its goal defeats it, and reworded goals are normal LLM output rather
  than an edge case.
- **Ledger growth is uncapped** and the reconciler scans all history on every
  tick. Fine at this scale; it is the first thing to fix if the ledger grows.
- **No budget ceiling**, deliberately — every model is free, so there is nothing
  to meter. This needs revisiting the moment a paid model is added.

## History

This repository previously held a `corporate-on-demand` **skill** — 16
departments, mandatory pipelines, CEO oversight. It has been removed; the git
history preserves it at `a549589`. See [CHANGELOG.md](CHANGELOG.md).
