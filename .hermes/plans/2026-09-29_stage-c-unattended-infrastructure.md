# Stage C — Make the infrastructure usable unattended

**Status:** proposed, awaiting Rohi's go-ahead
**Branch:** `feat/infra-scratch` (continue) · **Date:** 2026-09-29

## Goal

Six gaps that all make the same promise and do not keep it: a container that
starts, runs the wrong thing at the wrong time, and stops without anyone
noticing. Close all six, and leave the agent doing real work as the next
decision — not this plan.

## Current state

`feat/infra-scratch` @ `4327281`. 120 tests, clean typecheck, `verify.sh` PASS.

Verified working: onboarding, one shared container (0.36s), in-container
`Bun.cron` with a hard version guard, structured event log, persisted results,
4 MB output cap, concurrency ceiling, and liveness detection that exits 1.

## The six gaps, each with the evidence that found it

| # | Gap | How it was found |
|---|---|---|
| 1 | **Every cron job is 3 hours off** | Measured `TZ undefined · offset 0 · Intl tz: UTC` inside the container vs `IDT` on the host. Nothing sets a timezone, Docker defaults to UTC, and `Bun.cron` uses local time. `"0 2 * * *"` fires at 05:00 local. |
| 2 | **Nothing restarts a dead supervisor** | `grep restart src/docker.ts` → no match. Liveness *detection* exists; there is no response to it. |
| 3 | **Results accumulate without bound** | `grep retention src/results.ts` → nothing. One file per run, forever. |
| 4 | **No CI** | No `.github/workflows/`, no CI config. `verify.sh` calls `bun x` correctly now, but only because a broken `bunx` was caught by hand. |
| 5 | **No log redaction** | Recorded as accepted risk; still open. Mandatory once agents emit real output. |
| 6 | **The supervisor only starts via `docker exec`** | `cod up` starts a container that blocks in `tail -f` and does nothing by itself. The normal path requires remembering a second command. |

## Non-goals

- **No real agent dispatch.** `echoTask` stays an echo.
- No model routing, merge policy, budget ceilings, cron GUI, or inter-agent
  locking — all deferred, see `docs/OPEN_QUESTIONS.md`.
- No changes to what an agent is *allowed* to do.

---

## Task 1 — Timezone (the correctness bug)

**Why first:** it is the only gap that makes the system silently do the wrong
thing while reporting success. Everything else is visible.

**Design:**

- `Workspace` gains `timezone: string`, defaulting to `"UTC"` — and `cod init`
  writes the *host's* zone, not UTC, so a new workspace is right by default.
- Validated with `Intl.DateTimeFormat` at parse time. An invalid zone is a
  startup failure naming the bad value, not a silent fall back to UTC.
- Passed to the container as `-e TZ=<zone>` in `buildRunArgv`, so it is set on
  **every** `docker exec` as well as at run time. A timezone set only at start
  is a timezone that does not apply to the process that schedules the jobs.
- `cod status` and `cod supervise` **print the resolved zone**. A cron
  expression with no visible clock is not interpretable.

**TDD:** failing test in `tests/timezone.test.ts` — the argv contains `-e TZ=...`;
an invalid zone is rejected; `int init` writes the host zone; status renders the
zone.

**Verify:**
```sh
docker exec cod-sandbox-cod sh -lc 'echo $TZ'   # must equal the configured zone
bun test ./tests/timezone.test.ts               # passes
```

**Done when:** `0 2 * * *` fires at 02:00 in the configured zone, proven by a
container printing its own offset.

---

## Task 2 — Restart a dead supervisor

**Why second:** detection without response is half a fix, and I built the
detection. A container that sits stale for a week is worse than one that
crashed loudly.

**Design — deliberately minimal, no dependency:**

- `buildRunArgv` adds `--restart unless-stopped`. The container restarts when
  the supervisor dies **if** the supervisor is PID 1; it is not, so this alone
  is insufficient — see below.
- Therefore: **supervise as PID 1.** The entrypoint ends with
  `exec supervisor`, and the container's life *is* the supervisor's life. Docker
  then restarts the container when the supervisor dies, which is exactly the
  wanted behaviour, with no watchdog and no second process.
- The heartbeat is removed on clean shutdown, so a restart is visible in
  `cod status` as `live` with a **new** `runId` rather than a continuous one.

**Tradeoff, stated:** this makes the container's status identical to the
schedule's status, which is *more* honest than today but means a container that
exits is a container that is not running. That is correct.

**TDD:** failing test — `buildRunArgv` includes `--restart`; the Dockerfile's
entrypoint ends with `exec`; a fresh `runId` appears after a restart.

**Verify:**
```sh
docker exec cod-sandbox-cod sh -lc 'kill -9 1'   # kill the supervisor
sleep 5
cod status                                        # must report live again, new runId
```

**Done when:** killing the supervisor brings it back without a human.

---

## Task 3 — Result retention

**Why:** a workspace running every minute writes 525,600 files a year. I
deferred this in Stage B by saying "a size you cannot see is worse than one you
can" — that was true then, and it is now visible and *still* unbounded.

**Design:**

- `Workspace` gains `resultRetention: { keepLast: number }`, default **500**.
- `pruneResults(stateDir, keepLast)` deletes the oldest beyond the cap, and
  returns what it removed so the caller can log it. Pruning is **reported**,
  never silent — silent deletion of data is its own class of surprise.
- Called at the end of a supervisor tick, not on every write, so a busy schedule
  does not `readdir` 500 times a minute.
- No age-based policy. Two knobs means two wrong settings; one is enough, and
  YAGNI applies.

