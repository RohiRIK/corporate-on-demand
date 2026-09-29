# Scheduling

`Bun.cron`, the concurrency ceiling, and the two syntax facts that will bite.

## How a job is registered

`scheduleWorkspace` in `src/scheduler.ts` reads every enabled cron in
`cod.json` and registers it. The supervisor is PID 1 inside the container, so
the schedule lives exactly as long as the process does.

## The version guard is not optional

`Bun.cron` **does not exist below Bun 1.3.12**. A scheduler without the guard
registers nothing, reports itself healthy, and silently never runs a single job.

Both the entrypoint and `assertCronSupport` throw. The host is on 1.3.9, which
has no `Bun.cron` at all - which is exactly why the image pins 1.3.12.

## Syntax: standard 5-field cron only

```
minute hour day-of-month month day-of-week
```

**`@every 1s` is NOT supported.** It throws
`Invalid cron expression: unrecognized field syntax`. Nicknames that *do* work:
`@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`.

### The failure this caused

`Bun.cron` throws **synchronously**. The first implementation let that escape
the registration loop, so **every job after the bad one was never registered** -
a partial schedule that reported success. Now each job is registered in its own
`try`, a rejected one is reported *by name*, and the rest still register. There
is a test for exactly this.

## Concurrency

`maxConcurrent` (default 2) bounds simultaneous jobs via `createGate` in
`src/limit.ts` - one shared global ceiling, FIFO waiters, released in a
`finally` so a throwing job cannot leak a slot. Twenty lines, not a pool
library: the behaviour worth having is the ceiling, FIFO order, and one failing
task not stalling the queue.

It was previously `runWithLimit(maxConcurrent, [oneClosure])` per cron - a
single-element array, and `runWithLimit` spawns `min(limit, tasks.length)`, so
it always spawned exactly one. Ten crons firing at the same minute ran ten jobs
at once while the limit was read, logged, and stored in the heartbeat. Measured,
not theoretical. The test measures peak overlap from *inside* the tasks, since
asserting on scheduling order would have passed against the broken version.

A waiting job **says so in the log**. A queue that is invisible looks exactly
like a stalled schedule, and those need different fixes.

## What runs

`echoDriver` in `src/dispatch.ts`. A cron job fires, runs through the
dispatcher, and returns a result - but the driver echoes the task string. The
schedule is real and verified end to end; the *work* is not.

**The driver is the only seam.** Replacing `echoDriver` is how a job starts
doing real work, and nothing above `dispatch` changes - `TaskResult` is still
the result contract. An echo was chosen because it cannot fail for interesting
reasons: if a scheduled job breaks, the cause is the scheduling rather than
the work.

## Results

One JSON file per run under `<state>/results/`, written in a `finally` so a
**failure also leaves a trace**. Pruned to `resultRetention`, and every prune is
logged - silent deletion of data is its own surprise.

Read them with `cod results [--last N] [--cron NAME] [--failed]`.

## A real gap, stated

`inflight.ts` closed this one: a job announces itself **before** running, so a
crash mid-job leaves a detectable mark and the next start names it. See
`recovery.md`.
