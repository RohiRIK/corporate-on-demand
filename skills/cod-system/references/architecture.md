# Architecture

How the pieces fit, and why the seams are where they are.

## Shape

```
you  ──>  cod (host CLI, Bun)  ──>  docker  ──>  one container per workspace
              │                                     │
              │  reads/writes                       │  PID 1
              ▼                                     ▼
        <state-dir>/                          supervisor (in-container)
          cod.json  (read-only mount)              │
          workspace.json  (which workspace owns it)├── Bun.cron  (schedule)
          supervisor.json  (heartbeat)            ├── governance tick: cycle,
          logs/cod.jsonl     (events)             │     meeting, dispatch, land
          results/*.json     (one per run)        ├── cod-sandbox ── opencode | kilo
          work/ledger.sqlite (CACHE)              │     (every agent, Landlock)
          work/<id>.json     (THE TRUTH)          └── /work  (named volume: the
          export/landed.bundle (for `cod land`)        repo + one worktree per job)
```

The host CLI does four things and nothing else: resolve configuration, run
`docker`, read back what the container wrote, and import landed work
(`cod land`). It never executes a task.
That split is why the host can be restarted without losing the schedule, and why
the container can die without taking the CLI with it.

## The work ledger

`src/work.ts` and `src/reconcile.ts` are the coordination layer. Two parts, and
the split between them is the whole design:

- **The work ledger** — `src/work.ts`. Two layers, deliberately separated. The
  **files are the truth**: readable with `jq`, and they survive total loss of
  the database. The **SQLite table is a cache** over them.
- **The reconciler** — `src/reconcile.ts`. The CEO's loop, level-triggered, and
  the only thing permitted to make a proposal runnable.

> **THE LEDGER IS A CACHE. THE FILES ARE THE TRUTH.**

Claim is one `UPDATE … RETURNING`, and SQLite's write lock makes exactly one
concurrent caller win — real mutual exclusion with no broker, no second daemon
and no credentials. Every commit is fenced on `lease_epoch`. Both mechanisms
are covered in `invariants.md`; the reasoning is in
`docs/AGENT_COMMUNICATION.md`.

The reconciler rides the supervisor's **30-second heartbeat tick** in
`src/supervisor.ts` rather than adding a timer, runs again inside every
governance tick and on `cod reconcile`, and is wrapped so a ledger failure
cannot take down every cron in the workspace.

## The governance tick

One tick, never two at once (`singleFlight`): **cycle** (departments with
nothing in motion propose a plan; resting and struck-out departments do not),
**reconcile**, **meeting** (the CEO decides the reconciled proposals by the
derived radius; each dispatch is keyed on its decision), **dispatch** (ready
items, up to `maxConcurrent`), **land** (finished tasks: mechanical checks, the
reviewer, merge, bundle). A plan's answer becomes a task; a task that lands lets
its department plan again. See `src/cycle.ts`, `src/meeting.ts`,
`src/runwork.ts`, `src/land.ts`.

## The state directory

Everything the system remembers lives in one directory (`--state`, default
`~/.local/share/cod`):

| Path | Written by | Purpose |
|---|---|---|
| `<state>/supervisor.json` | supervisor | heartbeat: `runId`, `seenAt`, registered jobs |
| `<state>/logs/cod.jsonl` | supervisor | every event, rotating at 5 MB x 3 |
| `<state>/results/*.json` | supervisor | one file per job run, pruned to `resultRetention` |
| `<state>/work/ledger.sqlite` | ledger | the coordination **cache** — rebuildable |
| `<state>/work/<id>.json` | ledger | the durable **truth** — one per finished item |
| `<state>/workspace.json` | `cod init` / `cod up` | which workspace owns this directory; a second one is refused |
| `<state>/export/` | supervisor | the landed base branch as a bundle, for `cod land` |
| `<state>/inflight/` | supervisor | jobs announced as running; a leftover one is reported once as abandoned |
| `<state>/bus/` | - | reserved |

Note the asymmetry in the last three rows: `work/<id>.json` is written by
`commit()` and nowhere else, so its existence means work genuinely finished.
Writing it earlier makes "the file exists, so the work was paid for" true before
any work has happened — which is exactly the bug that shipped in `38b3683`.

`cod.json` is **not** here: it is the operator's own file, mounted read-only, and
the CLI never rewrites it. Silently editing what someone wrote is worse than
leaving it alone.

## Data flow of one job

1. `Bun.cron` fires the callback registered in `scheduleWorkspace`
   (`src/scheduler.ts`).
2. The scheduler checks the concurrency ceiling and reports a queue if the job
   waits - a queue that is invisible looks exactly like a stalled schedule.
3. `run` is called, which dispatches the job through `src/dispatch.ts` with the
   real agent driver (`src/drivers.ts` → `runAgent` in `src/agent.ts`): the
   worker's own model, on its engine, in the job's worktree, **inside
   `cod-sandbox`** with the job's policy (`src/sandbox.ts`). The run is judged by
   its event stream, never its exit code alone.
4. On completion, a result file is written - **including on failure**, from a
   `finally`. A failure that leaves no trace is what makes a system untrustworthy.
5. Every line the supervisor emits goes through the redacting sink on its way to
   disk.

## Why the container blocks in the entrypoint

The entrypoint `exec`s the supervisor, so the supervisor becomes PID 1. That
makes the container's life and the schedule's life the same thing: if the
supervisor dies, the container dies, and `--restart on-failure:5` brings it
back. The supervisor refuses to run as anything but PID 1, so a second one cannot
be `docker exec`'d in beside it (that once doubled every cron). The earlier design kept the container alive in `tail -f` and tried to
detect a dead supervisor from the host, which required carrying the whole
distinction on `cod status` alone.

The cost, stated: a stopped container now means a stopped schedule. That is the
honest reading, and it is why `--rm` was removed - Docker refuses `--rm` with
`--restart`, and `--rm` would delete the container on the very exit the restart
policy exists to act on.

## What this is not

- Not a job queue with delivery guarantees. There is no visibility timeout and
  no re-queue; see `recovery.md`.
- Not isolated per agent for READS. One container, one filesystem, one uid; the
  sandbox confines what an agent may WRITE (see `sandbox.md`).
- Not exactly-once messaging. At-least-once delivery plus a durable dedupe key,
  an idempotent commit and a fencing token is the real target, and it is the
  ledger's target — see `docs/AGENT_COMMUNICATION.md`.
- Not a CI system. `verify.sh` and `.github/workflows/ci.yml` are; the
  clean-room is a human-triggered check, deliberately.
