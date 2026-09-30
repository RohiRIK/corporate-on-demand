/**
 * A cycle of the company, with nobody watching.
 *
 * Until this existed, `propose()` had exactly one caller: a human typing a CLI
 * command. The ledger, the reconciler, the fencing and the novelty guard were
 * all real, all tested, and all waiting for a caller that never came. That is
 * the same shape as a registry with no callers - working code that the system
 * does not use.
 *
 * The separation that matters: this file PROPOSES and does not dispatch.
 *
 * A department working toward its own standing purpose is the whole point of a
 * department, and self-grading is only defensible because the CEO consolidates
 * and the meeting pushes back. So a department may bring work to the CEO; it
 * may not start it. Every proposal is addressed to `ceo`, which also means no
 * department can ever propose something global and be quietly refused later.
 *
 * In-process and in-memory: a cycle that loses its own proposals between runs
 * costs one cycle of work, and the ledger is the durable record. A second
 * source of truth here would be a liability.
 */

import { openWork, propose as proposeWork, type WorkItem } from "./work";
import { reconcileOnce, type ReconcileReport } from "./reconcile";
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
  readonly summary: string;
}

/**
 * What one department should work on next.
 *
 * Derived from the department's own `purpose`. Not a template list: a
 * department with no purpose proposes nothing, because work anchored to
 * nothing is what the novelty guard can only ever catch byte-identical repeats
 * of.
 */
export function planDepartmentWork(workspace: Workspace, stateDir: string): PlannedWork[] {
  const handle = openWork(stateDir);
  const planned: PlannedWork[] = [];
  try {
    for (const department of workspace.departments) {
      const purpose = (department.purpose ?? "").trim();
      // No purpose, no work. Not a placeholder item - an item nobody can judge
      // is worse than no item, because it looks like progress.
      if (purpose === "") continue;
      if (department.workers.length === 0) continue;

      const goal = `${department.name}: advance "${purpose}"`;
      const payload = [
        `You are the ${department.name} department of ${workspace.company.name}.`,
        `Your department exists to: ${purpose}`,
        "",
        "Look at the current state of the work volume and decide the single most",
        "useful thing to do next that moves that purpose forward.",
        "Propose it in one or two sentences, name the files you expect to touch,",
        "and say how you would know it worked. Do not ask questions.",
        "Do not push or merge anything.",
      ].join("\\n");

      const made = proposeWork(handle, {
        from: department.name,
        // The CEO, always. A department brings work TO the CEO.
        to: "ceo",
        kind: "task",
        payload,
        goal,
        // No target paths: the department has not looked yet, so its radius is
        // the narrowest and the CEO widens it if the work needs it.
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
  options: { readonly actor: string },
): CycleResult {
  let planned: PlannedWork[] = [];
  let reconciled: ReconcileReport = { promoted: [], rejected: [], expired: [], resolved: [], unchanged: 0, errors: [] };

  try {
    planned = planDepartmentWork(workspace, stateDir);
    reconciled = reconcileOnce({ stateDir, actor: options.actor });
  } catch (error) {
    // A cycle that vanishes is how a schedule becomes untrustworthy, so the
    // failure is reported rather than thrown into a timer that swallows it.
    return {
      proposed: [],
      duplicates: 0,
      reconciled,
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
  if (reconciled.errors.length > 0) parts.push(`${reconciled.errors.length} error(s)`);

  return { proposed: planned, duplicates: 0, reconciled, summary: parts.join("; ") };
}

function openCount(handle: { db: { query: (sql: string) => { all: () => unknown[] } } }): number {
  return handle.db.query("SELECT id FROM work WHERE state IN ('ready','proposed')").all().length;
}

export type { WorkItem };
