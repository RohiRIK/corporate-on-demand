/**
 * The live driver.
 *
 * Two lookups and one adaptation: cron -> worker -> model.
 *
 * This is its own file so that neither side has to know about the other:
 * `dispatch` receives a plain `Driver`, and `runAgent` stays independent of
 * how the workspace is stored. The supervisor owns the workspace, so it does
 * the worker lookup and passes the result in.
 */

import { runAgent, type RunAgentOptions } from "./agent";
import type { Company, Cron, Worker } from "./workspace";
import type { Driver } from "./dispatch";

/**
 * Build a Driver bound to one worker.
 *
 * A missing worker is NOT an error here. It falls back to the free default
 * model and says so in a step, because a renamed worker should produce a
 * visible note in the result rather than a job that silently never runs.
 */
export function driverFor(
  worker: Worker | null,
  company: Company | null,
  options: RunAgentOptions = {},
): Driver {
  return async (cron: Cron, step): Promise<string> => {
    if (worker === null) {
      await step("plan", `no worker named "${cron.agent}"; using the free default model`);
    }
    return runAgent(cron, worker, step, { ...options, company });
  };
}
