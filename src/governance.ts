/**
 * The company running itself.
 *
 * The loop was real and manual: a human typed `cod cycle`, then `cod meet`, then
 * `cod work run <id>` for each item. Every part worked; nothing connected them.
 * That is the same shape as a registry with no callers - a working system that
 * needs a person present to be one.
 *
 * One tick is: propose, meet, dispatch. Nothing else, deliberately. Anything
 * else in here would be a second place the company's behaviour is decided.
 *
 * **The bound is the safety property.** `maxDispatch` caps how much work a
 * single tick may start, so a burst of proposals cannot turn one unattended tick
 * into fifty concurrent agents. And a GLOBAL item is never dispatched by the
 * tick: the boundary does not get relaxed because nobody is watching, which is
 * precisely when a ceiling matters most.
 *
 * The dispatcher is injected so the tick can be tested without a container or a
 * model, and so the supervisor can supply the one that has a driver behind it.
 */

import { runCycle, type CycleResult } from "./cycle";
import { holdMeeting, type Meeting } from "./meeting";
// Re-exported through one seam so the tick and the dispatch path cannot drift
// apart on how a radius is derived.
import { radiusForWork, targetPathsOfItem } from "./runwork";
import { openWork, listWork, type WorkItem } from "./work";
import type { Workspace } from "./workspace";

export interface DispatchOutcome {
  readonly ok: boolean;
  readonly output?: string;
  readonly reason?: string;
}

export interface GovernanceOptions {
  /** Runs one item. Injected: the supervisor passes the real driver. */
  readonly dispatch: (workId: string) => Promise<DispatchOutcome>;
  /** Hard cap per tick. The reason this tick is safe to run unattended. */
  readonly maxDispatch?: number;
  readonly actor?: string;
}

export interface GovernanceReport {
  readonly cycle: CycleResult;
  readonly meeting: Meeting;
  readonly dispatched: readonly string[];
  /**
   * Failures WITH their reason.
   *
   * A bare list of ids is not enough in an unattended company: nobody is there
   * to go and look, and "failed: w-abc123" is indistinguishable from a
   * provider outage, a configuration mistake and a bug.
   */
  readonly failed: readonly { readonly id: string; readonly reason: string }[];
  readonly summary: string;
}

const DEFAULT_MAX_DISPATCH = 2;
const DEFAULT_INTERVAL_MINUTES = 30;

/**
 * Is this item one the company may start on its own?
 *
 * Two exclusions, and the first one was a real bug found by running it.
 *
 * **Items addressed to the CEO are not dispatched.** The CEO DECIDES work; it
 * does not execute it. An item in the CEO's inbox is a proposal awaiting a
 * decision, and the meeting is what decides it. Dispatching it tried to find a
 * worker called "ceo", found none - correctly, because the CEO is the
 * supervisor, not a worker in any department - and failed every tick with
 * "no worker or department named ceo".
 *
 * So the queue is: work addressed to a department that exists. Anything else is
 * either a decision waiting to be made or a misconfiguration, and neither is
 * something to hand to an agent.
 */
function dispatchable(item: WorkItem, workspace: Workspace): boolean {
  if (item.state !== "ready") return false;
  if (item.to_agent === "ceo") return false;
  const known = workspace.departments.some((d) => d.name === item.to_agent && d.workers.length > 0);
  if (!known) return false;
  // Radius is DERIVED from the target paths, never read from the row: the row's
  // own value is written by the proposing agent, so trusting it means the rule
  // constrains the thing it constrains.
  return radiusForWork(item.payload, targetPathsOfItem(item), item.blast_radius) < 2;
}

/**
 * One unattended tick: propose, meet, dispatch.
 *
 * Never throws. A tick that vanishes is how a schedule becomes untrustworthy,
 * and this one runs with nobody present to notice.
 */
export async function runGovernance(
  workspace: Workspace,
  stateDir: string,
  options: GovernanceOptions,
): Promise<GovernanceReport> {
  const maxDispatch = options.maxDispatch ?? DEFAULT_MAX_DISPATCH;
  const actor = options.actor ?? "governance";

  let cycle: CycleResult;
  let meeting: Meeting;
  try {
    cycle = runCycle(workspace, stateDir, { actor });
    meeting = holdMeeting(workspace, stateDir);
  } catch (error) {
    return {
      cycle: emptyCycle(`cycle failed: ${(error as Error).message}`),
      meeting: emptyMeeting(),
      dispatched: [],
      failed: [],
      summary: `governance tick failed: ${(error as Error).message}`,
    };
  }

  let queue: WorkItem[] = [];
  try {
    const handle = openWork(stateDir);
    try {
      queue = listWork(handle).filter((item) => dispatchable(item, workspace));
    } finally {
      handle.close();
    }
  } catch {
    queue = [];
  }

  const dispatched: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const item of queue.slice(0, Math.max(0, maxDispatch))) {
    try {
      const outcome = await options.dispatch(item.id);
      if (outcome.ok) dispatched.push(item.id);
      else failed.push({ id: item.id, reason: outcome.reason ?? "no reason reported" });
    } catch (error) {
      // A dispatcher that throws must not take the tick with it, and the item
      // stays `ready` so the next tick retries it.
      failed.push({ id: item.id, reason: (error as Error).message });
    }
  }

  const summary = [
    `proposed ${cycle.proposed.length}`,
    `decisions ${meeting.decisions.length}`,
    `dispatched ${dispatched.length}`,
    `failed ${failed.length}`,
    `${queue.length} item(s) ready`,
  ].join("; ");

  return { cycle, meeting, dispatched, failed, summary };
}

function emptyCycle(reason: string): CycleResult {
  return {
    proposed: [],
    duplicates: 0,
    reconciled: { promoted: [], rejected: [], expired: [], resolved: [], unchanged: 0, errors: [reason] },
    summary: reason,
  };
}

function emptyMeeting(): Meeting {
  return { cast: [], speaking: [], decisions: [], summary: "meeting did not run" };
}

/**
 * How often the company governs itself, in minutes. 0 means "do not".
 *
 * Default ON, because the default company is an autonomous one and a company
 * that needs a human to type a command is not that. An operator can turn it
 * off, and nonsense intervals fall back rather than scheduling nonsense.
 */
export function governanceIntervalFor(workspace: Workspace): number {
  const raw = (workspace as { governance?: { enabled?: boolean; cycleEveryMinutes?: number } }).governance;
  if (raw?.enabled === false) return 0;
  const wanted = raw?.cycleEveryMinutes;
  if (typeof wanted !== "number" || !Number.isFinite(wanted) || wanted <= 0) {
    return DEFAULT_INTERVAL_MINUTES;
  }
  return Math.floor(wanted);
}
