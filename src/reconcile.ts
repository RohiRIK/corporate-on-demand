/**
 * The reconciler: the CEO's loop.
 *
 * LEVEL-TRIGGERED, not edge-triggered - the transferable idea from a Kubernetes
 * controller. It does not wait to be told what changed. Every tick it re-reads
 * the current state and converges on the desired state, so an event that was
 * missed while the process was dead self-heals on the next tick instead of
 * being lost for ever.
 *
 * The consequence, and it is the reason this is a function over rows rather
 * than a callback: anything edge-triggered - a "worker finished" hook - would
 * be decoration. The loop re-derives truth every pass regardless.
 *
 * It must therefore be IDEMPOTENT. Cron fires it on a timer whether or not the
 * last tick did anything, so running it twice must equal running it once.
 *
 * Four responsibilities, in order:
 *
 *  1. Promote or reject proposals. Self-proposed work enters as `proposed` and
 *     THIS is the only thing that may make it runnable. A department cannot put
 *     itself on the queue.
 *  2. Fail anything running past its budget. A per-item Start-To-Close timeout,
 *     never a global one - a single global threshold either kills legitimate
 *     slow work or tolerates a hung job, and usually does both.
 *  3. Resolve work that finished but whose acknowledgement was lost. If the
 *     result file exists and the row says otherwise, the file wins: the work
 *     was paid for, so it is reconciled by READING it, never by re-running it.
 *  4. Report, and do nothing else.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claim, commit, get, listWork, openWork, reject, type WorkDb, type WorkItem } from "./work";
import { radiusForWork, targetPathsOfItem } from "./runwork";

/** Default per-item budget. Generous, because the cost of a wrong timeout is asymmetric. */
export const DEFAULT_BUDGET_MS = 300_000;

export interface ReconcileOptions {
  readonly stateDir: string;
  readonly now?: number;
  /** Who is reconciling. Named because the record must say who acted. */
  readonly actor: string;
  readonly budgetMs?: number;
  /** An open handle, when the caller already has one. */
  readonly handle?: WorkDb;
}

export interface ReconcileReport {
  readonly promoted: string[];
  readonly rejected: string[];
  readonly expired: string[];
  readonly resolved: string[];
  unchanged: number;
  readonly errors: string[];
}

/**
 /**
  * Global work is not runnable by a department, whatever it proposed.
  *
  * DERIVED from the target paths, not read from the row. The row's own
  * `blast_radius` is filled in by the proposing agent, so trusting it here would
  * mean the rule once again constrains the thing it constrains - an agent
  * wanting a global change simply writes 0.
  */
 function derivedRadius(item: WorkItem): number {
   return radiusForWork(item.payload, targetPathsOfItem(item), item.blast_radius);
 }

 /**
 * Does this proposal need the CEO?
 *
 * DERIVED, not read from the row. The row's own `blast_radius` is filled in by
 * the proposing agent, so trusting it means the rule once again constrains the
 * thing it constrains - an agent wanting a global change simply writes 0.
 *
 * The old predicate is kept for the row's declared value, because it is still
 * the reason recorded alongside the decision.
 */
export function needsCeo(item: WorkItem): boolean {
  return derivedRadius(item) >= 2;
}

/** Is a proposal addressed to an agent that exists? Kept pluggable for tests. */
export type AddresseeCheck = (toAgent: string) => boolean;

const defaultAddresseeCheck: AddresseeCheck = (): boolean => true;

/**
 * One pass. Pure over rows, so it is testable without a clock and without a
 * container - which matches the style of every other module here.
 */
