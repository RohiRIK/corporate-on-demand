/**
 * The dispatcher: where a job actually happens.
 *
 * This is the seam every later piece hangs from, and it exists because of one
 * hard constraint discovered on 2026-09-29.
 *
 * The original supervision design assumed a per-step agent loop already existed
 * to attach a progress heartbeat to. It did not, and could not: `echoTask` is
 * SYNCHRONOUS, so it has no step boundaries and no way to express "step 3 of
 * 7". A progress schema designed against a synchronous contract is a schema
 * written for a program that was never designed.
 *
 * So the loop comes first. `dispatch` is async, steps are explicit, and every
 * step is reported through `onStep` BEFORE the next one begins. The contract is
 * the deliverable; what the steps *do* is a driver, and the echo driver keeps
 * today's behaviour while a real one is written.
 *
 * Two properties are deliberate and are the reason this is not a loop with a
 * callback bolted on:
 *
 *  - Step numbers are assigned by this module, not by the driver. A driver
 *    cannot lie about how far it got, which is the whole basis of stall
 *    detection: `step_no` is a fact about the loop, not a self-report.
 *  - A failing `onStep` cannot fail the job. A supervisor that dies because
 *    logging threw is worse than one that loses a progress line, and the same
 *    reasoning already governs `beginJob` swallowing its own write failure.
 */

import type { Cron } from "./workspace";
import type { TaskResult } from "./task";

/**
 * What a step was for.
 *
 * Deliberately coarse. These are the phases an agent actually moves between,
 * and a finer taxonomy would invite drivers to report a step kind that means
 * nothing to the consumer.
 */
export type StepKind = "plan" | "act" | "observe" | "review" | "finish";

export interface Step {
  /** Monotonic, assigned by `dispatch`, starting at 1. */
  readonly no: number;
  readonly kind: StepKind;
  readonly label: string;
  /** Wall time for the step that just completed. */
  readonly ms: number;
}

export type StepSink = (step: Step) => void | Promise<void>;

/**
 * Asked between steps, never during one.
 *
 * This is the polling point for an interrupt request. It is deliberately not
 * able to cancel a step mid-flight: a step is a model call or a subprocess, and
 * there is no honest way to interrupt one of those from the outside. So
 * "stop" means "stop at the next boundary", and the supervisor escalates to
 * lease fencing if even that is not soon enough.
 */
export type ShouldStop = () => boolean | Promise<boolean>;

export interface RunOptions {
  readonly onStep?: StepSink | undefined;
  readonly shouldStop?: ShouldStop | undefined;
  readonly clock?: (() => number) | undefined;
}

export type Driver = (
  cron: Cron,
  step: (kind: StepKind, label: string) => Promise<void>,
) => Promise<string>;

/** A step was refused because the run was asked to stop at a boundary. */
export class StoppedError extends Error {
  constructor(readonly completed: number) {
    super(`stopped at step boundary after ${completed} step(s)`);
    this.name = "StoppedError";
  }
}

/**
 * Run one job through a driver, reporting every step as it completes.
 *
 * Returns the same `TaskResult` the echo path produced, so nothing above this
 * changes. The echo driver makes today's behaviour identical while the async
 * contract and the step accounting are real.
 */
export async function dispatch(
  cron: Cron,
  driver: Driver,
  options: RunOptions = {},
): Promise<TaskResult> {
  const now = options.clock ?? Date.now;
  let no = 0;
  let sinkFailures = 0;

  const report = async (kind: StepKind, label: string, startedAt: number): Promise<void> => {
    no += 1;
    const step: Step = { no, kind, label, ms: now() - startedAt };
    if (options.onStep === undefined) return;
    try {
      await options.onStep(step);
    } catch {
      // See the module comment: a broken sink must not fail the job. Counted
      // rather than swallowed silently, so a supervisor that is systematically
      // losing progress lines is visible instead of merely quiet.
      sinkFailures += 1;
    }
  };

  // A BOUNDARY, not a report of work in progress. A driver calls this at the
  // point where it has finished what it was doing and is about to begin the
  // next thing: the stop check happens here, before that next thing starts, and
  // the step record describes the work that just ended. Getting this backwards
  // - checking after the work, or reporting before it - would mean an agent
  // could do a unit of work and only then be told to stop, which is the
  // opposite of what an interrupt means.
  const step = async (kind: StepKind, label: string): Promise<void> => {
    const startedAt = now();
    if (options.shouldStop !== undefined && (await options.shouldStop()) === true) {
      throw new StoppedError(no);
    }
    await report(kind, label, startedAt);
  };

  const finish = (output: string, ok: boolean): TaskResult => ({
    cron: cron.name,
    agent: cron.agent,
    task: cron.task,
    output: output + (sinkFailures > 0 ? ` (${sinkFailures} progress report(s) lost)` : ""),
    ok,
  });

  try {
    const output = await driver(cron, step);
    await step("finish", "job complete");
    return finish(output, true);
  } catch (error) {
    // These use `report`, not `step`, and that distinction is load-bearing.
    // `step` re-checks shouldStop, which is still true by definition in the
    // stopped case - so calling it here threw a second StoppedError from inside
    // the catch and rejected out of `dispatch` entirely, losing the result. A
    // stopped run must still record how it ended; that end state is the only
    // evidence it reached the boundary.
    if (error instanceof StoppedError) {
      await report("finish", `stopped after ${error.completed} step(s)`, now());
      return finish(`stopped at a step boundary after ${error.completed} step(s)`, false);
    }
    await report("finish", `failed: ${(error as Error).message}`, now());
    return finish((error as Error).message, false);
  }
}

/**
 * The echo driver: the deterministic reference implementation.
 *
 * NO LONGER ON THE LIVE PATH. The supervisor runs `driverFor` in
 * src/drivers.ts, which makes a real credential-free model call. This stays
 * for two reasons: the dispatcher tests pin the step accounting against it, and
 * it is the fallback when a workspace names no worker - a visible string beats
 * a job that silently never runs.
 *
 * It remains useful precisely because it cannot fail for interesting reasons.
 */
export async function echoDriver(cron: Cron, step: (kind: StepKind, label: string) => Promise<void>): Promise<string> {
  await step("plan", `brief: ${cron.task}`);
  await step("act", "no-op (echo driver)");
  await step("observe", `${cron.agent} reported no work done`);
  return `${cron.agent}: ${cron.task}`;
}
