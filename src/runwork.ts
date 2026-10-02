/**
 * Running a ledger item as a real job.
 *
 * This is the join between two halves that already existed and had never met:
 * the crash-safe ledger with its fencing, and the driver that actually runs an
 * agent. Nothing proposed work before (the ledger's only caller was the CLI) and
 * nothing ran it, so both halves were dead code waiting for this file.
 *
 * The radius is DERIVED here, from what the work names. It used to be an
 * integer the proposing agent filled in, which means the rule constrained the
 * thing it was supposed to constrain - an agent wanting a global change simply
 * wrote 0. Deriving it removes the agent from the decision entirely, and a
 * proposed value can only ever narrow the result, never widen it.
 */

import { openWork, claimById, commit, get, propose, reject, runFailureReason, type ReviewRecord, type WorkItem } from "./work";
import { parsePlan, taskPayload } from "./plan";
import { isGlobalPath } from "./boundary";
import { dispatch, type Driver, type Step } from "./dispatch";
import { isAgentFailure } from "./agent";
import type { Cron } from "./workspace";

/**
 * The radius this work must run under.
 *
 * `proposed` can only narrow. Defence in depth: a stale or hostile value cannot
 * widen an agent's authority, and the ceiling is 2 by construction because
 * anything that touches a global path IS radius 2.
 */
export function radiusForWork(
  goal: string,
  targetPaths: readonly string[] = [],
  proposed?: number | null,
): number {
  void goal;
  // 0 or 2, never 1, and deliberately so: "cross-department" needs to know
  // which department OWNS a path, which a string cannot say. A list that tried
  // (`src/`, `docker/`, ...) sat here for a while and could never match - its
  // entries kept the trailing slash while the lookup stripped it - and every
  // one of those prefixes is global anyway. Radius 1 is something a job states
  // about itself, and it can only ever narrow.
  const derived = targetPaths.some((path) => isGlobalPath(path)) ? 2 : 0;
  // A proposed value may narrow, but it can NEVER narrow GLOBAL work.
  //
  // `min(derived, proposed)` looks safe and is not: an agent proposing a
  // global change simply writes 0, and min(2, 0) hands it the authority it
  // asked for. Measured - that was the hole. Global is a ceiling that only the
  // CEO can lift, so a proposal below it is ignored outright.
  if (derived >= 2) return 2;
  if (proposed !== undefined && proposed !== null && Number.isInteger(proposed) && proposed >= 0) {
    return Math.min(derived, proposed);
  }
  return derived;
}

/** May a department dispatch this to itself? Global work may not. */
export function canSelfDispatch(radius: number): boolean {
  return radius < 2;
}

/** A target a human can act on. */
export function describeWorkTarget(paths: readonly string[]): string {
  return paths.length === 0 ? "no target paths" : paths.join(", ");
}

export interface RunWorkOptions {
  readonly stateDir: string;
  readonly workId: string;
  readonly cron: Cron;
  readonly driver: Driver;
  /** Force a specific lease epoch. Used by the tests to simulate a zombie. */
  readonly leaseEpoch?: number;
  /**
   * Dispatch as the CEO. Only the CEO may lift the global-work ceiling - that
   * is the entire point of the rule, and a flag every caller could pass would
   * make it no rule at all. The CLI sets it on the CEO's own command path only.
   */
  readonly asCeo?: boolean;
  readonly onStep?: (step: Step) => void;
}

export interface RunWorkResult {
  readonly ok: boolean;
  readonly output?: string;
  readonly reason?: string;
  readonly radius?: number;
  readonly workId: string;
}

/**
 * The text a human meant, when the payload is a JSON wrapper.
 *
 * The payload carries the target paths so the radius can be derived, and the
 * naive thing - hand `item.payload` to the agent - makes the model read
 * `{"text":"...","targetPaths":[...]}` as its instruction. It copes, but it is
 * the system showing its own plumbing to the thing it is trying to direct.
 */
