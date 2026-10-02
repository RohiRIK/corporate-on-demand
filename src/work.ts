/**
 * The work ledger: the coordination index.
 *
 * Two layers, deliberately separated. The FILES are the truth - a human can
 * read them with jq and they survive total loss of this database. The SQLite
 * table is a cache over them: an index that makes claim and commit atomic, and
 * which can be rebuilt from the files if it is ever lost.
 *
 * The governing invariant, and the one to protect in every future change:
 *
 *     THE LEDGER IS A CACHE. THE FILES ARE THE TRUTH.
 *
 * Anything that treats the table as authoritative is how a lost job becomes a
 * lost job permanently.
 *
 * Why SQLite at all: the claim is a single UPDATE ... RETURNING, and SQLite's
 * write lock makes exactly one process win it. That is real mutual exclusion
 * with no broker, no second daemon, and no credentials. Verified on this
 * runtime: eight concurrent processes raced for one pending item and exactly
 * one claimed it.
 *
 * Why fencing, which is not optional: an agent killed mid-call is a ZOMBIE,
 * not a corpse. If the supervisor re-dispatches, the new run finishes and
 * writes state, and then the old process wakes and clobbers it. So every commit
 * carries the lease epoch it was given, and a commit whose epoch is stale
 * updates zero rows. Git worktrees do NOT prevent this - both runs share this
 * ledger, not the source tree.
 */

