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

## Tear down

```sh
./src/index.ts down    # idempotent; leaves nothing behind
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
