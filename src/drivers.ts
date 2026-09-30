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

import { isAgentFailure, runAgent, type RunAgentOptions } from "./agent";
import { backendForModel, modelIds } from "./backend";
import { pickForJob } from "./rotate";
import { Registry, type Candidate } from "./registry";
import { DEFAULT_MODEL } from "./agent";
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
  registry?: Registry,
): Driver {
  return async (cron: Cron, step): Promise<string> => {
    if (worker === null) {
      await step("plan", `no worker named "${cron.agent}"; using the free default model`);
    }

    // Model selection, then the run, then the record. The record is the part
    // that was missing for a long time: a registry nothing writes to cannot
    // learn anything, so rotation has to happen HERE, around every job, and
    // not merely exist as a class with its own tests.
    const named = options.model ?? worker?.model ?? DEFAULT_MODEL;
    const preferred: Candidate = { backend: backendForModel(named), model: named };
    const pool: Candidate[] = modelIds(preferred.backend).map((model) => ({ backend: preferred.backend, model }));
    const chosen = pickForJob(registry ?? new Registry(), preferred, pool);

    const out = await runAgent(cron, worker, step, { ...options, company, model: chosen?.model ?? named });

    // Narrowed explicitly rather than by a non-null assertion: `chosen` is
    // null only when the worker pinned a model no engine offers, and in that
    // case there is nothing truthful to record.
    const used: Candidate | undefined = chosen === null || chosen === undefined
      ? undefined
      : { backend: chosen.backend, model: chosen.model };
    if (registry !== undefined && used !== undefined) {
      registry.record({ backend: used.backend, model: used.model, ok: !isAgentFailure(out), at: Date.now() });
    }
    return out;
  };
}
