/**
 * The result contract for a scheduled job.
 *
 * `TaskResult` is the entire interface between the supervisor and the work, and
 * it is deliberately the narrowest shape that can carry a job's identity and
 * outcome. Nothing here describes HOW the work happened - step counts, progress
 * and cancellation live in `src/dispatch.ts`, which is the only caller that
 * needs them.
 *
 * `echoTask` remains as the original synchronous echo and as the reference
 * shape. It is no longer on the live path: the supervisor now goes through
 * `dispatch`, which wraps a driver and reports every step. Keeping the function
 * is useful because it pins the smallest correct output, and because the
 * dispatcher's echo driver must produce exactly this.
 */

import type { Cron } from "./workspace";

export interface TaskResult {
  readonly cron: string;
  readonly agent: string;
  readonly task: string;
  readonly output: string;
  readonly ok: boolean;
}

/**
 * Echo a job's task back.
 *
 * No subprocess, no model call, no filesystem write. It cannot fail for
 * interesting reasons, which is exactly why it is useful here: if a scheduled
 * job goes wrong, the cause is the scheduling, not the work.
 */
export function echoTask(cron: Cron): TaskResult {
  return {
    cron: cron.name,
    agent: cron.agent,
    task: cron.task,
    output: `${cron.agent}: ${cron.task}`,
    ok: true,
  };
}
