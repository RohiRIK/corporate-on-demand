# Reading cod state, field by field

For when `cod results` is not enough and you need to know what a field means.

## `cod results` fields

- `ok` / `FAIL` - the job's outcome, read from the dispatcher rather than from
  the agent's own account.
- `r0` / `r1` / `r2` - the blast radius the job ran under. For ledger work it
  is DERIVED from the paths the task named, never from a number it claimed; for
  a cron job it comes from the job's name (`-cross-`, `-global-`). `r2` is
  global.
- `[N files: a, b, c]` - the files it changed, read from git. This is the line
  that lets you judge a run without opening a diff.
- `REFUSED: ...` - the boundary stopped it, with the offending paths named. A
  refusal you cannot see is a refusal that looks like success, so it is printed
  here and not only in the log.

## `cod work list` states

- `proposed` - someone proposed it. NOT runnable until the CEO reconciles.
- `ready` - reconciled and runnable.
- `running` - claimed, with a lease. Has an epoch; the commit is fenced by it.
- `done` - the run finished. For a task that is not the end: it still has to
  be reviewed - `cod work blocked` and the review outcome say what happened
  next.
- `failed` - the run did not work. `run failed (n/3): ...` is counted, and the
  reconciler puts it back on the queue until the third; after that it waits in
  `cod work blocked`. A failure recorded with `--failed` by a person is final.
- `rejected` - refused before it ever ran: global work, or out of the
  proposer's authority. It is never retried.

## `epoch` and why it is in the list

Every claim increments `lease_epoch`. A run may only commit under the epoch it
was given, so a job that was reclaimed and re-run updates zero rows and its
result is refused rather than overwriting the newer one. Seeing a bump between
two reconciles is normal, not a bug.

## Where things live

- Ledger: `<state>/work.sqlite` (WAL mode).
- Durable records: `<state>/work/` - one file per item, published atomically by
  rename. A result file is written BEFORE the ledger commit, so a crash between
  the two is recoverable rather than lossy.
- Branches and commits: the work volume, under `/work`. A finished job's
  worktree is RELEASED, but its branch and commits are kept.
- Logs: `/cod/logs/cod.jsonl` in the container, append-only.
