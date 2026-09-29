# Recovery

What happens when the supervisor dies, what is already handled, and the one
real gap. Sources are cited; the behavioural claims were verified locally.

## Current behaviour

- The supervisor is **PID 1** (`exec` in the entrypoint), so when it dies the
  container dies with it and `--restart` brings it back.
- A heartbeat at `<state>/supervisor.json` carries `runId`, `seenAt` and the
  registered job names. `cod status` classifies it `live` / `stale` / `never`
  and **exits 1** when the container is up but the schedule is not.
- A restart produces a **new `runId`**, so a crash loop is visible in
  `cod logs --run` rather than a silent spin.

`never` and `stale` are deliberately separate states: "never started" and
"started then died" need different fixes.

## Restarts are bounded - verified, not assumed

`unless-stopped` restarts **without limit**. The alternative is
`on-failure[:max-retries]`, which caps. Measured on this host:

```console
$ docker run -d --name rc1 --restart on-failure:3 alpine sh -lc "exit 1"
$ # 14s later
$ docker inspect rc1 --format '{{.State.Status}} restarts={{.RestartCount}}'
exited restarts=3
```

Docker also documents a second guard: *a restart policy only takes effect after
a container has been up for at least 10 seconds - this prevents a container
which doesn't start at all from going into a restart loop.*

So a supervisor that crashes on startup cannot spin forever. The remaining
question is what a *capped* failure looks like to a human, which is the job of
the log and `cod status`, not of Docker.

- Source: <https://docs.docker.com/engine/containers/start-containers-automatically/>
- Source: <https://docs.docker.com/reference/cli/docker/container/run/#restart>

## The real gap: a job in flight is invisible

A job writes its result **on completion**. If the supervisor dies mid-job,
nothing is written at all. There is no record of what was running, so "where did
it stop" has no answer beyond the last log line.

This is the same failure class as the `Bun.cron` version guard - a system that
looks fine while having done nothing - one level down.

## How established schedulers solve it

The vocabulary is settled; there is no need to invent it.

| Term | Meaning | Source |
|---|---|---|
| **Start-to-Close timeout** | max time for one attempt. Detects "a worker crashed *after* starting". Temporal defaults it to infinity and recommends setting it. | Temporal |
| **Heartbeat** | a periodic ping proving progress. Combined with a heartbeat timeout, it detects a worker that died silently. | Temporal |
| **Retry policy / attempts** | a crashed attempt is retried, count incremented. | Temporal, Celery |
| **`task_track_started`** | report a `started` state, not just pending/finished. Celery: *"useful for long running tasks and there's a need to report what task is currently running."* | Celery |
| **Soft / hard time limit** | soft raises an exception you can catch and clean up; hard kills and replaces the worker. Celery: *"The worker processing the task will be killed and replaced with a new one."* | Celery |
| **Late ack** | acknowledge *after* execution, so a crash re-delivers rather than silently losing the task. | Celery |

- <https://docs.temporal.io/encyclopedia/detecting-activity-failures>
- <https://docs.celeryq.dev/en/v5.5.3/userguide/configuration.html>

Temporal states the principle plainly: **the server does not detect that a
worker crashed; it relies on a timeout to force a retry.** Absence of a result
*is* the signal.

## What that means here

The minimal fix, in the spirit of `task_track_started` and a start-to-close
timeout:

1. Write a result file with `ok: false, started: true` **before** running.
2. Overwrite it on completion with the real outcome.
3. On supervisor start, any file still marked `started` is a job that died
   mid-flight. Report it by name rather than inferring from a log line.
4. Optionally re-queue it, bounded by an attempts count and a timeout.

Step 3 is the part that answers "where did it stop" - and it is the same shape
as the liveness check: distinguish "never happened" from "started and died",
because those are different problems.

## Not yet implemented

Steps 1-4 above. Today a crash mid-job leaves only the last log line, and this
document is the record of that gap rather than a description of a fix.