export function reconcileOnce(options: ReconcileOptions, addresseeOk: AddresseeCheck = defaultAddresseeCheck): ReconcileReport {
  const now = options.now ?? Date.now();
  const budget = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const owned = options.handle === undefined;
  const handle = options.handle ?? openWork(options.stateDir);
  const report: ReconcileReport = { promoted: [], rejected: [], expired: [], resolved: [], unchanged: 0, errors: [] };

  try {
    for (const item of listWork(handle, "proposed")) {
      try {
        // A proposal that outlived the budget it was waiting for is not
        // urgent work, it is a stale idea. Failing it keeps the queue honest.
        if (!addresseeOk(item.to_agent)) {
          const outcome = reject(handle, item.id, `unknown addressee: ${item.to_agent}`);
          if (outcome.ok) report.rejected.push(item.id);
          else report.errors.push(`${item.id}: ${outcome.reason ?? "fenced"}`);
          continue;
        }
        // Global work is not runnable by a department, whatever it proposed.
        if (needsCeo(item) || derivedRadius(item) >= 2) {
          const outcome = reject(handle, item.id, "blast radius is global; the CEO must dispatch this itself");
          if (outcome.ok) report.rejected.push(item.id);
          else report.errors.push(`${item.id}: ${outcome.reason ?? "fenced"}`);
          continue;
        }
        handle.db.query("UPDATE work SET state = 'ready' WHERE id = ? AND state = 'proposed'").run(item.id);
        report.promoted.push(item.id);
      } catch (error) {
        report.errors.push(`${item.id}: ${(error as Error).message}`);
      }
    }

    for (const item of listWork(handle, "running")) {
      try {
        // Per item, measured from the moment it was claimed. An item with no
        // recorded start is left alone rather than guessed at: failing work on
        // a fabricated timestamp is worse than waiting one more tick for it.
        const started = item.started_at;
        if (started !== null && now - started > budget) {
          const outcome = commit(handle, item.id, item.lease_epoch, "failed", `exceeded its ${budget}ms budget and was reclaimed by ${options.actor}`);
          if (outcome.ok) report.expired.push(item.id);
          else report.errors.push(`${item.id}: ${outcome.reason ?? "fenced"}`);
        } else {
          report.unchanged += 1;
        }
      } catch (error) {
        report.errors.push(`${item.id}: ${(error as Error).message}`);
      }
    }

    // "Work was paid for but the ack was lost" - resolved by reading the file,
    // never by re-running it.
    //
    // The file must be PARSED, and its recorded outcome trusted only when it
    // actually describes a finished result. An earlier version used bare
    // existsSync(), and because propose() also wrote a file, every claimed item
    // was reported `done` on the next tick having done no work at all. A file
    // only exists once commit() has written it, which is what makes its
    // existence meaningful in the first place.
    for (const item of listWork(handle, "running")) {
      const file = join(options.stateDir, "work", `${item.id}.json`);
      let recorded: { state?: string } | null = null;
      try {
        recorded = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { state?: string }) : null;
      } catch {
        // Unreadable or half-written: not evidence of anything. Leave it alone;
        // the budget rule will reclaim it.
        recorded = null;
      }
      if (recorded === null) continue;
      if (recorded.state !== "done" && recorded.state !== "failed") {
        // A file that does not describe a finished result is not an ack.
        report.unchanged += 1;
        continue;
      }
      const outcome = commit(
        handle,
        item.id,
        item.lease_epoch,
        recorded.state,
        "recovered from a durable result file after a lost acknowledgement",
      );
      if (outcome.ok) report.resolved.push(item.id);
      else report.errors.push(`${item.id}: ${outcome.reason ?? "fenced"}`);
    }
  } finally {
    if (owned) handle.close();
  }

  return report;
}

/** Human summary, one line per thing that actually happened. */
export function formatReport(report: ReconcileReport): string[] {
  const lines: string[] = [];
  for (const id of report.promoted) lines.push(`promoted ${id} to ready`);
  for (const id of report.rejected) lines.push(`rejected ${id}`);
  for (const id of report.expired) lines.push(`reclaimed ${id}: over budget`);
  for (const id of report.resolved) lines.push(`recovered ${id} from its result file`);
  if (lines.length === 0) lines.push(`nothing to do (${report.unchanged} item(s) still running)`);
  for (const error of report.errors) lines.push(`ERROR ${error}`);
  return lines;
}

export { claim, get };
