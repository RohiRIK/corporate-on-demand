/**
 * A cycle of the company, with nobody watching.
 *
 * Until this existed, `propose()` had exactly one caller: a human typing a CLI
 * command. The ledger, the reconciler, the fencing and the novelty guard were
 * all real, all tested, and all waiting for a caller that never came.
 *
 * The separation that matters: this file PROPOSES and does not dispatch. A
 * department may bring work to the CEO; it may not start it. Every proposal is
 * addressed to `ceo`.
 *
 * What a department proposes is a PLAN - "decide the next concrete step toward
 * our purpose" - and the plan's answer becomes a task (src/plan.ts). Two rules
 * keep that from running away with nobody watching:
 *
 *  - ONE THING AT A TIME. A department plans again only when nothing of its own
 *    is open: no proposal waiting, nothing ready or running, no finished task
 *    still waiting for review, no failed run still due a retry. That is what
 *    makes a department iterate rather than flood the ledger - and it replaces
 *    the accident that used to stop it: the plan's goal never changed, so the
 *    novelty key refused it after the first time, and the company did one round
 *    of work in its lifetime.
 *  - THREE STRIKES. When a department's last three tasks all ended badly -
 *    rejected by review, failed with no retry left, or refused by rule - it stops
 *    proposing until a person looks. An unattended company that keeps producing
 *    work nobody accepts is a company arguing with itself.
 *  - REST. A department whose plans keep finding nothing new - "GOAL: none", or
 *    a task that already exists - rests before it plans again, twice as long
 *    after each empty plan, up to a day. It used to plan every cycle for ever:
 *    model calls to hear "nothing", and ledger rows nothing ever prunes.
 */

import { openWork, propose as proposeWork, listWork, latestReview, isRetryableFailure, type WorkDb, type WorkItem } from "./work";
import { reconcileOnce, type ReconcileReport } from "./reconcile";
import { planningPrompt } from "./plan";
import type { Workspace } from "./workspace";

export interface PlannedWork {
  readonly from: string;
  readonly to: string;
  readonly goal: string;
  readonly payload: string;
}

export interface CycleResult {
  readonly proposed: readonly PlannedWork[];
  /** Items the ledger refused as duplicates of what already exists. */
  readonly duplicates: number;
  readonly reconciled: ReconcileReport;
  /** Departments that did not plan this cycle, and why. */
  readonly held?: readonly { readonly department: string; readonly reason: string }[];
  readonly summary: string;
}

/** How many consecutive bad outcomes stop a department proposing. */
export const MAX_STRIKES = 3;

/** The governance interval when cod.json names none. */
export const DEFAULT_CYCLE_MINUTES = 30;

/** The longest a department rests between empty plans. */
export const MAX_REST_MINUTES = 24 * 60;

/**
 * The company's cycle length in minutes, whether or not governance is on: a
 * hand-run `cod cycle` rests a department on the same clock as the schedule.
 */
export function cycleMinutesFor(workspace: Workspace): number {
  const wanted = (workspace as { governance?: { cycleEveryMinutes?: number } }).governance?.cycleEveryMinutes;
  if (typeof wanted !== "number" || !Number.isFinite(wanted) || wanted <= 0) return DEFAULT_CYCLE_MINUTES;
  return Math.floor(wanted);
}

/**
 * A plan that produced nothing new: "GOAL: none", work that already existed, or
 * an answer that could not be read even on its last retry. A planner that
 * cannot plan is no busier than one with nothing to do, and must not re-plan
 * every tick either.
 */
export function isIdlePlan(item: WorkItem): boolean {
  if (item.kind !== "plan" || item.from_agent !== "ceo") return false;
  if (item.state === "failed") return !isRetryableFailure(item);
  if (item.state !== "done") return false;
  const reason = item.reason ?? "";
  return reason.startsWith("planned nothing") || reason.startsWith("planned work that already exists");
}

/**
 * Until when a department rests, in epoch ms, or null when it may plan now.
 *
 * Two cycles after one empty plan, doubling with each further one, capped at a
 * day. The first plan that finds something resets it, because only an unbroken
 * run of empty plans counts.
 */
export function departmentRestUntil(department: string, items: readonly WorkItem[], cycleMinutes: number): number | null {
  const plans = items
    .filter((w) => w.kind === "plan" && w.from_agent === "ceo" && w.to_agent === department && (w.state === "done" || w.state === "failed"))
    .sort((a, b) => b.created_seq - a.created_seq);
  let empty = 0;
  for (const plan of plans) {
    if (!isIdlePlan(plan)) break;
    empty += 1;
  }
  const ranAt = plans[0]?.started_at ?? null;
  if (empty === 0 || ranAt === null) return null;
  return ranAt + Math.min(cycleMinutes * 2 ** empty, MAX_REST_MINUTES) * 60_000;
}

function mine(items: readonly WorkItem[], department: string): WorkItem[] {
  return items.filter((w) => w.from_agent === department || w.to_agent === department);
}

/**
 * Is anything of this department's still in motion?
 *
 * In motion means it will move again without a person: a proposal waiting, an
 * item ready or running, a finished task not yet judged, a failed run with a
 * retry left. A terminal outcome - landed, rejected, refused, retries spent -
 * is not in motion.
 */
export function departmentBusy(handle: WorkDb, department: string, items: readonly WorkItem[] = listWork(handle)): boolean {
  return mine(items, department).some((w) => {
    if (w.state === "proposed" || w.state === "ready" || w.state === "running") return true;
    if (w.state === "failed") return isRetryableFailure(w);
    if (w.state === "done" && w.kind !== "plan" && w.to_agent !== "ceo") {
      const outcome = latestReview(handle, w.id)?.outcome;
      return outcome !== "landed" && outcome !== "rejected";
    }
    return false;
  });
}