**TDD:** failing test — 600 results, `keepLast: 500`, exactly 500 remain and the
newest survive; pruning reports its count; a corrupt file is not counted as
prunable.

**Done when:** the results directory is bounded and its size is visible.

---

## Task 4 — CI

**Why:** everything I have claimed as "verified" was verified by one person, on
one machine, by hand. The `bunx` bug is the proof: it passed locally and would
have failed anywhere else.

**Design:**

- `.github/workflows/ci.yml` on push and pull request:
  - `oven/bun:1.3.12` — the pinned runtime, not "latest", so CI cannot pass on a
    version the container does not use.
  - `bun install --frozen-lockfile` — the lockfile is committed.
  - `sh scripts/vendor-opencode.sh` with the pinned checksum.
  - `sh verify.sh`.
  - **Not** the clean-room: it needs Docker, minutes, and a live model
    endpoint. A CI that fails when a free provider is down trains people to
    ignore red builds. It stays a human-triggered check, and that is a decision
    recorded in the workflow as a comment.
- The `secrets` audit the repo's own `AGENTS.md` requires before publishing:
  scan for tokens, and confirm `.env` and `vendor/opencode/*/opencode` are
  excluded.

**Verify:** push the branch, read the run. It must be red if I break the
typecheck — a CI that cannot fail is not CI, so I will verify it by breaking
something on purpose and watching it fail.

**Done when:** the workflow is red on a deliberately broken commit and green on
a fixed one.

---

## Task 5 — Log redaction

**Why:** accepted risk today, because the only output is an echo. The moment
agents do real work this becomes where credentials land.

**Design:**

- `redact(text)` applied to log output and persisted results, at the sink. One
  place, so a new call site cannot forget.
- Patterns: `sk-…`, `ghp_…`, `github_pat_…`, `Bearer <token>`, `xox[baprs]-…`,
  AWS `AKIA…`, and `KEY=value` for a key/value denylist of names
  (`API_KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`).
- Replacement is a fixed marker, not a hash — a hash of a short secret is
  reversible by brute force, and a fingerprint nobody needs is worse than one
  that says "redacted".
- **Honest limit:** this catches known shapes, not a novel one. A secret in
  prose is not caught. That is stated in the security posture rather than
  implied away by calling the feature "redaction".

**TDD:** failing tests, one per pattern, plus a test that a non-secret is
untouched — a redactor that mangles ordinary output is its own outage.

**Done when:** seeded secrets in a job's output never reach disk.

---

## Task 6 — The supervisor starts with the container

**Why:** `cod up` currently starts a container that blocks in `tail -f` and
does nothing. The user must remember `cod supervise`. In a system meant to run
unattended, a manual second step is a step that gets missed.

**Design — this overlaps Task 2, deliberately.** Task 2 makes the supervisor
PID 1; Task 6 is the user-visible half: `cod up` then genuinely means "running".

- `up` starts the container; the supervisor comes up with it.
- `cod supervise` remains, for a one-off run against an existing container, and
  is documented as the manual path.
- `status` no longer needs to warn "run `cod supervise`" for the normal case.
  It still distinguishes `never` from `stale`, because a container that never
  started is a different problem from one that died.
- Because the supervisor is PID 1, `docker exec`-style manual invocation is no
  longer needed for the schedule to work at all.

**Verify:**
```sh
cod down && cod up
cod status            # must be live, with no second command
```

**Done when:** `up` alone produces a live schedule.

---

## Sequencing

1. **Timezone** — correctness, and everything scheduled depends on it.
2. **Supervisor as PID 1 + restart** — Tasks 2 and 6 are one change; doing them
   apart would mean running the supervisor twice.
3. **Retention** — small and independent.
4. **Redaction** — small, and better done before real output exists.
5. **CI** — last, so it runs against the finished code rather than catching
   churn from the four above.

## Validation for the stage

1. `bun test ./tests` — all existing 120 plus new ones.
2. `sh verify.sh` with a **clean PATH**, since that is how Task 4 runs it.
3. `sh scripts/cleanroom.sh /tmp/cod-c` — full flow, image deleted.
4. **New adversarial checks**, each proven:
   - `TZ` inside the container matches the configured zone
   - kill the supervisor → it returns, `status` live with a new `runId`
   - 600 results → 500 remain, and the pruning was logged
   - a seeded `sk-...` in job output never appears in the log or results
   - `cod up` alone → live schedule, no second command
5. CI red on a deliberately broken commit, green when fixed.

## Definition of done

- All six closed, each with a test that failed first.
- Stage validation 1–5 green.
- `docs/OPEN_QUESTIONS.md` updated; `CHANGELOG.md`, `README.md` and
  `QUICKSTART.md` describe the new behaviour.
- Committed and pushed; parent gitlink advanced.
- **Still no agent doing real work.** That is the next decision, not this plan.

## Risks

| Risk | Mitigation |
|---|---|
| Making the supervisor PID 1 changes container exit semantics | Recorded as a deliberate trade above; a stopped container now means a stopped schedule, which is the honest reading. |
| Supervisor auto-restart could mask a crash loop | The heartbeat's `runId` changes on every restart, so a loop is visible in `cod logs --run`. Capped restarts would be a later refinement. |
| Redaction is pattern-based, so it will miss novel shapes | Stated as a limit in the security posture. It is a mitigation, not a guarantee, and will not be described as one. |
| A workspace on a different host would inherit a foreign zone | `init` writes the host's zone, and `status` always prints the resolved one, so a mismatch is visible rather than latent. |
| CI cannot test the clean-room | Deliberate, and commented in the workflow: a build that fails when a free provider is down is one people learn to ignore. |
