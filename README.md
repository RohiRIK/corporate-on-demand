<div align="center">

```
 ██████╗  ██████╗ ██████╗
██╔════╝ ██╔═══██╗██╔══██╗
██║       ██║   ██║██████╔╝
██║       ██║   ██║██╔══██╗
╚██████╗  ╚██████╔╝██║  ██║
 ╚═════╝   ╚═════╝ ╚═╝  ╚═╝
```

**A credential-free container workspace for an unattended company of AI agents**

One container per workspace. Agents confined by the kernel. No API key.

[![Bun](https://img.shields.io/badge/bun-1.3.12-white?style=flat-square&logo=bun)](https://bun.sh)
[![opencode](https://img.shields.io/badge/opencode-1.18.31-blue?style=flat-square)](https://github.com/sst/opencode)
[![Tests](https://img.shields.io/badge/tests-785%20passing-brightgreen?style=flat-square)]()
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

An agent **acts**: it runs with tools (`--auto`) in its own git worktree, on its
own `cod/` branch, and what it commits is reviewed and merged by the company -
never by the agent. What confines it is not its working directory but the
**sandbox**: every agent runs inside Landlock, below.

Two facts worth knowing if you run this yourself:

- `opencode run` **hangs on the host** — measured 280s with no output — so the
  driver spawns it inside the container, which is where the supervisor already
  runs. The container deliberately has no docker binary and no socket.
- The driver uses `Bun.spawn`, not `node:child_process`. On this runtime
  `execFile` hangs to its own timeout on the identical command, while
  `Bun.spawn` returns it in ~3.3s.

`echoDriver` remains as the deterministic reference implementation of the driver
contract, for tests; it is not on the live path - a cron naming no worker runs
the free default model and says so. `echoTask` in `src/task.ts` is off the live
path entirely. `TaskResult` remains the result contract between the
supervisor and the work.

## The agent sandbox

Every agent - a cron job, a dispatched ledger item, `cod work run`, the reviewer,
a meeting's voice - runs through `cod-sandbox`, a small static launcher compiled
into the image (`docker/sandbox.c`), with a policy decided in `src/sandbox.ts`.
It uses **Landlock**, an unprivileged Linux LSM: a process restricts itself and
every child inherits it, so it works under the container's `--cap-drop ALL` and
no-new-privileges, with no root and no extra capability.

| An agent... | |
|---|---|
| reads and writes `/cod` - the ledger, results, logs, `cod.json` | **denied**: not granted at all |
| writes the main checkout, `.git/config`, `.git/hooks`, `.git/info` | **denied** |
| moves the base branch, or any ref outside `refs/heads/cod/` | **denied** |
| writes another job's worktree | **denied** |
| signals the supervisor (Landlock ABI 6+) | **denied** |
| writes its own worktree and commits on its own branch | allowed |
| reads the repository, uses `/tmp` and its `$HOME`, reaches the network | allowed - see [the posture](docs/SECURITY_POSTURE.md) |

A plan writes nothing of the repository; the reviewer and the meeting get no
repository at all, only a scratch directory. It **fails closed**: with no
launcher, or no Landlock in the kernel, an agent is refused rather than run
unconfined - unless `cod.json` says `"agentSandbox": "off"`, which is recorded
and shown by `cod status`. `tests/sandbox.test.ts` compiles the real launcher and
runs real git through it; the clean room checks a live container.

## The company, unattended

The supervisor runs one governance tick on its own interval
(`governance.cycleEveryMinutes`, default 30):

1. **Plan.** Each department with nothing in motion proposes a plan to the CEO.
   The reconciler vets it; the meeting decides; the plan runs read-only and
   answers `GOAL / PATHS / CHECK` (`src/plan.ts`).
2. **Task.** The answer becomes a task scoped to the paths it named. Its blast
   radius is **derived from those paths** - global ones are refused by rule.
3. **Work.** A worker runs it in its own worktree, inside the sandbox, briefed
   with the goal, the paths, and any reviewer objections so far.
4. **Review and land.** Mechanical checks first (secrets, global paths, a push
   or a merge in the diff, symlinks, submodules, binaries) - no model can
   override them. Then a reviewer model: approve, request changes (the work goes
   back with the objection, up to `maxReviewRetries`), or reject. An approved
   change is merged into the base branch and written out as a bundle.
5. **Again.** A department plans again once its work has landed. Three bad
   outcomes in a row hold it until a person looks; a plan that finds nothing new
   makes it rest, twice as long each time, up to a day.

`cod work blocked` is the queue of what stopped and needs a person, and
`cod work unblock` is the way out.

### Landing

Nothing on the host is writable from the container except the state directory,
which agents cannot reach. After each landing the supervisor writes the base
branch as a git bundle into `<state>/export/`, and on the host:

```sh
cod land                                     # into landing.repo as cod-landed
git -C /path/to/repo push origin cod-landed  # publishing it is yours
```

`cod land` verifies every object (`git fsck --strict`, in a throwaway repository)
before anything reaches your repository, and only fast-forwards; `--force`
replaces `cod-landed` if the history no longer descends from it.

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

It rides the supervisor's **30-second heartbeat tick** rather than adding a timer,
runs again inside every governance tick and on `cod reconcile`, and it is wrapped
so a ledger failure cannot take down every cron in the workspace.

Five jobs per pass:

1. **Promote or reject proposals.** Only the reconciler may make a proposal
   runnable.
2. **Reclaim work past its budget.** Per item, never global: one global
   threshold either kills legitimate slow work or tolerates a hung job, and
   usually does both.
3. **Recover work whose acknowledgement was lost.** It **reads the durable
   file**, and never re-runs the job. The case is "work was paid for, the ack
   was lost" — re-running would double-execute and double-bill a job that
   already finished.
4. **Retry failed runs**, a bounded number of times (`run failed (n/3)`), on the
   pass after the one that failed them; after that they wait in
   `cod work blocked`.
5. **Report**, and do nothing else.

## The anti-loop gate

Departments propose their own next work, so a proposal enters as `proposed` and
**only the reconciler may promote it to `ready`**. A department cannot put
itself on the run queue.

Duplicate proposals are refused by a `UNIQUE` index on `novelty_key` — a sha256
of department + goal + sorted target paths, truncated to 32 hex chars. This is
**real enforcement, not a prompt asking an agent to notice**, and it is the
brake on self-graded work.

Blast radius is a **rule, not a judgement**, and it is **derived, not
asserted**: a task that names a global path (`src/`, `package.json`, any
`.gitattributes`...) is radius 2 whatever number its proposer wrote, and radius 2
is refused by the reconciler. A declared radius is recorded but can never lower
what the paths imply. At landing the radius is derived again from the paths the
change *actually* touched, so naming harmless paths and touching global ones
does not get through either.

## The CLI surface

All of this is reachable from the command line, which is a hard project
requirement. Flags below are as implemented in `src/index.ts` and `src/meta.ts`.

```sh
cod work list [--status <s>] [--json]
cod work propose --from <agent> --to <agent> --goal <text> \
                 [--payload <t>] [--paths a,b] [--blast 0|1|2] [--kind task|plan]
cod work claim [--owner <name>] [--to <agent>]
cod work commit <id> --epoch <n> [--reason <text>] [--failed]
cod work run <id>                  # run one ready item in the container, now
cod work blocked                   # what stopped and needs a person
cod work unblock <id> [why] [--override]
cod reconcile
```

A refusal - a fenced commit, a duplicate proposal, an unblock that would skip a
live objection - **exits 2**, so a script can tell it from success.

The work-item id is a **positional argument**, not `--id`. It was a flag
advertised in `--help` and wired to nothing, and it was removed rather than left
as a trap one commit away from being live.

`--status` filters the list; `--state` is the state *directory*, as on every
other command. (They were once the same flag, and the filter silently listed
nothing.)

### The lifecycle, worked

Every line below is real output from this repository, not an illustration.

```console
$ cod work propose --from engineering --to engineering \
      --goal "add a healthcheck to the compose file" --paths compose/healthcheck.yml
proposed w-muqn5e5a-6175ae (state proposed; it is NOT runnable until the CEO reconciles it)

$ cod work propose --from engineering --to engineering \
      --goal "add a healthcheck to the compose file" --paths compose/healthcheck.yml
refused: already proposed as w-muqn5e5a-6175ae (state proposed); re-proposing identical work is refused
$ echo $?
2

$ cod work claim --owner worker-a
nothing to claim

$ cod reconcile
promoted w-muqn5e5a-6175ae to ready

$ cod work claim --owner worker-a
claimed w-muqn5e5a-6175ae as worker-a (lease_epoch 1, attempt 1)

$ cod work commit w-muqn5e5a-6175ae --epoch 0 --reason "the zombie result"
commit REFUSED: fenced: lease_epoch 0 is stale (current 1); a newer run owns this item
$ echo $?
2

$ cod work commit w-muqn5e5a-6175ae --epoch 1 --reason "the real result"
committed w-muqn5e5a-6175ae as done

$ cod work list
w-muqn5e5a-6175ae  done      add a healthcheck to the compose file            engineering -> engineering  epoch=2 attempts=1  (the real result)
```

The proposal is **unclaimable until `cod reconcile` runs**, the duplicate is
refused at the database rather than asked not to happen, the stale-epoch commit
is fenced, and the good one is accepted. Note `epoch=2` after a commit at epoch
1: the epoch was consumed.

Global work is refused by the rule - here because it names `package.json`,
whatever radius it claims:

```console
$ cod work propose --from engineering --to engineering --goal "change the build" --paths package.json
proposed w-muqn5eop-0320ea (state proposed; it is NOT runnable until the CEO reconciles it)

$ cod reconcile
rejected w-muqn5eop-0320ea

$ cod work list --status rejected
w-muqn5eop-0320ea  rejected  change the build                                 engineering -> engineering  epoch=0 attempts=0  (blast radius is global; the CEO must di…)
```

## Deliberately not built

These are decisions, not omissions.

- **The 9-state machine**, cut to `proposed` / `ready` / `running` / `done` /
  `failed` / `rejected` plus an `attempts` counter. A review's outcome lives in
  its own `review` table - `landed`, `changes-requested`, `rejected`,
  `deferred`, `cleared` - not as more work states.
- **A `priority` column.** Nothing in the system can compute a priority that
  means anything. A column that is always a constant is a lie in a schema.
- **`tokens_used`.** Budget ceilings were closed because every model is free, so
  a token counter is dead instrumentation.
- **A computed `state_digest`.** An expensive proxy for a signal the dispatcher
  emits directly, and free, at each step.

## Commands

| | |
|---|---|
| `cod init <name>` | onboarding; writes a secret-free `cod.json` (refuses to overwrite one without `--force`) |
| `cod up` / `down` | start / stop the workspace container (`down` is idempotent and keeps the work volume); `up` replaces a stopped container, or one that no longer matches `cod.json` or the image |
| `cod status` | container, schedule, sandbox, blocked work and unexported landings |
| `cod supervise` | what the running supervisor registered - read-only |
| `cod logs` | the event log — the answer to "what happened" |
| `cod results` | persisted job results — what ran, and did it work |
| `cod land` | export landed work into `landing.repo` as `cod-landed` |
| `cod cycle` / `cod meet` | one company cycle, or one meeting, by hand |
| `cod work` | the work ledger: `list`, `propose`, `claim`, `commit`, `run`, `blocked`, `unblock` |
| `cod reconcile` | one pass of the CEO's loop; the supervisor also runs it every 30s and on every governance tick |
| `cod skills` | the agent skill bundle, and this workspace checked against it |
| `cod image` | build the workspace image |
| `cod doctor` | host checks, with the fix for anything missing |
| `cod purge` | remove the work volume, every commit in it, and the export (`--purge` confirms) |
| `cod config show` | resolved configuration and where each value came from |

Exit codes: `0` success, `1` retryable runtime failure, `2` usage failure or
refusal - the same command will fail again.

## What is actually verified

Not claimed — measured, and re-checked by `scripts/cleanroom.sh` on every run:

- one container per workspace, its supervisor **PID 1** and live before `up`
  returns
- the container flags (`--cap-drop ALL`, no-new-privileges, PID and memory
  limits) and the **exact** mount list, read back off a live container
- Landlock available, and a sandboxed process denied `/cod` and the main
  checkout while it reads what it was granted
- an agent answering an arithmetic question through the sandbox, at **zero
  cost**, with no credential on disk
- **785 tests**, clean strict typecheck

The ledger and the reconciler are verified by **mutation, not only by assertion**.
An assertion proves the code does what you wrote; a mutation proves the test
would notice if it stopped. Measured on this tree:

| Mutation | Result |
|---|---|
| Remove the `lease_epoch` predicate from `commit()` | **3 tests fail** |
| Make proposals born `ready`, bypassing the CEO entirely | **15 tests fail** |

The first number went DOWN, from 18, and that is the honest reading rather than
a regression: `commit()` now also requires `running`, which refuses most zombies
on its own. What is left for the epoch is a zombie that wakes while a newer run
holds the item, and three tests pin exactly that case. Re-measured on this tree
with the mutation applied to the SQL itself - a first attempt edited the object
literal, which the INSERT never reads, and "passed".

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
| [agent-proof](skills/agent-proof/SKILL.md) | judging a run instead of trusting it, and the traps that hide failure |
| [cod-operations](skills/cod-operations/SKILL.md) | running a workspace from outside the container, including the destructive bits |

## Running on boot

Docker's `--restart on-failure:5` survives a **daemon** restart, not a **host**
reboot. A templated systemd unit closes that; each workspace gets its own state
directory, owned by uid 1000 - the uid the container runs as:

```sh
sudo install -m 644 ops/cod-workspace@.service /etc/systemd/system/
sudo install -d -o 1000 -g 1000 -m 0750 /var/lib/cod/acme
sudo cod init acme --yes --workspace /var/lib/cod/acme/cod.json --state /var/lib/cod/acme
sudo chown -R 1000:1000 /var/lib/cod/acme
sudo systemctl enable --now cod-workspace@acme.service
```

It was validated with `systemd-analyze verify`, which caught `ExecStartPre`
placed in `[Unit]` — systemd *silently ignores* that, so it would have been a
runtime surprise rather than a startup error. See [ops/README.md](ops/README.md).

## Verifying it yourself

```sh
sh verify.sh                        # typecheck, tests, build inputs, secret scan
sh scripts/cleanroom.sh /tmp/cod    # empty dir -> a real agent working
```

The clean-room rebuilds the image from a clean cache, starts a real container,
checks its posture and its sandbox, runs a real agent call through the sandbox,
and tears the whole thing down — including purging its own throwaway workspace,
so a run leaves zero volumes and zero containers behind, even when it fails. It
is the check that a new user needs no manual step. `COD_CLEANROOM_IMAGE=<tag>`
runs it against an image that already exists, and says the build was not
checked.

## Not yet done

Honest limits. The decisions that were open are closed and recorded in
[docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) — with the reasoning, so a
later change reads as a revision rather than an accident. Security findings and
what became of each are indexed in
[.security-review/STATUS.md](.security-review/STATUS.md).

- **Read isolation between agents.** The sandbox stops an agent writing what is
  not its own; it can still read the repository and other worktrees, and `/tmp`
  and `$HOME` are shared.
- **Any `cod/` branch is writable by any agent**, not only its own: refs share
  one directory, and Landlock grants directories. The reviewer and the merge
  see what is on the branch when they look.
- **Egress is open**, by design: agents install packages. It is also the
  exfiltration path. See [the posture](docs/SECURITY_POSTURE.md).
- **The novelty key catches identical repeats only.** A reworded goal is new
  work; a department that finds nothing rests, but one that rephrases does not.
- **Ledger growth is bounded, not capped.** The rest stops idle departments
  adding rows every tick; nothing prunes history yet.
- **No budget ceiling**, deliberately — every model is free, so there is nothing
  to meter. This needs revisiting the moment a paid model is added.

## History

This repository previously held a `corporate-on-demand` **skill** — 16
departments, mandatory pipelines, CEO oversight. It has been removed; the git
history preserves it at `a549589`. See [CHANGELOG.md](CHANGELOG.md).
