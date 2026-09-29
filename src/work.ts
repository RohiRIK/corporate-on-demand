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
import { join } from "node:path";
import { createHash } from "node:crypto";

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
CREATE TABLE IF NOT EXISTS epoch (n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

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
  database.run("PRAGMA journal_mode = WAL");
  // A second writer should wait rather than throw; the gate is the write lock,
  // and busy is a normal transient state here, not an error.
  database.run("PRAGMA busy_timeout = 5000");
  database.run("PRAGMA foreign_keys = ON");
  database.run(SCHEMA);
  if (database.query("SELECT n FROM epoch").get() === null) {
    database.run("INSERT INTO epoch (n) VALUES (0)");
  }
  if (database.query("SELECT v FROM meta WHERE k = 'created_seq'").get() === null) {
    database.run("INSERT INTO meta (k, v) VALUES ('created_seq', '0')");
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
 * Write the durable record for a unit of work.
 *
 * tmp -> fsync(file) -> rename() -> fsync(dir), the standard recipe, and the
 * reason a reader NEVER sees a half-written message. Without the rename a crash
 * mid-write leaves a file that exists and is full of garbage.
 */
export function writeWorkFile(stateDir: string, item: WorkItem): string {
  const dir = join(stateDir, "work");
  mkdirSync(dir, { recursive: true });
  const final = join(dir, `${item.id}.json`);
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
  const key = noveltyKey(fields.from, fields.goal, fields.targetPaths ?? []);
  const existing = handle.db.query("SELECT * FROM work WHERE novelty_key = ?").get(key) as WorkItem | null;
  if (existing !== null) {
    return {
      ok: false,
      reason: `already proposed as ${existing.id} (state ${existing.state}); re-proposing identical work is refused`,
    };
  }
  const id = fields.id ?? `w-${Date.now().toString(36)}-${key.slice(0, 6)}`;
  const item: WorkItem = {
    id,
    from_agent: fields.from,
    to_agent: fields.to,
    kind: fields.kind,
    payload: fields.payload,
    state: "proposed",
    lease_owner: null,
    lease_epoch: 0,
    attempts: 0,
    novelty_key: key,
    blast_radius: fields.blastRadius ?? null,
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
      writeWorkFile(stateDirOf(handle), stored);
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
  const result = handle.db
    .query("UPDATE work SET state = ?, reason = ?, lease_owner = NULL WHERE id = ? AND lease_epoch = ? RETURNING *")
    .get(outcome, reason ?? null, id, leaseEpoch) as WorkItem | null;
  if (result === null) {
    const current = get(handle, id);
    return {
      ok: false,
      fenced: true,
      item: current,
      reason:
        current === null
          ? "no such work item"
          : `fenced: lease_epoch ${leaseEpoch} is stale (current ${current.lease_epoch}); a newer run owns this item`,
    };
  }
  return { ok: true, fenced: false, item: result };
}
