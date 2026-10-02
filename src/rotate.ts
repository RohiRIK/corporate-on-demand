/**
 * Which model this job actually uses.
 *
 * This file exists because `src/registry.ts` spent a long time with a full set
 * of passing tests and **no callers**. The class worked; the system never used
 * it, so every job ran the worker's pinned model and the reliability work
 * bought nothing. A unit test on a class is not evidence that a system calls
 * it.
 *
 * The policy is STICKY WITH FAILOVER, not rotation. A worker names its model
 * and keeps it while that model works - per-worker routing is a settled
 * decision - and only moves when the model is ejected after consecutive
 * failures. Round-robin would send every job to a different untested model,
 * which is worse than the problem being fixed, and it would make a worker's
 * `model` field decorative.
 *
 * Failover stays inside the worker's own engine. Switching engine mid-job
 * changes the binary under a running worktree, which trades a known failure for
 * an unknown one.
 */

import type { Candidate } from "./registry";
import { Registry } from "./registry";

/**
 * The model for one job, or null when there is genuinely nowhere to go.
 *
 * Null is returned only when the worker pinned a model that no longer exists
 * AND there is no free alternative on that engine - which is a configuration
 * problem worth naming, not something to paper over by dispatching anyway.
 */
export function pickForJob(
  registry: Registry,
  preferred: Candidate,
  pool: readonly Candidate[],
): Candidate | null {
  // Same engine only. A pool of another engine's models is not a fallback for
  // this worker, it is a different system.
  const sameEngine = pool.filter((c) => c.backend === preferred.backend);

  if (registry.healthy(preferred.backend, preferred.model)) return preferred;

  const chosen = registry.pick(sameEngine);
  if (chosen !== null) return chosen;

  // Everything on this engine is ejected. Dispatch the worker's own model
  // anyway: refusing to run is its own kind of silent failure, and it looks
  // exactly like the provider outage this exists to survive.
  return preferred;
}