export function textOfItem(item: WorkItem): string {
  try {
    const parsed: unknown = JSON.parse(item.payload);
    if (typeof parsed === "object" && parsed !== null) {
      const text = (parsed as { text?: unknown }).text;
      if (typeof text === "string" && text !== "") return text;
    }
  } catch {
    // A plain string payload is the common case and is already the text.
  }
  return item.payload;
}

/**
 * What the agent is actually told, including every objection it must fix.
 *
 * `textOfItem` reads the payload alone, so a retried item used to be handed the
 * exact same prompt as its first attempt and had no way to know what the
 * reviewer had objected to.
 *
 * The objections come from the REVIEW ROW, and only from a live
 * `changes-requested` one. They used to come from `work.reason` when it started
 * with "review" - a shape test on a free-text field that the worker's own commit
 * overwrites, so in production a retry saw at most the newest objection, and an
 * unrelated reason that happened to start with "review" was presented to a
 * model as a reviewer's verdict.
 *
 * The task stays FIRST. The objection is context, not the objective, and an
 * agent that reads a wall of criticism before it knows what it was asked to do
 * is being asked something else.
 */
export function briefFor(item: WorkItem, review?: Pick<ReviewRecord, "outcome" | "reason"> | null): string {
  // The paths the task named go WITH it. The reviewer judges scope against
  // exactly these, and the worker used to be told only the goal - so it was
  // held to a list it had never been shown.
  const paths = targetPathsOfItem(item);
  const task = paths.length === 0
    ? textOfItem(item)
    : `${textOfItem(item)}\n\nPaths this task named - keep the change to these: ${paths.join(", ")}`;
  if (review === undefined || review === null || review.outcome !== "changes-requested") return task;
  const objections = review.reason.trim();
  if (objections === "") return task;
  return [
    task,
    "",
    "Your previous attempt was reviewed and returned. Fix these points:",
    objections,
  ].join("\n");
}

/** The target paths a work item names, parsed out of its payload. */
export function targetPathsOfItem(item: WorkItem): string[] {
  try {
    const parsed: unknown = JSON.parse(item.payload);
    if (typeof parsed === "object" && parsed !== null) {
      const paths = (parsed as { targetPaths?: unknown }).targetPaths;
      if (Array.isArray(paths)) return paths.filter((p): p is string => typeof p === "string");
    }
  } catch {
    // A payload that is not JSON is a plain string, which is the common case.
  }
  return [];
}

/**
 * Run one ledger item to completion, and record the outcome.
 *
 * Never throws. A job that cannot settle never records a result, and a job with
 * no result is invisible - which is the failure mode this whole ledger exists
 * to prevent.
 */
