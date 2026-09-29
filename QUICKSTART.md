# QUICKSTART

From nothing to a running agent, credential-free.

## Requirements

- Docker 29+ on the host
- Bun 1.3.9+ to run the CLI (the container ships its own Bun 1.3.12)

## Install

```sh
git clone https://github.com/RohiRIK/corporate-on-demand.git
cd corporate-on-demand
bun install
sh scripts/vendor-opencode.sh
```

The 177 MB opencode binary is **not** committed — it is fetched with a pinned
checksum, so the download is verifiable rather than "whatever the network
served today". `cod doctor` tells you if it is missing and names the script.

## Verify a deployment is intact

```sh
./src/index.ts doctor     # host can run containers, image, vendored binary
./src/index.ts status     # container state
```

## Create a workspace

```sh
./src/index.ts init acme --yes
```

Writes `./cod.json`:

```sh
./src/index.ts config show
./src/index.ts config show --json | jq .
```

## Start the shared container

The first run builds the image (minutes — it vendors opencode and installs the
toolchain). Later runs reuse it:

```sh
./src/index.ts up
./src/index.ts status
```

One container per workspace, not one per agent. All workers share it.

`up` alone is the whole thing: the supervisor is the container's main process,
so there is no second command. It waits for a live schedule and **fails** if
one does not come up, rather than reporting success for a broken container.

The container restarts itself if the supervisor dies. Note that `docker kill`
deliberately does *not* trigger a restart — if you killed it, you meant to stop
it.

**The timezone matters.** Docker defaults a container to UTC and `Bun.cron`
fires on local time, so a workspace with no `timezone` set would run every job
three hours off. `cod init` writes this host's zone; `cod status` always shows
it:

```
$ cod status
  timezone Asia/Jerusalem (+03:00)
```

## See what happened

Every event is written to `<state-dir>/logs/cod.jsonl` and survives the
container:

```sh
./src/index.ts logs                 # newest first
./src/index.ts logs --level warn    # only warnings and errors
./src/index.ts logs --last 20
./src/index.ts logs --run <id>      # one supervisor or job, end to end
./src/index.ts logs --json | jq .
```

Run a job, `cod down`, and the record is still there. Each event carries a
timestamp, a level, and a `runId` — the id correlates one job's start, its
firing, and its result, which is what makes a busy schedule readable instead of
four interleaved stories.

The file rotates at 5 MB and keeps 3 archives, so a long-running workspace
cannot fill the disk through its own logging.

## Run a scheduled job

```sh
./src/index.ts supervise
```

The supervisor registers every enabled cron in `cod.json` on `Bun.cron` and
reports what it registered. Add a job to `cod.json`:

```json
{
  "name": "nightly",
  "schedule": "0 2 * * *",
  "agent": "builder",
  "task": "run the build",
  "enabled": true
}
```

**`schedule` is a standard 5-field cron expression.** `Bun.cron` does not
accept `@every`; it rejects it with "unrecognized field syntax". A rejected job
is reported by name and the rest of the schedule still registers, so one bad
expression never costs you the whole schedule.

Nicknames that do work: `@yearly`, `@annually`, `@monthly`, `@weekly`,
`@daily`, `@midnight`, `@hourly`.

## Is the schedule actually running?

`cod status` answers container state and schedule state **separately**, because
they are different claims:

```
$ cod status
acme — container up
  supervisor: live, 1 job(s): heartbeat (seen 4s ago)
```

If the supervisor dies while the container stays up — which is what happens,
since the container blocks deliberately — the heartbeat goes stale and the
command **exits 1**:

```
  supervisor: STALE (last seen 200s ago, 0 job(s): none) - the container is
  up but the schedule is not running
```

A container that is `up` is not evidence that anything is scheduled. Stale
after 90 seconds without a heartbeat.

## Tear down

```sh
./src/index.ts down    # idempotent; keeps the work volume
```

`down` keeps the volume on purpose, so an agent's commits survive a restart.
To remove the work and every commit in it:

```sh
./src/index.ts purge            # refuses, and says why
./src/index.ts purge --purge    # irreversible
```

## Verify the whole thing

```sh
bun test ./tests                              # 47 tests
sh scripts/cleanroom.sh /tmp/cod-cr           # empty dir -> working agent
```

The clean-room script deletes the state, the workspace, the container and the
image, then rebuilds all of it. It is the check that a new user needs no manual
step.

## Exit codes

- `0` — success
- `1` — retryable runtime failure
- `2` — deterministic usage or configuration error

## Security

Read `docs/SECURITY_POSTURE.md` before changing any container flag. It
separates the controls that are genuinely enforced from the ones that are only
convention, and it is the thing to update when a control is added or removed.
