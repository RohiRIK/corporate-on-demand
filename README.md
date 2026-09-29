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
[![Tests](https://img.shields.io/badge/tests-221%20passing-brightgreen?style=flat-square)]()
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
sh scripts/vendor-opencode.sh

./src/index.ts init acme --yes    # write cod.json
./src/index.ts up                 # build the image, start the container
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

`echoDriver` implements the driver contract and produces today's output.
`echoTask` in `src/task.ts` is off the live path but retained as the reference
shape; `TaskResult` remains the result contract between the supervisor and the
work.

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
| `cod config show` | resolved configuration and where each value came from |

Exit codes: `0` success, `1` retryable runtime failure, `2` deterministic usage
or configuration error.

## What is actually verified

Not claimed — measured, and re-checked by `scripts/cleanroom.sh` on every run:

- one container per workspace, starting in **~0.4s** once the image exists
- a cron job firing on a real minute boundary, inside a real container
- an agent producing real output, at **zero cost**, with no credential on disk
- 11 security controls read back off a live container via `docker inspect`
- **221 tests**, clean strict typecheck

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
- **The ledger described in question 5 does not exist.** Files and the disk are
  the whole coordination story today. SQLite, fencing and the novelty gate are
  the fixed build order, step 2 onward.
- **No budget ceiling**, deliberately — every model is free, so there is nothing
  to meter. This needs revisiting the moment a paid model is added.

## History

This repository previously held a `corporate-on-demand` **skill** — 16
departments, mandatory pipelines, CEO oversight. It has been removed; the git
history preserves it at `a549589`. See [CHANGELOG.md](CHANGELOG.md).
