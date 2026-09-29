# Stage B — Make the infrastructure trustworthy

**Status:** proposed, awaiting Rohi's go-ahead
**Branch:** `feat/infra-scratch` (continue) · **Date:** 2026-09-29

## Goal

Make the infrastructure good enough to build on, *before* any agent is allowed
to do real work. Concretely: bound what a runaway job can consume, make its
results survive the container, and make `cod` able to show what ran.

Today `echoTask` is the only thing that executes. That is deliberate. The point
of this stage is that when it stops being an echo, it inherits a substrate that
will not quietly melt the host.

## Why this stage, and not the alternative

Option A — make the agent do real work — was rejected by Rohi: not until the
infrastructure is good enough. Recorded here so the reasoning survives: a real
agent editing files with no rate limit, no output cap, and no persisted results
is a worse first experiment than a hardened echo.

## The four gaps, each verified in the code, not assumed

| # | Gap | Evidence |
|---|---|---|
| 0 | **No logging system at all** | Reporting is `process.stdout.write` in the supervisor and an ad-hoc `report` callback in the scheduler. There is no level, no timestamp, no run id, no sink, nothing on disk. You cannot answer "what happened at 03:14" or follow one job through its life. |
| 1 | **Unbounded stdout** | `src/docker.ts:35` — `new Response(proc.stdout).text()` reads the whole stream into memory. A job that emits 2 GB OOMs the CLI, and the CLI is on the host. |
| 2 | **No result persistence** | Only two `writeFile` calls in the whole codebase, both for `cod.json`. `~/.local/share/cod` contains no files. A result exists only in the log, and dies with the container. |
| 3 | **No rate or concurrency limit** | `src/scheduler.ts` has no limiter. Ten jobs at `:00` all fire at once with no ceiling on how many may run. |
| 4 | **Schedule is in-process only** | `Bun.cron` handles are in-memory. A container restart loses the schedule silently — it re-registers only because the supervisor is re-run, and nothing reports that it did. |

**Gap 0 comes first because it is the instrument the rest of the work is
measured with.** Tasks 1–4 all produce observations; without a logging system
those observations either vanish or exist only as prose. Building the caps
first and the log last would mean going back and re-instrumenting all of them.

## Non-goals

- No real agent dispatch. `echoTask` stays.
- No model routing, merge policy, or budget ceilings (open questions 1–3).
- No GUI (open question 4).
- No file locking between agents (open question 5) — unreachable while the only
  task is an echo, and it belongs with real dispatch.

---

## Task 0 — A logging system, as the foundation

**Why first:** every later task produces observations. Without a logger they
vanish or live only as console prose. Built first, the caps below instrument
themselves as they land.

**Design decisions, and why:**

- **JSON Lines, one event per line.** Not pretty multi-line text: JSONL is
  greppable *and* machine-readable, and it appends without a rewrite, so a
  crash mid-write costs one line rather than the file.
- **A `runId` on every event.** This is what lets you follow a single job
  through start, queueing, execution and failure. Without it, four jobs firing
  at `:00` produce four interleaved, unattributable stories.
- **Level filter, default `info`.** `debug` for per-step detail, `warn` for
  degradation, `error` for failure. A logging library that cannot be turned
  down is noise.
- **A `Sink` interface, not a direct file write.** Tests capture events in
  memory; the container writes to a mounted file. Otherwise every test either
  writes to the real state dir or mocks the logger, and both make the tests
  lie.
- **Rotation by size, cap on files kept.** A logger that fills the disk is the
  same class of bug as the unbounded stdout this stage exists to fix. A logger
  must not become gap 1.
- **Redaction is not in this stage, and that is recorded as a risk.** Job output
  is logged verbatim today. Once agents do real work, that log becomes a place
  secrets can land, and redaction becomes mandatory rather than advisable.

- [ ] Failing test in `tests/log.test.ts`: emit to a memory sink, assert level,
      timestamp, `runId` and fields all survive. Fails first — the module
      does not exist.
- [ ] New `src/log.ts`:
      - `type Level = "debug" | "info" | "warn" | "error"`
      - `interface LogEvent { ts, level, msg, runId?, fields? }`
      - `interface Sink { write(event: LogEvent): void }`
      - `createLogger({ sink, level, runId, now })` — `now` injected so tests
        are deterministic, the same discipline the scheduler already uses.
      - `fileSink(path, { maxBytes, keep })` with size-based rotation.
      - `memorySink()` for tests.
- [ ] A test that rotation actually rotates and respects `keep` — otherwise the
      logger is an unbounded file with extra steps.
- [ ] Wire the supervisor and scheduler `report` callbacks through it. Delete the
      ad-hoc `process.stdout.write` in the supervisor; the logger owns output
      now.
- [ ] Add `cod logs [--level L] [--run ID] [--last N]`, and document that
      `cod logs` is how you answer "what happened".
- [ ] Update `docs/SECURITY_POSTURE.md`: logs are a new write surface that
      contains raw job output.
- [ ] Commit.

**Done when:** you can run a job, then ask "what happened" and get a
correlated, timestamped answer from disk after the container is gone.

---

## Task 1 — Bound the output of every process

**Why first:** it is the only gap that can take down the host, and every later
task runs code through this path.

- [ ] Write the failing test in `tests/docker.test.ts`: a runner that emits
      5 MB of output returns a result whose `stdout` is capped and whose
      `truncated` flag is set. Verify it fails against the current code.