export async function runWorkItem(options: RunWorkOptions): Promise<RunWorkResult> {
  const handle = openWork(options.stateDir);
  try {
    const existing = get(handle, options.workId);
    if (existing === null) {
      return { ok: false, workId: options.workId, reason: "no such work item" };
    }

    const paths = targetPathsOfItem(existing);
    const radius = radiusForWork(existing.payload, paths, existing.blast_radius);

    if (!canSelfDispatch(radius) && options.asCeo !== true) {
      // Refused BEFORE the agent runs. Not caught afterwards - an agent that
      // already edited the schema is not a boundary, it is an incident.
      //
      // `rejected`, not `failed`: it never ran, and "not permitted" is a
      // different fact from "did not work". It used to be committed `failed`,
      // which only worked because commit() also accepted items nobody had
      // claimed - the hole that let a proposal be marked done at epoch 0.
      const why = `global work (radius ${radius}) targets ${describeWorkTarget(paths)}; only the CEO may dispatch it`;
      const held = reject(handle, existing.id, why);
      return { ok: false, workId: existing.id, radius, reason: held.ok ? why : (held.reason ?? why) };
    }

    // The epoch we act under. Supplied by the tests to simulate a zombie; in
    // production the claim we just made supplies it - a claim of THIS item, by
    // id. Claiming "the next item for this department" ran one item's agent
    // under another item's lease.
    let epoch = options.leaseEpoch;
    let previousReason = existing.reason;
    if (epoch === undefined) {
      const claimed = claimById(handle, existing.id, `run:${options.cron.name}`);
      if (claimed === null) {
        return { ok: false, workId: existing.id, radius, reason: `${existing.id} was not claimable: it is ${existing.state}, and only ready work can run` };
      }
      epoch = claimed.lease_epoch;
      previousReason = claimed.reason;
    }

    // The driver, through the dispatcher, so the job gets the same step
    // accounting and the same "never throws" guarantee as a cron job. A job run
    // from the ledger and a job run from cron must not be two different
    // machines.
    let output: string;
    let succeeded = false;
    try {
      const result = await dispatch(options.cron, options.driver, {
        onStep: options.onStep === undefined ? undefined : (step): void => { options.onStep?.(step); },
      });
      output = result.output;
      // NOT `result.ok` alone. `dispatch` only fails when the driver THROWS,
      // and the real driver never does: it returns "agent FAILED: ..." as text.
      // So a provider outage was committed `done`, reported `ok: true`, and then
      // offered for review with an empty branch - the exact wrong-reason
      // success the cron path stopped recording months ago, still alive here.
      succeeded = result.ok && !isAgentFailure(output);
    } catch (error) {
      // Recorded as FAILED rather than left running: an item that stays
      // `running` looks identical to an item that is genuinely still working,
      // which is the ambiguity the budget rule then has to resolve by timeout.
      const message = (error as Error).message;
      const failed = commit(handle, existing.id, epoch, "failed", runFailureReason(previousReason, message));
      void failed;
      return { ok: false, workId: existing.id, radius, reason: message };
    }

    // A PLAN's product is a task, not a branch. Its answer is parsed and the
    // task proposed like any other work - by the department that planned it,
    // to itself, with the paths it named - so the reconciler derives its radius
    // and refuses it by rule if those paths are global. An answer that cannot
    // be read is a failed run, and earns the same bounded retry.
    if (succeeded && existing.kind === "plan") {
      const planned = parsePlan(output);
      if (planned.kind === "invalid") {
        const detail = `${planned.reason}; the planner answered: ${output.replace(/\s+/g, " ").slice(0, 300)}`;
        const failed = commit(handle, existing.id, epoch, "failed", runFailureReason(previousReason, detail));
        return { ok: false, workId: existing.id, radius, output, reason: failed.ok ? detail : (failed.reason ?? "fenced") };
      }
      let note = "planned nothing: the department saw nothing worth doing right now";
      if (planned.kind === "plan") {
        const made = propose(handle, {
          from: existing.to_agent,
          to: existing.to_agent,
          kind: "task",
          payload: taskPayload(planned.plan),
          goal: planned.plan.goal,
          targetPaths: planned.plan.paths,
        });
        note = made.ok && made.item !== undefined
          ? `planned ${made.item.id}: ${planned.plan.goal}`
          : `planned work that already exists: ${made.reason ?? "refused"}`;
      }
      const settled = commit(handle, existing.id, epoch, "done", note);
      if (!settled.ok) return { ok: false, workId: existing.id, radius, reason: settled.reason ?? "fenced" };
      return { ok: true, workId: existing.id, radius, output: note };
    }

    // FENCED. The commit carries the epoch we were given, so a run whose lease
    // was reclaimed updates zero rows and its result is refused rather than
    // overwriting a newer one.
    //
    // A failed run is recorded with a COUNTED reason, so the reconciler can put
    // it back on the queue a bounded number of times - a free provider failing
    // one call is not a verdict on the work.
    const outcome = succeeded
      ? commit(handle, existing.id, epoch, "done", output)
      : commit(handle, existing.id, epoch, "failed", runFailureReason(previousReason, output));
    if (!outcome.ok) {
      return { ok: false, workId: existing.id, radius, reason: outcome.reason ?? "fenced" };
    }
    return succeeded
      ? { ok: true, workId: existing.id, radius, output }
      : { ok: false, workId: existing.id, radius, output, reason: outcome.item?.reason ?? output };
  } catch (error) {
    return { ok: false, workId: options.workId, reason: (error as Error).message };
  } finally {
    handle.close();
  }
}
