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
[![Tests](https://img.shields.io/badge/tests-189%20passing-brightgreen?style=flat-square)]()
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
| `cod config show` | resolved configuration and where each value came from |

Exit codes: `0` success, `1` retryable runtime failure, `2` deterministic usage
or configuration error.

## What is actually verified

Not claimed — measured, and re-checked by `scripts/cleanroom.sh` on every run:

- one container per workspace, starting in **~0.4s** once the image exists
- a cron job firing on a real minute boundary, inside a real container
- an agent producing real output, at **zero cost**, with no credential on disk
- 11 security controls read back off a live container via `docker inspect`
- **189 tests**, clean strict typecheck

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

## Verifying it yourself

```sh
sh verify.sh                        # typecheck, tests, build inputs
sh scripts/cleanroom.sh /tmp/cod    # empty dir -> a real agent working
```

The clean-room deletes the state, the workspace, the container and the image,
then rebuilds all of it. It is the check that a new user needs no manual step.

## Not yet done

Honest limits, tracked in [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md):

- **A scheduled job runs an `echo`, not real work.** The full path is real and
  verified end to end; the task itself echoes its input. `src/task.ts` is the
  single seam where a real dispatcher goes.
- **No agent-to-agent isolation** (see above).
- **Job isolation is per-worktree**, on its own git branch. What happens to a
  finished job's branch — merge, keep, discard — is undecided.

## History

This repository previously held a `corporate-on-demand` **skill** — 16
departments, mandatory pipelines, CEO oversight. It has been removed; the git
history preserves it at `a549589`. See [CHANGELOG.md](CHANGELOG.md).
