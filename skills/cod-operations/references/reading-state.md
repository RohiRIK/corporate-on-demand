# Reading cod state, field by field

For when `cod results` is not enough and you need to know what a field means.

## `cod results` fields

- `ok` / `FAIL` - the job's outcome, read from the dispatcher rather than from
  the agent's own account.
- `r0` / `r1` / `r2` - the blast radius the job actually ran under. DERIVED
  from the target paths, never from what the job claimed. `r2` is global.
- `[N files: a, b, c]` - the files it changed, read from git. This is the line
  that lets you judge a run without opening a diff.
- `REFUSED: ...` - the boundary stopped it, with the offending paths named. A
  refusal you cannot see is a refusal that looks like success, so it is printed
  here and not only in the log.

## `cod work list` states

- `proposed` - someone proposed it. NOT runnable until the CEO reconciles.
- `ready` - reconciled and runnable.
- `running` - claimed, with a lease. Has an epoch; the commit is fenced by it.
- `done` / `failed` - finished. `failed` covers both "did not work" and "was
  refused", so check the reason.
- `rejected` - the reconciler refused it as out of the proposer's authority.

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
