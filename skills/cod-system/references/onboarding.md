# Onboarding

How a workspace is created, and what is actually configurable.

## The path from nothing to a running agent

```sh
cod init acme --yes     # writes cod.json, no prompts
cod up                  # builds the image if needed, starts the container
cod status              # confirms the schedule is live
```

Three commands. `up` waits for a live heartbeat and **fails** if one never
arrives, rather than reporting success for a container whose schedule is
broken.

## `cod.json`

The operator's file. The CLI reads it and **never rewrites it** - silently
editing what someone wrote is worse than leaving it alone.

| Field | Default | Notes |
|---|---|---|
| `version` | 1 | schema version |
| `company` | from the arg | `name`, `purpose` |
| `departments` | from a template | each with `workers[]` of `name`/`role`/`model` |
| `crons` | `[]` | the schedule; see `scheduling.md` |
| `maxConcurrent` | 2 | jobs allowed to run at once, 1..64 |
| `timezone` | host zone | **see below - this was a live bug** |
| `resultRetention` | 500 | result files kept before pruning |

### The timezone is not optional

Docker defaults a container to **UTC**. `Bun.cron` fires on **local** time.
Before the timezone field existed, `0 2 * * *` fired at 05:00 local and reported
success every single night.

- `cod init` writes the host's zone, so a new workspace is right by default.
- The zone is validated with `Intl` at parse time. An unrecognised zone is
  rejected by name rather than silently behaving as UTC.
- It is passed as `-e TZ=` on `docker run` **and** on every `docker exec`. A
  zone set only at start is a zone the scheduler does not use.
- `cod status` always prints the resolved zone with its current offset. A cron
  expression with no visible clock is not interpretable.

### Adding a department

Drop a JSON file in `templates/departments/`. No code change: the template is
data, and the worker list is read from it.

## Gotchas learned the hard way

- **`sed 's/.*"name".../'` on the workspace file is wrong.** It matches every
  `"name"` key - the company, the departments, the workers *and* every cron job.
  The entrypoint created seven directories where three belonged, and nothing
  failed. It now asks the schema (`cod-workers`).
- **A workspace with no enabled crons must still hold the container open.**
  With nothing registered there is no pending work keeping Bun's loop alive, so
  the supervisor exits instantly and `--restart` restarts it forever. The
  supervisor holds the loop with an interval and logs a warning.
- **An invalid workspace must report *why*.** The entrypoint once discarded the
  parse error with `2>/dev/null || true`, replacing a real cause with "refusing
  to guess". Errors from a guard are the guard's whole purpose.
