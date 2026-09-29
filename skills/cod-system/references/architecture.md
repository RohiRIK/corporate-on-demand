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
          supervisor.json  (heartbeat)            ├── Bun.cron  (schedule)
          logs/cod.jsonl     (events)             ├── opencode  (the runtime)
          results/*.json     (one per run)        └── /work/<dept>/<worker>
```

The host CLI does three things and nothing else: resolve configuration, run
`docker`, and read back what the container wrote. It never executes a task.
That split is why the host can be restarted without losing the schedule, and why
the container can die without taking the CLI with it.

## The state directory

Everything the system remembers lives in one directory (`--state`, default
`~/.local/share/cod`):

| Path | Written by | Purpose |
|---|---|---|
| `<state>/supervisor.json` | supervisor | heartbeat: `runId`, `seenAt`, registered jobs |
| `<state>/logs/cod.jsonl` | supervisor | every event, rotating at 5 MB x 3 |
| `<state>/results/*.json` | supervisor | one file per job run, pruned to `resultRetention` |
| `<state>/bus/` | - | reserved |

`cod.json` is **not** here: it is the operator's own file, mounted read-only, and
the CLI never rewrites it. Silently editing what someone wrote is worse than
leaving it alone.

## Data flow of one job

1. `Bun.cron` fires the callback registered in `scheduleWorkspace`
   (`src/scheduler.ts`).
2. The scheduler checks the concurrency ceiling and reports a queue if the job
   waits - a queue that is invisible looks exactly like a stalled schedule.
3. `run` is called. Today that is `echoTask`; the real dispatcher replaces it.
4. On completion, a result file is written - **including on failure**, from a
   `finally`. A failure that leaves no trace is what makes a system untrustworthy.
5. Every line the supervisor emits goes through the redacting sink on its way to
   disk.

## Why the container blocks in the entrypoint

The entrypoint `exec`s the supervisor, so the supervisor becomes PID 1. That
makes the container's life and the schedule's life the same thing: if the
supervisor dies, the container dies, and `--restart unless-stopped` brings it
back. The earlier design kept the container alive in `tail -f` and tried to
detect a dead supervisor from the host, which required carrying the whole
distinction on `cod status` alone.

The cost, stated: a stopped container now means a stopped schedule. That is the
honest reading, and it is why `--rm` was removed - Docker refuses `--rm` with
`--restart`, and `--rm` would delete the container on the very exit the restart
policy exists to act on.

## What this is not

- Not a job queue with delivery guarantees. There is no visibility timeout and
  no re-queue; see `recovery.md`.
- Not isolated per agent. One container, one filesystem, one uid.
- Not a CI system. `verify.sh` and `.github/workflows/ci.yml` are; the
  clean-room is a human-triggered check, deliberately.
