/**
 * Running a scheduled job.
 *
 * Deliberately an `echo` and nothing else.
 *
 * The point of this phase is to prove the plumbing — that a `Bun.cron` tick
 * reaches a named agent's task and the result comes back out — without
 * building an execution layer nobody has specified yet. Model routing, spend
 * ceilings, merge policy and inter-agent locking are all undecided, and
 * guessing at them here would optimise the wrong thing.
 *
 * So a job echoes. That is honest, testable, and reversible: the real
 * dispatcher replaces `echoTask` and nothing above it changes.
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
