# Agent-to-agent communication

Research and decision record for how `cod` agents coordinate. Decided
2026-09-29; the short version is in `docs/OPEN_QUESTIONS.md` question 5.

> **Status: option 1 below is IMPLEMENTED** in `src/work.ts` and
> `src/reconcile.ts`, on the CLI as `cod work` and `cod reconcile`. The rest of
> this document is the research that chose it and is kept as the decision
> record. Where the implementation diverged from the recommendation, the
> implementation wins and the divergence is called out below.

The recommendation below is Leo's, verified locally on this stack (Bun
1.3.12, `bun:sqlite`): **files are the durable record, `bun:sqlite` in WAL mode
is the coordination index.** A broker is premature for three agents in one
container. Independent verification: eight concurrent processes racing for a
single pending work item produced exactly one winner and seven clean refusals.

Context verified: `corporate-on-demand` (`src/log.ts`, `results.ts`, `inflight.ts`, `liveness.ts`,
`src/dispatch.ts`), single container, one uid, one Docker volume, Bun 1.3.12. Verified locally that
`bun:sqlite` is available, `PRAGMA journal_mode=WAL` is settable, and `INSERT OR IGNORE` dedupes
(changes: 1 then 0) — so option 1 below is not hypothetical, it was run.

The research was conducted against a system whose work path was a synchronous `echoTask` stub. That
seam has since moved: the supervisor now dispatches through `src/dispatch.ts`, which has real step
boundaries and a `shouldStop` poll between them. The conclusion is unchanged and slightly
strengthened — an async step loop is what makes "interrupt at the next boundary" expressible at
all — but the `(c) fencing` finding is now the *binding* constraint on the dispatcher rather than
a hypothetical, because the dispatcher is the thing a re-dispatch would race.

## The correctness target, stated precisely

Exactly-once is not achievable and any design that claims it is lying. Realistic target:
**at-least-once delivery + effectively-once execution**, where "effectively-once" is bought with
(a) a durable dedupe key on every unit of work, (b) idempotent commit keyed by that key, and
(c) a **fencing token** that invalidates writes from a process whose lease expired.

(c) is the one people skip and it is the one that bites this system. Scenario: Engineering is
mid-model-call, container is killed, supervisor restarts, re-dispatches the same job, the new
Engineering finishes and writes state. The old process was not dead — it was a zombie with a stale
view — it wakes and writes its result, clobbering the new one. Claim tokens prevent this; worktree
isolation does not, because both runs share the *ledger*, not the source tree.

Failure modes being designed against, concretely:
1. **Lost message** — dispatch held in supervisor memory, container dies, work item evaporates.
   (`inflight.ts` already exists because of this class.)
2. **Torn read** — a JSONL line half-written by a crash; reader must skip unparseable tails.
3. **Double-processing** — two readers claim the same item.
4. **Ordering** — two producers in the same millisecond; already bitten in `results.ts` (hence `seq`).
5. **Partial failure across files** — work completed and paid for, but the ack never landed.

## Option 1 — RECOMMENDED: files are the durable record, `bun:sqlite` (WAL) is the coordination index

Two layers, deliberately separated, each doing the job it is actually good at.

**Truth layer — files, tmp+fsync+rename.** Every unit of work is a file: `mailbox/<agent>/<id>.json`
written as `<id>.json.tmp` → `fsync(file)` → `rename()` → `fsync(dir)`. This is the Loncaric recipe and
it gives the property that matters: **a reader never sees a half-written message**. Without the rename,
a crash mid-write can leave a file that exists and is filled with garbage — the failure `inflight.ts`
currently catches by try/catch and skipping. Also keep the existing result JSON per run; it is
human-inspectable with `jq` and survives total loss of the ledger.

**Coordination layer — one SQLite file on the existing volume, WAL mode.** Tables:
`work(id PK, from_agent, to_agent, kind, payload, state, lease_owner, lease_epoch, created_seq)`
and `epoch(n)`. Mechanisms:
- *Dispatch* = one transaction: `INSERT INTO work` + bump `created_seq`. Either the job exists or it
  does not — no in-memory queue, nothing to lose on restart.
- *Claim* = `UPDATE work SET state='running', lease_owner=?, lease_epoch=(SELECT n FROM epoch)+1
  WHERE id=(SELECT id FROM work WHERE state='pending' ORDER BY created_seq LIMIT 1) RETURNING *`.
  One statement, one transaction: SQLite's write lock means exactly one process wins, and
  `changes: 0` tells the loser there was nothing to take. This is a real mutual-exclusion primitive
  and it needs no broker, no credentials, no extra process — it is a file on the volume you already mount.
- *Result commit* = write the result file first (durable, atomic), then
  `UPDATE work SET state='done' WHERE id=? AND lease_epoch=?`. A zombie with an old epoch updates
  **zero rows** and its result is rejected as stale.