import { Database } from "bun:sqlite";
import { mkdirSync, renameSync, writeFileSync, openSync, fsyncSync, closeSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { redact } from "./redact";

/**
 * The work lifecycle. Deliberately small.
 *
 * A larger machine with `claimed`, `review`, `merged` and `abandoned` was
 * designed and cut: those are states for a merge pipeline and a reviewer that
 * do not exist yet. `attempts` carries the retry count instead of a state.
 */
export type WorkState = "proposed" | "ready" | "running" | "done" | "failed" | "rejected";

export interface WorkItem {
  readonly id: string;
  readonly from_agent: string;
  readonly to_agent: string;
  readonly kind: string;
  readonly payload: string;
  readonly state: WorkState;
  readonly lease_owner: string | null;
  readonly lease_epoch: number;
  readonly attempts: number;
  readonly novelty_key: string;
  readonly blast_radius: number | null;
  readonly reason: string | null;
  readonly created_seq: number;
  /** When the item was claimed. Null until it runs; the budget is measured from here. */
  readonly started_at: number | null;
}

export interface WorkDb {
  readonly db: Database;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS work (
  id           TEXT PRIMARY KEY,
  from_agent   TEXT NOT NULL,
  to_agent     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  payload      TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'proposed',
  lease_owner  TEXT,
  lease_epoch  INTEGER NOT NULL DEFAULT 0,
  attempts     INTEGER NOT NULL DEFAULT 0,
  novelty_key  TEXT NOT NULL,
  blast_radius INTEGER,
  reason       TEXT,
  created_seq  INTEGER NOT NULL,
  started_at   INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_work_novelty ON work(novelty_key);
CREATE INDEX IF NOT EXISTS ix_work_claim ON work(state, created_seq);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- One row per work item: the LATEST review verdict.
--
-- This table exists because the verdict used to live in two module-level Sets
-- in src/land.ts, which are empty after every supervisor restart. The
-- consequence was that a REJECTED item - whose ledger row was never written -
-- stayed done, was offered by the tick on every tick, and was re-reviewed by
-- a model for ever. A verdict nobody recorded is a verdict nobody keeps.
--
-- IF NOT EXISTS because an existing database gains this on its next open, with
-- no migration and no data movement.
CREATE TABLE IF NOT EXISTS review (
  work_id     TEXT PRIMARY KEY,
  outcome     TEXT NOT NULL,
  reason      TEXT NOT NULL,
  branch      TEXT NOT NULL DEFAULT '',
  landed_sha  TEXT NOT NULL DEFAULT '',
  reviewed_at INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0
);
`;

/**
 * Put the database in WAL mode, verifying rather than assuming.
 *
 * Converting to WAL needs a brief exclusive lock, and SQLite can report BUSY
 * for it even with busy_timeout set - busy_timeout does not govern a journal
 * mode change. So it is retried, and then the resulting mode is READ BACK.
 * Assuming the PRAGMA worked is how a database silently stayed in rollback
 * mode with concurrent writers.
 */
function ensureWal(database: Database, attempts = 20): void {
  for (let n = 0; n < attempts; n += 1) {
    try {
      database.run("PRAGMA journal_mode = WAL");
      const mode = database.query("PRAGMA journal_mode").get() as { journal_mode?: string } | null;
      if ((mode?.journal_mode ?? "").toLowerCase() === "wal") return;
    } catch {
      // Another opener is mid-conversion; fall through to the backoff.
    }
    // Synchronous sleep via Atomics: a spin loop would burn a core for no
    // reason, and a busy retry is the whole point here.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 + n * 5);
  }
  throw new Error("could not put the work ledger into WAL mode after repeated attempts; concurrent writers may be wedged");
}

/**
 * Open (or create) the ledger under the state directory.
 *
 * WAL is legitimate here precisely because of the constraint it imposes: it
 * requires every process to be on one host, and refuses to work over a network
 * filesystem. This system is one container, one host, one volume - so the
 * limitation is the shape we already have.
 */
export function openWork(stateDir: string): WorkDb {
  const dir = join(stateDir, "work");
  mkdirSync(dir, { recursive: true });
  const database = new Database(join(dir, "ledger.sqlite"), { create: true });
  // busy_timeout BEFORE journal_mode, and that order is not cosmetic.
  // `PRAGMA journal_mode = WAL` is itself a WRITE, so running it first means a
  // concurrent opener fails immediately with "database is locked" before the
  // timeout that would have made it wait. Measured: 10 of 24 concurrent
  // first-opens died before this was reordered.
  database.run("PRAGMA busy_timeout = 10000");
  ensureWal(database);
  database.run("PRAGMA foreign_keys = ON");
  database.run(SCHEMA);
  // Seeding inside one transaction with INSERT OR IGNORE. The previous
  // check-then-insert was a race: two openers both saw an empty table and one
  // lost with a UNIQUE violation on meta.k.
  database.transaction(() => {
    database.run("INSERT OR IGNORE INTO meta (k, v) VALUES ('created_seq', '0')");
  })();
  // A column is not a table: CREATE TABLE IF NOT EXISTS cannot add one, so an
  // existing database gains `attempts` only here. Checked, not assumed - an
  // unconditional ALTER fails on every database that already has it, and this
  // runs on every single open.
  const reviewColumns = new Set(
    (database.query("PRAGMA table_info(review)").all() as { name: string }[]).map((r) => r.name),
  );
  if (!reviewColumns.has("attempts")) {
    database.run("ALTER TABLE review ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  }
  return { db: database, close: (): void => database.close() };
}

/** Monotonic, gap-free, and independent of the clock. */
function nextSeq(db: Database): number {
  db.run("UPDATE meta SET v = CAST(CAST(v AS INTEGER) + 1 AS TEXT) WHERE k = 'created_seq'");
  const row = db.query("SELECT v FROM meta WHERE k = 'created_seq'").get() as { v: string } | null;
  return Number(row?.v ?? "1");
}

/**
 * The dedupe key.
 *
 * A department proposes its own next work, so the same thing WILL be proposed
 * again - that is the loop this stops. Hashing the department, the goal and the
 * sorted target paths means "do the same thing twice" collapses to one row, and
 * the database refuses the second, rather than relying on an agent to notice.
 */
export function noveltyKey(dept: string, goal: string, targetPaths: readonly string[] = []): string {
  const paths = [...targetPaths].sort().join(",");
  return createHash("sha256").update(`${dept}\u0000${goal.trim()}\u0000${paths}`).digest("hex").slice(0, 32);
}

/**
 * A safe id, or an error.
 *
 * The id becomes a FILENAME and a git BRANCH (`cod/<id>`), so an unvalidated one
 * is a path-traversal write - an id of "../escaped" wrote outside the work
 * directory - and, with a leading dash, an argument git can mistake for an
 * option. This is now the SAME rule src/worktree.ts applies to the branch, not
 * a looser second standard: the two used to disagree (uppercase and a leading
 * dot or dash passed here and failed there), so a custom id could be proposed
 * and then never run.
 */
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function assertSafeId(id: string): void {
  if (SAFE_ID.test(id) && !id.includes("..")) return;
  throw new Error(
    `unsafe work id ${JSON.stringify(id)}: expected 1-64 chars of [a-z0-9._-], starting with a letter or digit, and no ".."`,
  );
}

/**
 * Bounds on the free text the ledger stores.
 *
 * `reason` carries model output - a reviewer's words, an agent's final answer -
 * and it is written to disk, shown by the CLI and, for some items, handed back
 * to a model. Unbounded, one verbose agent turns every listing into a wall and
 * every brief into a prompt the next model has to wade through.
 */
export const MAX_PAYLOAD = 16_000;
export const MAX_REASON = 2_000;

/**
 * Text bound for the ledger: redacted, then capped, saying so when it was cut.
 *
 * Redacted because the ledger is a SINK, like the log and the result files, and
 * it was the one sink that skipped redaction - so an agent that quoted a key it
 * had read put that key in a SQLite file and a JSON file on the host.
 */
export function ledgerText(text: string, max: number = MAX_REASON): string {
  const clean = redact(text).text;
  return clean.length <= max ? clean : `${clean.slice(0, max - 15)}… [truncated]`;
}

/**
 * A target path, as a REPOSITORY path or not at all.
 *
 * The target paths decide the blast radius, so they are the input the whole
 * authority rule hangs from. They used to be stored as whatever strings arrived:
 * an absolute path, a `..`, a NUL. None of those is a claim about this
 * repository, and a radius derived from them is derived from nothing.
 */
export function assertSafeTargetPath(path: string): void {
  const bad =
    path.length === 0 ||
    path.length > 256 ||
    /[\u0000-\u001f\\]/.test(path) ||
    path.startsWith("/") ||
    path.split("/").some((segment) => segment === ".." || segment === ".");
  if (bad) {
    throw new Error(
      `unsafe target path ${JSON.stringify(path)}: expected a relative repository path with no "..", no "." segment, no backslash and no control character`,
    );
  }
}

/** Department and worker names, as the workspace schema spells them. */
const SAFE_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_KIND = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Write the durable record for a unit of work.
 *
 * tmp -> fsync(file) -> rename() -> fsync(dir), the standard recipe, and the
 * reason a reader NEVER sees a half-written message. Without the rename a crash
 * mid-write leaves a file that exists and is full of garbage.
 */
export function writeWorkFile(stateDir: string, item: WorkItem): string {
  assertSafeId(item.id);
  const dir = join(stateDir, "work");
  mkdirSync(dir, { recursive: true });
  const final = join(dir, `${item.id}.json`);
  // Belt and braces: the id rule already forbids separators, and this is the
  // property that actually matters, asserted directly. The check this replaces
  // compared `replace(dir, "")` with `slice(dir.length)` - equal for EVERY
  // path, inside the directory or not - so it never threw and only read as a
  // guard. A real containment test is a prefix test on the resolved path.
  const resolvedDir = resolve(dir);
  if (!resolve(final).startsWith(`${resolvedDir}${sep}`)) {
    throw new Error(`refusing to write outside the work directory: ${item.id}`);
  }
  const tmp = `${final}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(item, null, 2)}\n`, "utf8");
  const fd = openSync(tmp, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, final);
  // fsync the DIRECTORY too, or the rename itself can be lost on power failure.
  const dfd = openSync(dir, "r");
  try {
    fsyncSync(dfd);
  } finally {
    closeSync(dfd);
  }
  return final;
}

/**
 * Propose work. A proposal is never runnable: it enters as `proposed` and only
 * the reconciler may promote it.
 *
 * That is the anti-loop mechanism and it is real enforcement, not a prompt: a
 * department cannot put itself on the run queue.
 */
export interface ProposeResult {
  readonly ok: boolean;
  readonly item?: WorkItem;
  readonly reason?: string;
}

export function propose(
  handle: WorkDb,
  fields: {
    readonly from: string;
    readonly to: string;
    readonly kind: string;
    readonly payload: string;
    readonly goal: string;
    readonly targetPaths?: readonly string[];
    readonly blastRadius?: number | undefined;
    readonly id?: string | undefined;
  },
): ProposeResult {
  // Validated up front, so a bad id is a clean error rather than a file written
  // somewhere unexpected later on.
  if (fields.id !== undefined) assertSafeId(fields.id);
  // Refusals, not throws: a proposal is data arriving from an agent's plan or
  // from the CLI, and "that is not a valid proposal" is an answer, not a crash.
  if (!SAFE_AGENT.test(fields.from) || !SAFE_AGENT.test(fields.to)) {
    return { ok: false, reason: `from and to must be department or worker names (got ${JSON.stringify(fields.from)} -> ${JSON.stringify(fields.to)})` };
  }
  if (!SAFE_KIND.test(fields.kind)) {
    return { ok: false, reason: `kind must be a short lowercase word (got ${JSON.stringify(fields.kind)})` };
  }
  if (fields.payload.length > MAX_PAYLOAD) {
    return { ok: false, reason: `payload is ${fields.payload.length} chars; the limit is ${MAX_PAYLOAD}` };
  }
  const targetPaths = fields.targetPaths ?? [];
  if (targetPaths.length > 64) {
    return { ok: false, reason: `${targetPaths.length} target paths; the limit is 64` };
  }
  try {
    for (const path of targetPaths) assertSafeTargetPath(path);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  const key = noveltyKey(fields.from, fields.goal, targetPaths);
  const existing = handle.db.query("SELECT * FROM work WHERE novelty_key = ?").get(key) as WorkItem | null;
  if (existing !== null) {
    return {
      ok: false,
      reason: `already proposed as ${existing.id} (state ${existing.state}); re-proposing identical work is refused`,
    };
  }
  // Non-finite or absurd radii are rejected rather than stored. `NaN` from
  // Number("abc") previously landed as NULL, which then passed every
  // comparison and silently dispatched global work without the CEO.
  const radius = fields.blastRadius;
  if (radius !== undefined && !Number.isInteger(radius)) {
    return { ok: false, reason: `blast radius must be a whole number 0, 1 or 2 (got ${String(radius)})` };
  }
  const id = fields.id ?? `w-${Date.now().toString(36)}-${key.slice(0, 6)}`;
  // The target paths are STORED, not just hashed into the novelty key.
  //
  // They were accepted and then discarded, so nothing downstream could read
  // them - which meant the blast radius had nothing to derive from and every
  // item looked self-contained. The payload becomes JSON only when there are
  // paths to carry, so the common case stays a plain readable string.
  const paths = targetPaths;
  // Redacted on the way IN: the ledger is a sink like the log, and a payload
  // routinely quotes the file it is about.
  const text = redact(fields.payload).text;
  const payload =
    paths.length === 0
      ? text
      : JSON.stringify({ text, targetPaths: paths });
  const item: WorkItem = {
    id,
    from_agent: fields.from,
    to_agent: fields.to,
    kind: fields.kind,
    payload,
    state: "proposed",
    lease_owner: null,
    lease_epoch: 0,
    attempts: 0,
    novelty_key: key,
    blast_radius: radius ?? null,
    reason: null,
    created_seq: 0,
    started_at: null,
  };
  try {
    handle.db.transaction(() => {
      const seq = nextSeq(handle.db);
      const stored: WorkItem = { ...item, created_seq: seq };
      handle.db
        .query(
          `INSERT INTO work (id, from_agent, to_agent, kind, payload, state, lease_owner, lease_epoch, attempts, novelty_key, blast_radius, reason, created_seq, started_at)
           VALUES (?, ?, ?, ?, ?, 'proposed', NULL, 0, 0, ?, ?, NULL, ?, NULL)`,
        )
        .run(
          stored.id,
          stored.from_agent,
          stored.to_agent,
          stored.kind,
          stored.payload,
          stored.novelty_key,
          stored.blast_radius,
          stored.created_seq,
        );
      // Deliberately NO file here. An earlier version wrote one at propose
      // time, and the reconciler used bare existsSync() as proof the work had
      // been paid for - so every CLAIMED item was marked done on the next tick
      // without running. Measured, not theoretical.
      //
      // The file is the record of a FINISHED result, written by commit().
    })();
  } catch (error) {
    // A UNIQUE violation here is a race with a concurrent proposer, which is
    // the same outcome as the check above and not a crash.
    return { ok: false, reason: `refused: ${(error as Error).message}` };
  }
  const stored = get(handle, id);
  return stored === null ? { ok: false, reason: "row vanished immediately after insert" } : { ok: true, item: stored };
}

/**
 * The state directory a handle was opened against, recovered from the database
 * file's own path rather than threaded through every call.
 */
function stateDirOf(handle: WorkDb): string {
  const path = (handle.db as unknown as { filename?: string }).filename ?? "";
  return path.replace(/[\\/]work[\\/]ledger\.sqlite$/, "");
}

export function get(handle: WorkDb, id: string): WorkItem | null {
  return (handle.db.query("SELECT * FROM work WHERE id = ?").get(id) as WorkItem | null) ?? null;
}

export function listWork(handle: WorkDb, state?: WorkState): WorkItem[] {
  return state === undefined
    ? (handle.db.query("SELECT * FROM work ORDER BY created_seq").all() as WorkItem[])
    : (handle.db.query("SELECT * FROM work WHERE state = ? ORDER BY created_seq").all(state) as WorkItem[]);
}

/**
 * Claim the next runnable item.
 *
 * One statement, one transaction. SQLite's write lock means exactly one caller
 * wins; the losers get an empty array and go away. `changes: 0` is not an
 * error, it is "there was nothing to take".
 */
export function claim(handle: WorkDb, owner: string, toAgent?: string): WorkItem | null {
  const rows = handle.db
    .query(
      `UPDATE work
          SET state = 'running',
              lease_owner = ?,
              lease_epoch = lease_epoch + 1,
              attempts = attempts + 1,
              started_at = ?
        WHERE id = (
          SELECT id FROM work
           WHERE state = 'ready' ${toAgent === undefined ? "" : "AND to_agent = ?"}
           ORDER BY created_seq
           LIMIT 1)
      RETURNING *`,
    )
    .all(...(toAgent === undefined ? [owner, Date.now()] : [owner, Date.now(), toAgent])) as WorkItem[];
  if (rows.length === 0) return null;
  return rows[0] ?? null;
}

/**
 * Claim ONE NAMED item, if it is runnable.
 *
 * `cod work run <id>` and the governance tick dispatch a specific item, and they
 * used to claim through `claim(owner, to_agent)` - "the oldest ready item for
 * this department". With two ready items for one department, running the second
 * claimed the FIRST: it was left `running` with nobody working on it until the
 * budget reclaimed it, while the second item's agent ran, finished, and had its
 * result fenced out for holding the wrong epoch. Measured before this existed.
 *
 * Same statement shape as `claim`, so the same write lock makes one caller win.
 */
export function claimById(handle: WorkDb, id: string, owner: string): WorkItem | null {
  const row = handle.db
    .query(
      `UPDATE work
          SET state = 'running',
              lease_owner = ?,
              lease_epoch = lease_epoch + 1,
              attempts = attempts + 1,
              started_at = ?
        WHERE id = ? AND state = 'ready'
      RETURNING *`,
    )
    .get(owner, Date.now(), id) as WorkItem | null;
  return row ?? null;
}

/**
 * Put a finished item back on the queue for another attempt.
 *
 * Only from `done`, and it consumes the epoch, so a run that is somehow still
 * holding the old one can never commit over the retry.
 */
export function requeue(handle: WorkDb, id: string): boolean {
  const row = handle.db
    .query("UPDATE work SET state = 'ready', lease_owner = NULL, lease_epoch = lease_epoch + 1 WHERE id = ? AND state = 'done' RETURNING id")
    .get(id) as { id: string } | null;
  return row !== null;
}

/**
 * How many times a RUN may fail before the item waits for a person.
 *
 * A run failure is usually the provider - free models fail a measurable share
 * of calls - so the first one is not a verdict on the work. The reconciler puts
 * the item back on the queue until this many consecutive runs have failed, and
 * then it stops and shows up in `cod work blocked`. Delivery is at-least-once,
 * which is the target docs/AGENT_COMMUNICATION.md set; never unbounded.
 */
export const MAX_RUN_ATTEMPTS = 3;

const RUN_FAILURE = /^run failed \((\d+)\/(\d+)\): /;

/** The attempt counter a run-failure reason carries, or null for any other reason. */
export function parseRunFailure(reason: string | null): { readonly n: number; readonly max: number } | null {
  const match = RUN_FAILURE.exec(reason ?? "");
  if (match === null) return null;
  return { n: Number(match[1]), max: Number(match[2]) };
}

/**
 * The reason to record for a failed run, counting CONSECUTIVE failures.
 *
 * The count lives in the reason because the reason is what the next attempt
 * replaces: a run that succeeds overwrites it and the count is gone, which is
 * exactly "consecutive".
 */
export function runFailureReason(previous: string | null, detail: string, max: number = MAX_RUN_ATTEMPTS): string {
  const prior = parseRunFailure(previous);
  const n = (prior?.n ?? 0) + 1;
  return `run failed (${n}/${max}): ${detail}`;
}

/** Will the reconciler retry this failed item on its own? */
export function isRetryableFailure(item: Pick<WorkItem, "state" | "reason">): boolean {
  if (item.state !== "failed") return false;
  const parsed = parseRunFailure(item.reason);
  return parsed !== null && parsed.n < parsed.max;
}

/** One review verdict, as recorded. The durable answer to "was this looked at". */
export interface ReviewRecord {
  readonly workId: string;
  /**
   * `cleared` is an ARCHIVED verdict, not a live one.
   *
   * A person unblocked the item; the row survives so the rejection can still be
   * read back. It is not a terminal state - landWork and the governance filter
   * both pass it through - but it is history, and `blockedWork` excludes it so a
   * cleared item leaves the queue.
   */
  readonly outcome: "landed" | "changes-requested" | "rejected" | "skipped" | "cleared";
  readonly reason: string;
  readonly branch: string;
  readonly landedSha: string;
  readonly reviewedAt: number;
  /** How many times this item has been sent back to the worker. Durable. */
  readonly attempts?: number;
}

/**
 * Record a review verdict, replacing any earlier one for the same item.
 *
 * An upsert rather than an append. The question being answered is "what is the
 * CURRENT state of this item", and the branch plus its commits are a strictly
 * better history than a second table would be.
 */
export function recordReview(
  handle: WorkDb,
  record: Omit<ReviewRecord, "reviewedAt"> & { readonly reviewedAt?: number },
): void {
  handle.db
    .query(
      `INSERT INTO review (work_id, outcome, reason, branch, landed_sha, reviewed_at, attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(work_id) DO UPDATE SET
         outcome = excluded.outcome,
         reason = excluded.reason,
         branch = excluded.branch,
         landed_sha = excluded.landed_sha,
         reviewed_at = excluded.reviewed_at,
         attempts = excluded.attempts`,
    )
    .run(
      record.workId,
      record.outcome,
      record.reason,
      record.branch,
      record.landedSha,
      record.reviewedAt ?? Date.now(),
      record.attempts ?? 0,
    );
}

/** The latest verdict for one item, or null if it has never been reviewed. */
export function latestReview(handle: WorkDb, workId: string): ReviewRecord | null {
  const row = handle.db
    .query(
      `SELECT work_id, outcome, reason, branch, landed_sha, reviewed_at, attempts
         FROM review WHERE work_id = ?`,
    )
    .get(workId) as
    | { work_id: string; outcome: string; reason: string; branch: string; landed_sha: string; reviewed_at: number; attempts?: number }
    | null;
  if (row === null) return null;
  return {
    workId: row.work_id,
    outcome: row.outcome as ReviewRecord["outcome"],
    reason: row.reason,
    branch: row.branch,
    landedSha: row.landed_sha,
    reviewedAt: row.reviewed_at,
    attempts: row.attempts ?? 0,
  };
}

/**
 * Items whose latest review needs a PERSON.
 *
 * The queue that did not exist. An autonomous company still has to be able to
 * say "I am stopping here, and this is why" - otherwise a rejection is
 * indistinguishable from nothing happening at all.
 */
export interface BlockedEntry {
  readonly item: WorkItem;
  /** `rejected`: a reviewer stopped it. `failed`: its runs did, and retries are spent. */
  readonly kind: "rejected" | "failed";
  /** The reviewer's words, or the last run's failure. */
  readonly reason: string;
  readonly branch: string;
  /** When it stopped, for oldest-first order. */
  readonly since: number;
  /** The review row, when a reviewer stopped it. */
  readonly review: ReviewRecord | null;
}

/**
 * Items that stopped and need a PERSON, oldest first.
 *
 * Two kinds. A review rejection, as before - and a run that FAILED with no
 * automatic retry left. The second used to be invisible: a failed item was not
 * in this queue and not in `cod status`, so an operator was told "nothing is
 * waiting on you" while work sat dead in the ledger.
 */
export function blockedWork(handle: WorkDb): BlockedEntry[] {
  const rejected = (handle.db
    .query(
      `SELECT w.* FROM work w
         JOIN review r ON r.work_id = w.id
        WHERE r.outcome = 'rejected'`,
    )
    .all() as WorkItem[]).map((item): BlockedEntry => {
    const review = latestReview(handle, item.id) as ReviewRecord;
    return { item, kind: "rejected", reason: review.reason, branch: review.branch, since: review.reviewedAt, review };
  });
  const failed = (handle.db.query("SELECT * FROM work WHERE state = 'failed'").all() as WorkItem[])
    .filter((item) => !isRetryableFailure(item))
    .map((item): BlockedEntry => ({
      item,
      kind: "failed",
      reason: item.reason ?? "failed with no reason recorded",
      branch: `cod/${item.id}`,
      since: item.started_at ?? 0,
      review: latestReview(handle, item.id),
    }));
  return [...rejected, ...failed].sort((a, b) => a.since - b.since);
}

/**
 * A person's decision to look at a rejected item again.
 *
 * MANUAL on purpose. An automatic clear would let a rejected item re-enter the
 * queue on its own, which is the company arguing with itself.
 *
 * Refused for a LANDED item: that work is already in master, and un-blocking it
 * would put it back in the queue to be merged on top of itself.
 *
 * The reason is written onto the item, so the next rejection does not look like
 * the first. A ledger that simply forgets is how the same mistake gets made
 * twice and looks like new information the second time.
 */
export function clearReview(
  handle: WorkDb,
  id: string,
  note: string,
  override = false,
): { ok: boolean; reason?: string } {
  // A FAILED item has no verdict to archive: its runs stopped it. Unblocking it
  // puts it back on the queue for a fresh run, with the operator's note as its
  // reason, which also resets the consecutive-failure count.
  const current = get(handle, id);
  if (current !== null && current.state === "failed") {
    const why = note.trim() === "" ? "no reason given" : note.trim();
    handle.db
      .query("UPDATE work SET state = 'ready', lease_owner = NULL, reason = ? WHERE id = ? AND state = 'failed'")
      .run(ledgerText(`unblocked by operator: ${why} | was failed: ${current.reason ?? "no reason recorded"}`), id);
    return { ok: true };
  }
  const previous = latestReview(handle, id);
  if (previous === null) return { ok: false, reason: `no review to clear for ${id}` };
  if (previous.outcome === "landed") {
    return { ok: false, reason: `${id} was already LANDED (${previous.landedSha || "no sha"}); clearing it would merge it twice` };
  }
  // A LIVE objection cannot be cleared quietly.
  //
  // `request-changes` means the worker still owes a fix and the loop is waiting
  // for it. Clearing that silently is a side door around the loop: the
  // objection is not fixed, it is forgotten, and the record afterwards reads as
  // though the reviewer had accepted the work.
  //
  // Found by Alex. The override exists because there are legitimate reasons -
  // the reviewer is simply wrong about this one - but a human overriding a
  // review is an EVENT, and it is written into the archive as one.
  if (previous.outcome === "changes-requested" && !override) {
    return {
      ok: false,
      reason:
        `${id} is MID-RETRY: the reviewer is still asking for changes - "${previous.reason}". ` +
        `Either let the worker fix it, or pass --override to say you checked it yourself.`,
    };
  }

  // Refused rather than allowed: clearing something already cleared would
  // archive the operator's OWN note instead of the verdict, and the second note
  // would be lost with the error message nobody reads.
  if (previous.outcome === "cleared") {
    return { ok: false, reason: `${id} was already cleared: ${previous.reason}` };
  }

  // ARCHIVE, not delete.
  //
  // This used to be `DELETE FROM review`, which made an unblocked item
  // indistinguishable from a brand new one - after `cod work unblock` there was
  // no way left to ask whether the item had ever been rejected, which is the
  // single question an audit trail exists to answer. The row survives, carrying
  // both the verdict it was cleared from and the operator's reason.
  const operatorNote = note.trim() === "" ? "cleared by operator" : `cleared by operator: ${note.trim()}`;
  handle.db
    .query("UPDATE review SET outcome = 'cleared', reason = ? WHERE work_id = ?")
    .run(
      ledgerText(`${override ? "OPERATOR OVERRIDE of the reviewer" : "cleared by operator"}: ${note.trim() || "no reason given"} | was ${previous.outcome}: ${previous.reason}`),
      id,
    );
  handle.db.query("UPDATE work SET reason = ? WHERE id = ?").run(ledgerText(operatorNote), id);
  return { ok: true };
}

/**
 * Refuse an item that never ran. Distinct from `failed`, which means work RAN
 * and did not succeed - a refused item never ran at all, and collapsing the two
 * loses the difference between "this was attempted" and "this was not
 * permitted".
 *
 * Only from `proposed` or `ready`. Refusing running or finished work would
 * rewrite the record of something that happened.
 */
export function reject(handle: WorkDb, id: string, reason: string): CommitOutcome {
  const result = handle.db
    .query("UPDATE work SET state = 'rejected', reason = ?, lease_owner = NULL WHERE id = ? AND state IN ('proposed', 'ready') RETURNING *")
    .get(ledgerText(reason), id) as WorkItem | null;
  if (result === null) {
    const current = get(handle, id);
    return {
      ok: false,
      fenced: false,
      item: current,
      reason: current === null ? "no such work item" : `cannot refuse ${id}: it is ${current.state}, and only work that never ran can be refused`,
    };
  }
  return { ok: true, fenced: false, item: result };
}

/**
 * Commit a result, fenced.
 *
 * `lease_epoch = ?` is the whole point: a zombie holding a stale epoch updates
 * zero rows, and its write is rejected rather than overwriting a newer result.
 */
export interface CommitOutcome {
  readonly ok: boolean;
  readonly fenced: boolean;
  readonly item: WorkItem | null;
  readonly reason?: string;
}

export function commit(handle: WorkDb, id: string, leaseEpoch: number, outcome: "done" | "failed", reason?: string): CommitOutcome {
  // Bounded and redacted ONCE, here, so the file and the row cannot disagree.
  const recorded = reason === undefined ? null : ledgerText(reason);
  // The durable record is written BEFORE the row is updated, and only here.
  // That ordering is the whole recovery story: if the process dies between the
  // two, the file is on disk and the reconciler can apply it. Writing it any
  // earlier would make a file's existence meaningless.
  const existing = get(handle, id);
  if (existing !== null && existing.lease_epoch === leaseEpoch && existing.state === "running") {
    try {
      writeWorkFile(stateDirOf(handle), {
        ...existing,
        state: outcome,
        reason: recorded,
      });
    } catch {
      // A file we cannot write must not block the commit; the row is the
      // coordination truth and the file is the durable one. Losing the file
      // degrades recovery, it does not corrupt state.
    }
  }

  // lease_epoch is BUMPED here, and that is load-bearing twice over.
  //
  //  - It CONSUMES the epoch. A retried ack or a second writer holding the same
  //    epoch now matches zero rows instead of overwriting the first result.
  //  - It makes a RECLAIM fence the worker it reclaimed. A worker that overran
  //    its budget was never killed; without this bump it still held a valid
  //    epoch and could overwrite the reclaim verdict with its own success.
  //
  // `state = 'running'` is the other half of the fence. Without it, an item
  // that was never claimed could be committed: a `proposed` row sits at epoch
  // 0, so `cod work commit <id> --epoch 0` marked a proposal `done` - past the
  // CEO, past the claim, past the run - and the governance tick then offered it
  // for landing. Only work that is running can finish.
  const result = handle.db
    .query(
      "UPDATE work SET state = ?, reason = ?, lease_owner = NULL, lease_epoch = lease_epoch + 1 WHERE id = ? AND lease_epoch = ? AND state = 'running' RETURNING *",
    )
    .get(outcome, recorded, id, leaseEpoch) as WorkItem | null;
  if (result === null) {
    const current = get(handle, id);
    if (current === null) return { ok: false, fenced: true, item: null, reason: "no such work item" };
    if (current.lease_epoch !== leaseEpoch) {
      return {
        ok: false,
        fenced: true,
        item: current,
        reason: `fenced: lease_epoch ${leaseEpoch} is stale (current ${current.lease_epoch}); a newer run owns this item`,
      };
    }
    return {
      ok: false,
      fenced: true,
      item: current,
      reason: `${id} is ${current.state}, not running: only claimed work can be committed`,
    };
  }
  return { ok: true, fenced: false, item: result };
}
