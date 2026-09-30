/**
 * Deciding WHO runs a piece of work.
 *
 * A ledger item is addressed to a DEPARTMENT - "engineering" - because that is
 * the unit that has authority to accept work. A WORKER is what actually runs.
 * Something has to bridge the two, and the thing that was doing it was:
 *
 *     departments.flatMap(d => d.workers).find(w => w.name === item.to_agent)
 *
 * which is always `undefined` for a department addressee, because the worker
 * is called "builder". So `writeInstructions` was skipped, and a real model ran
 * in the work volume with no operating rules, no purpose, and no blast radius.
 *
 * It survived because the JOB SUCCEEDED. The agent was competent enough to
 * create the file without being told it could - which is precisely how a
 * missing prompt stays invisible: the output looks right.
 *
 * The rule here: an addressee that resolves to nothing is an ERROR, never a
 * "run it anyway". Running with no instructions is the worst default available,
 * and it is the one this file exists to remove.
 */

import type { Workspace, Department, Worker } from "./workspace";

export interface Target {
  readonly worker: Worker | undefined;
  readonly department: Department | undefined;
  /** True when the item named a department and a worker was chosen from it. */
  readonly addressedToDepartment: boolean;
  /** Why this worker, when the choice was made rather than given. */
  readonly note?: string;
  /** Set when the addressee matched nothing. Never leave the caller guessing. */
  readonly reason?: string;
}

export function resolveTarget(workspace: Workspace, toAgent: string): Target {
  // A worker name wins over a same-named department. "cto" is both; either
  // reading runs the same agent, so this is not a coin flip - but resolving to
  // the worker means the note is never a lie about a hand-off.
  for (const department of workspace.departments) {
    const byWorker = department.workers.find((w) => w.name === toAgent);
    if (byWorker !== undefined) return { worker: byWorker, department, addressedToDepartment: false };
  }

  // A department. Its FIRST worker takes it - the department self-organises,
  // and until it does that choosing, the order in cod.json is the order.
  const department = workspace.departments.find((d) => d.name === toAgent);
  if (department !== undefined) {
    const worker = department.workers[0];
    if (worker !== undefined) {
      return {
        worker,
        department,
        addressedToDepartment: true,
        note: `${department.name} dispatched to ${department.name}/${worker.name} (its first worker)`,
      };
    }
    return {
      worker: undefined,
      department,
      addressedToDepartment: true,
      reason: `department ${department.name} has no workers, so nothing can run this`,
    };
  }

  return {
    worker: undefined,
    department: undefined,
    addressedToDepartment: false,
    reason: `no worker or department named "${toAgent}" in this workspace`,
  };
}