- [ ] Add to `src/docker.ts`:
      - `OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024` (4 MB) as a named constant with
        a comment on why 4 MB: comfortably larger than any legitimate CLI
        output, small enough that 50 jobs cannot exhaust host memory.
      - `RunResult` gains `readonly stdoutTruncated: boolean` and the same for
        stderr. **This is a breaking change to the type** — update every
        construction site, including the test fakes.
      - Read the stream incrementally and stop accumulating past the limit
        rather than slicing a fully-buffered string. Slicing after the fact
        does not fix the memory problem.
      - Keep draining after the cap so the child never blocks on a full pipe —
        a child that blocks on a full pipe while we stop reading is a deadlock.
- [ ] Assert the child still exits and its real exit code survives truncation.
- [ ] Run `bun test ./tests` — expect pass. Commit.

**Done when:** a runner emitting 100 MB returns in bounded memory, reports
truncation, and the process still exits cleanly.

## Task 2 — Persist every job result

**Why:** without this, "what did the schedule actually do" is unanswerable
after the container stops, which makes every later debugging session guesswork.

- [ ] Failing test in `tests/results.test.ts`: run a job, then read it back
      from disk and assert the fields survive. Fails first.
- [ ] New `src/results.ts`:
      - `interface JobResult` — `cron`, `agent`, `task`, `startedAt`,
        `finishedAt`, `durationMs`, `ok`, `output`, `error`.
      - `recordResult(dir, result)` writes one JSON file per run to
        `<stateDir>/results/`, named `<timestamp>-<cron>.json`. One file per
        run, never appended into a growing array — an append-only file is
        unbounded and is exactly the failure Task 1 exists to prevent.
      - `listResults(dir, { limit })` returns newest first, with a default and
        a hard maximum so `cod` cannot be made to read 100k files.
- [ ] Call `recordResult` from the supervisor's `run` callback, in a `finally`
      so a failed job is recorded too. A failure that leaves no trace is
      exactly what makes a system untrustworthy.
- [ ] Add `cod results [--limit N]` to the command table, JSON and table output.
- [ ] Update `docs/SECURITY_POSTURE.md`: results on disk are a new write surface
      and the file is the evidence.
- [ ] Commit.

**Done when:** after the container is destroyed, `cod results` still shows what
ran, when, and whether it succeeded.

## Task 3 — Rate and concurrency limits

**Why:** a misconfigured schedule — or a bug in this code — must not be able to
run fifty agents at once.

- [ ] Failing test in `tests/scheduler.test.ts`: five jobs scheduled together,
      an injected limiter of 2, and the assertion that never more than 2 run
      concurrently. Fails first.
- [ ] `src/scheduler.ts` gains a `maxConcurrent` option, default **2**, and a
      simple FIFO queue. Deliberately not a pool library: the queue is ~20
      lines and its behaviour is what the test pins.
- [ ] A job that waits must say so in its log line, or a slow queue looks
      identical to a stalled schedule.
- [ ] The supervisor passes the value; make it configurable per workspace in
      `cod.json`, validated to be ≥1 by the existing schema.
- [ ] Commit.

**Done when:** N jobs firing simultaneously never exceed the ceiling, and the
queue is visible in the log.

## Task 4 — Report schedule state honestly across restarts

**Why:** a schedule that silently does not re-register after a restart is the
failure mode this whole project has been guarding against since the `Bun.cron`
version check.

- [ ] Failing test: after a simulated restart, `cod status` reports whether the
      schedule is registered and when it was last confirmed — not merely that
      the container is up.
- [ ] The supervisor writes a heartbeat with the registered job names and a
      timestamp to `<stateDir>/supervisor.json` on start and on every tick.
- [ ] `cod status` reads it and reports `supervisor: live, 2 jobs, seen 12s ago`
      — or `supervisor: NOT RUNNING`, distinctly from `container: up`.
- [ ] A heartbeat older than a threshold is reported as stale. A stale
      heartbeat is a supervisor that died, and silence must not read as health.
- [ ] Commit.

**Done when:** killing the supervisor while the container stays up is visible
within one threshold interval, and cannot be mistaken for healthy.

---

## Validation for the stage

Run all of it, in this order:

1. `bun test ./tests` — every test above, plus the existing 53, still pass.
2. `sh verify.sh` — typecheck, tests, build inputs, shell syntax.
3. `sh scripts/cleanroom.sh /tmp/cod-b` — full flow from zero, image deleted.
   Must still pass all 19 checks: hardening must not have broken the path.
4. **A new adversarial run** — the four failure modes, each proven:
   - a job emitting 100 MB → CLI survives, reports truncation
   - a job that hangs → timeout fires, result recorded as failed
   - a job that throws → recorded as failed, does not stop the schedule
   - `docker kill` the supervisor → `cod status` says so within the threshold
5. `git diff` review: no credential anywhere, no `docker.sock`, nothing that
   widens the container's privileges.

## Definition of done

- All four gaps closed, each with a test that failed before the fix.
- Stage B validation steps 1–5 all green.
- `docs/OPEN_QUESTIONS.md` updated: the two items this stage resolves are marked
  closed with evidence; the three that remain are untouched and still deferred.
- `CHANGELOG.md` and `README.md` describe the new limits, in particular that
  output is capped, jobs are queued, and results persist.
- Committed and pushed to `feat/infra-scratch`.

## Risks

| Risk | Mitigation |
|---|---|
| Output cap hides a real error in a truncated log | Truncation is reported explicitly, never silently. The tail is kept, since the end of a failing command is what matters. |
| Concurrency limit makes a legitimate 5-job schedule look broken | The queue is visible in the log; the cap is per-workspace and configurable. |
| Result files grow without bound on disk | One file per run plus a hard read limit. A retention policy is deliberately *not* in this stage — a size you cannot see is worse than one you can. |
| Persisted results could contain sensitive output | Results hold whatever a job printed. Documented in the security posture as a new write surface, so it is a known surface rather than a surprise. |