/** Did this department's last MAX_STRIKES tasks all end badly? */
export function departmentStruckOut(handle: WorkDb, department: string, items: readonly WorkItem[] = listWork(handle)): boolean {
  const tasks = items
    .filter((w) => w.from_agent === department && w.kind === "task")
    .sort((a, b) => b.created_seq - a.created_seq)
    .slice(0, MAX_STRIKES);
  if (tasks.length < MAX_STRIKES) return false;
  return tasks.every((w) => {
    if (w.state === "rejected") return true;
    if (w.state === "failed") return !isRetryableFailure(w);
    return w.state === "done" && latestReview(handle, w.id)?.outcome === "rejected";
  });
}

/**
 * What each department should work on next, as a plan for the CEO.
 *
 * Derived from the department's own `purpose`. A department with no purpose
 * proposes nothing: an item nobody can judge is worse than no item.
 */
export function planDepartmentWork(
  workspace: Workspace,
  stateDir: string,
  held: { department: string; reason: string }[] = [],
  now: number = Date.now(),
): PlannedWork[] {
  const handle = openWork(stateDir);
  const planned: PlannedWork[] = [];
  try {
    const items = listWork(handle);
    for (const department of workspace.departments) {
      const purpose = (department.purpose ?? "").trim();
      if (purpose === "") continue;
      if (department.workers.length === 0) continue;
      if (departmentBusy(handle, department.name, items)) continue;
      if (departmentStruckOut(handle, department.name, items)) {
        held.push({
          department: department.name,
          reason: `its last ${MAX_STRIKES} tasks all ended badly; see \`cod work blocked\``,
        });
        continue;
      }
      const restUntil = departmentRestUntil(department.name, items, cycleMinutesFor(workspace));
      if (restUntil !== null && now < restUntil) {
        held.push({
          department: department.name,
          // Rounded UP to the minute: a rest that ends at :12 is still on at :00.
          reason: `resting until ${new Date(Math.ceil(restUntil / 60_000) * 60_000).toISOString().slice(0, 16)}Z: its last plans found nothing new`,
        });
        continue;
      }

      // The generation makes each plan new work. The novelty key still refuses
      // an identical repeat - two plans of the same generation - which is the
      // race it exists for.
      const generation = 1 + items.filter((w) => w.from_agent === department.name && w.kind === "plan").length;
      const goal = `${department.name}: plan ${generation} toward "${purpose}"`;
      const payload = planningPrompt(department.name, workspace.company.name, purpose);

      const made = proposeWork(handle, {
        from: department.name,
        // The CEO, always. A department brings work TO the CEO.
        to: "ceo",
        kind: "plan",
        payload,
        goal,
        // No target paths: a plan only reads. Its TASK names the paths, and
        // the radius is derived from those.
        targetPaths: [],
        blastRadius: 0,
      });

      // `ok: false` here means the novelty guard refused a duplicate. That is
      // the guard working, not an error.
      if (made.ok && made.item !== undefined) {
        planned.push({ from: department.name, to: "ceo", goal, payload });
      }
    }
  } finally {
    handle.close();
  }
  return planned;
}

/**
 * One full cycle: propose, then reconcile.
 *
 * Reconcile runs in the same pass because a proposal that is never reconciled
 * stays `proposed` forever and is invisible - and an item that never becomes
 * `ready` is one the CEO can never dispatch.
 */
export function runCycle(
  workspace: Workspace,
  stateDir: string,
  options: { readonly actor: string; readonly now?: number },
): CycleResult {
  let planned: PlannedWork[] = [];
  const held: { department: string; reason: string }[] = [];
  let reconciled: ReconcileReport = { promoted: [], rejected: [], expired: [], resolved: [], retried: [], unchanged: 0, errors: [] };

  try {
    planned = planDepartmentWork(workspace, stateDir, held, options.now ?? Date.now());
    reconciled = reconcileOnce({ stateDir, actor: options.actor });
  } catch (error) {
    // A cycle that vanishes is how a schedule becomes untrustworthy, so the
    // failure is reported rather than thrown into a timer that swallows it.
    return {
      proposed: [],
      duplicates: 0,
      reconciled,
      held,
      summary: `cycle failed: ${(error as Error).message}`,
    };
  }

  const outstanding = ((): number => {
    const handle = openWork(stateDir);
    try {
      return openCount(handle);
    } finally {
      handle.close();
    }
  })();

  const parts = [
    `proposed ${planned.length}`,
    `${outstanding} outstanding`,
    `${reconciled.promoted.length} promoted to ready`,
    `${reconciled.rejected.length} rejected`,
  ];
  if (reconciled.resolved.length > 0) parts.push(`${reconciled.resolved.length} resolved from a durable result`);
  if (reconciled.expired.length > 0) parts.push(`${reconciled.expired.length} lease(s) expired`);
  if (reconciled.retried.length > 0) parts.push(`${reconciled.retried.length} failed run(s) retried`);
  if (reconciled.errors.length > 0) parts.push(`${reconciled.errors.length} error(s)`);
  for (const h of held) parts.push(`${h.department} held: ${h.reason}`);

  return { proposed: planned, duplicates: 0, reconciled, held, summary: parts.join("; ") };
}

function openCount(handle: { db: { query: (sql: string) => { all: () => unknown[] } } }): number {
  return handle.db.query("SELECT id FROM work WHERE state IN ('ready','proposed')").all().length;
}

export type { WorkItem };