- *Consolidation* = the CEO's read is a query over the same table, ordered by `(cycle, agent,
  created_seq)`. No messaging protocol for "propose next work" at all: proposals are rows.
- *Crash recovery* = on boot, `UPDATE work SET state='pending' WHERE state='running' AND
  lease_expired < now`, and separately report the ones whose result file exists but whose state is
  not `done` — that is the "work was paid for, ack lost" case, resolved by reading the file, not by
  re-running it.

Why WAL is legitimate here: SQLite documents that WAL requires all processes on the same host and
does not work over a network filesystem. This system is one container, one host, one volume — the
constraint WAL imposes is exactly the constraint you already have.

Cost: one migration from plain files to a table, and the invariant "the ledger is a cache; the files
are the truth" must be held deliberately.

### Where the implementation diverged from this recommendation

The recommendation was written before the code existed. Four things changed, and
the reasons are the point:

- **The file is written by `commit()`, not by `propose()`.** The recommendation
  implies every unit of work gets a file at dispatch time. Implemented that way,
  the reconciler's recovery rule — "the result file exists, so the work was paid
  for" — is true *before any work happens*, and every claimed item self-completes
  on the next tick. The file's existence only means something if a file appears
  when work **finishes**.
- **The `epoch` table is created but never read.** It is still in `SCHEMA` and
  still seeded, but the claim takes `lease_epoch + 1` from the row rather than
  `(SELECT n FROM epoch)+1`. The per-row column is what makes fencing work at
  row granularity rather than for the whole queue, and it needs no second table
  to stay consistent with the first. The table is a leftover; it should be
  dropped, and doing so is a schema migration, not a docs change.
- **State names differ**: `ready`/`running` where the research wrote
  `pending`, plus `proposed`, `failed` and `rejected`.

## Option 2 — Pure filesystem mailboxes, no database

`mailbox/<agent>/` directories; claim by `link()` into a per-consumer `claimed/` dir (or `O_EXCL` +
`rename`), complete by rename into `done/`, order by zero-padded sequence in the filename.

Honest limits, and they are real:
- **No atomicity across two files.** Marker and result are separate writes; a crash between them
  leaves permanent ambiguity. This is the exact "partial failure on crash" case, and it is the one
  that loses completed, model-billed work.
- **No compare-and-swap.** A claim is a directory operation, not a transaction; fencing requires
  hand-rolled epoch checks in every writer.
- **Enumeration cost.** Consolidation is `readdir` + parse of every pending file, forever. Fine at
  hundreds, poor at millions.
- **Lock reaping is yours.** A crashed holder leaves a lockfile; you need stale-lease logic in three
  places (dispatch, claim, commit) instead of one.
- Note `O_APPEND` writes under `PIPE_BUF` are atomic, but only for small records and it gives you no
  atomicity across records — do not treat "append-only JSONL" as a queue with delivery guarantees.

Verdict: sound skeleton, wrong primitive. It is the right answer if you forbid SQL; otherwise it is
you hand-writing the parts of a database you would otherwise get correct.

## Option 3 — Embedded broker (NATS JetStream / Redis Streams / SQLite-backed queue lib)

Genuinely durable, real production systems. Rejected because: a second stateful daemon becomes the
thing whose durability you must now prove; JetStream/Redis ack-redelivery is *at-least-once*, so you
still write the dedupe table and the fencing check from Option 1; Redis persistence defaults lose
recent writes on kill (RDB vs AOF — AOF `everysec` is still a one-second window); and it adds a
process that must itself be restarted, monitored, and put in the container's liveness story. Three
agents do not generate enough concurrent message traffic to need it.

## Rejected outright

- **Direct synchronous calls** (CEO `await`s Engineering in-process). Couples the CEO's lifetime and
  its heartbeat to a multi-minute model call; one hung job stalls the whole company; a crash loses
  the in-flight call. It also contradicts "the CEO is a supervisor that consolidates at cycle end".
- **Pub/sub fanout with no backlog.** A subscriber that is down misses messages forever. Bolt a log
  onto it and you have reinvented Option 1.
- **Actor model.** Bun ships no supervision tree; you would build the tree, the restart policy and
  the shutdown protocol yourself — that is the whole project, not the communication layer.
- **Temporal / Airflow / Celery.** Each needs a server (Temporal), a metadata DB plus broker
  (Airflow), or a broker (Celery). Airflow's own best-practices doc is instructive in the negative
  sense: "treat tasks equivalent to transactions... never produce incomplete results", "use UPSERT
  not INSERT", "never use `now()` inside a task" — the same discipline Option 1 encodes
  structurally, with a tenth of the machinery. Temporal's Start-To-Close timeout is a good model
  and `inflight.ts` already implements it.

## Ranking

1. **Files-as-truth + `bun:sqlite` WAL as coordination index** (verified working on this Bun build).
2. **Pure filesystem mailboxes** — same shape, hand-rolled CAS and fencing, real risk of losing
   completed work between two writes. Reasonable fallback if adding SQL is unacceptable.
3. **Embedded broker** — premature; buys at-least-once, which you must harden anyway.

The commonly-believed-and-wrong claim to retire: *"exactly-once messaging"* is a property of a
storage engine's transaction log, not of a message bus, and it evaporates as soon as the effect
leaves the log — here, into an LLM call and a git worktree. Buy dedupe keys, idempotent commits and
fencing; do not buy a broker to chase the word.
