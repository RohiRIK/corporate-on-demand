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

import { openWork, claim, commit, get, type WorkItem } from "./work";
import { isGlobalPath } from "./boundary";
import { dispatch, type Driver, type Step } from "./dispatch";
import type { Cron } from "./workspace";

/** Paths that make work cross-department rather than self-contained. */
const CROSS_DEPARTMENT = ["src/", "docker/", "ops/", "templates/", "scripts/", ".github/"] as const;

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
  let derived = 0;
  for (const path of targetPaths) {
    if (isGlobalPath(path)) {
      derived = 2;
      break;
    }
    if (CROSS_DEPARTMENT.includes(path.split("/")[0]?.toLowerCase() as (typeof CROSS_DEPARTMENT)[number])) {
      derived = Math.max(derived, 1);
    }
  }
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
 * What the agent is actually told, including any objection it must fix.
 *
 * `textOfItem` reads the payload alone, so a retried item was handed the exact
 * same prompt as its first attempt and had no way to know what the reviewer had
 * objected to. The retry existed; the fix demand did not.
 *
 * Only feedback the review loop itself wrote is treated as a review: it all
 * starts with `review`. An unrelated reason - "could not reach the model" - is
 * left alone rather than dressed up as a reviewer's verdict, because telling a
 * model "the reviewer said X" when nobody said X is worse than saying nothing.
 *
 * The task stays FIRST. The objection is context, not the objective, and an
 * agent that reads a wall of criticism before it knows what it was asked to do
 * is being asked something else.
 */
export function briefFor(item: WorkItem): string {
  const task = textOfItem(item);
  const reason = (item.reason ?? "").trim();
  if (!reason.startsWith("review")) return task;
  return [
    task,
    "",
    "Your previous attempt was reviewed and returned. Fix these points:",
    reason,
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
      // Refused BEFORE the agent runs, and marked FAILED. Not caught
      // afterwards - an agent that already edited the schema is not a
      // boundary, it is an incident.
      //
      // A department cannot dispatch global work, so failing it is the honest
      // record. The CEO re-proposes it with the authority the department lacks,
      // and the work is not lost because the proposal itself is still on file.
      const held = commit(
        handle, existing.id, existing.lease_epoch, "failed",
        `global work (radius ${radius}) targets ${describeWorkTarget(paths)}; only the CEO may dispatch it`,
      );
      return {
        ok: false,
        workId: existing.id,
        radius,
        reason: held.ok
          ? `global work (radius ${radius}) targets ${describeWorkTarget(paths)}; only the CEO may dispatch it`
          : (held.reason ?? "fenced"),
      };
    }

    // The epoch we act under. Supplied by the tests to simulate a zombie; in
    // production the claim we just made supplies it.
    let epoch = options.leaseEpoch;
    if (epoch === undefined) {
      const claimed = claim(handle, `run:${options.cron.name}`, existing.to_agent);
      if (claimed === null) {
        return { ok: false, workId: existing.id, radius, reason: "the item was not claimable (already running, or not ready)" };
      }
      epoch = claimed.lease_epoch;
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
      succeeded = result.ok;
    } catch (error) {
      // Recorded as FAILED rather than left running: an item that stays
      // `running` looks identical to an item that is genuinely still working,
      // which is the ambiguity the budget rule then has to resolve by timeout.
      const message = (error as Error).message;
      const failed = commit(handle, existing.id, epoch, "failed", message);
      void failed;
      return { ok: false, workId: existing.id, radius, reason: message };
    }

    // FENCED. The commit carries the epoch we were given, so a run whose lease
    // was reclaimed updates zero rows and its result is refused rather than
    // overwriting a newer one.
    // `dispatch` never throws - it turns a throwing driver into a not-ok
    // result. So the failure has to be read from the RESULT, or a job that
    // blew up is recorded as `done` with the error message as its reason,
    // which is a successful-looking record of a failure.
    const outcome = commit(handle, existing.id, epoch, succeeded ? "done" : "failed", output);
    if (!outcome.ok) {
      return { ok: false, workId: existing.id, radius, reason: outcome.reason ?? "fenced" };
    }
    return { ok: succeeded, workId: existing.id, radius, output };
  } catch (error) {
    return { ok: false, workId: options.workId, reason: (error as Error).message };
  } finally {
    handle.close();
  }
}
