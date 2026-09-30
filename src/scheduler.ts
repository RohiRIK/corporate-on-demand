/**
 * In-container scheduling, on Bun.cron.
 *
 * The single most important behaviour here is the version guard. `Bun.cron` is
 * undefined below Bun 1.3.12, and a scheduler that registers nothing while
 * reporting itself healthy is the worst failure this project can have: the
 * work simply never happens, and nothing says why. So the check happens before
 * any job is registered, and it throws.
 *
 * The clock is injected rather than read from the system, so the tests can
 * prove a job fires exactly once across a restart without waiting for 2am.
 */

import { DEFAULT_MAX_CONCURRENT, createGate } from "./limit";
import { UnsupportedRuntimeError } from "./errors";
import type { Cron, Workspace } from "./workspace";
import { governanceIntervalFor } from "./governance";

export interface SchedulerOptions {
  /** Now, in epoch milliseconds. Injected so tests are deterministic. */
  readonly now?: () => number;
  /** Run a job. Injected so tests never shell out. */
  readonly run?: (cron: Cron) => Promise<void>;
  /** Report a job outcome. Defaults to stdout, which the container log captures. */
  readonly report?: (line: string) => void;
  /**
   * How many jobs may run at once. Defaults to 2.
   *
   * A schedule with ten jobs at the same minute must not launch ten agents
   * simultaneously, so every firing is queued and run under this ceiling.
   */
  readonly maxConcurrent?: number;
}

export interface ScheduledHandle {
  /** Stop this job. */
  readonly stop: () => void;
}

/**
 * Fail loudly when Bun.cron is missing.
 *
 * Called before anything is scheduled, so the failure names the problem
 * instead of leaving a healthy-looking process that never fires.
 */
export function assertCronSupport(): void {
  const bun = (globalThis as { Bun?: { cron?: unknown; version: string } }).Bun;
  if (typeof bun?.cron === "function") return;
  throw new UnsupportedRuntimeError("Bun 1.3.12 or newer", `Bun ${bun?.version ?? "unknown"}`);
}

/**
 * Register the governance tick on its own interval.
 *
 * Separate from the cron path on purpose. A cron is a job with a task and an
 * agent; governance is the company deciding what to work on, and routing it
 * through a synthetic cron entry would make "the CEO's own cycle" look like a
 * user's scheduled job - which is exactly the kind of blur that makes an
 * authority boundary impossible to point at later.
 *
 * Returns null when governance is off or the interval is unusable, so the
 * caller can say "not scheduled" instead of pretending.
 */
export function scheduleGovernance(
  workspace: Workspace,
  tick: () => Promise<void>,
  options: { readonly report?: (line: string) => void } = {},
): ScheduledHandle | null {
  const minutes = governanceIntervalFor(workspace);
  if (minutes <= 0) return null;

  const report = options.report ?? ((line: string): void => { process.stdout.write(`${line}\n`); });
  // Standard 5-field cron with a step in the minute field. `@every(...)` is NOT
  // used: Bun.cron rejects it, and a scheduler that registers nothing while
  // reporting healthy is the failure this file exists to prevent.
  const handle = Bun.cron(`*/${minutes} * * * *`, () => {
    void tick().catch((error: unknown) => {
      report(`[governance] tick failed: ${(error as Error).message}`);
    });
  });
  report(`[governance] the company will govern itself every ${minutes} minute(s)`);
  return { stop: (): void => { handle.stop(); } };
}

/**
 * Register every enabled cron in the workspace.
 *
 * Disabled jobs are skipped, not registered-and-muted, so the schedule reads
 * as a single source of truth rather than two.
 */
export function scheduleWorkspace(
  workspace: Workspace,
  options: SchedulerOptions = {},
): ScheduledHandle[] {
  assertCronSupport();

  const now = options.now ?? ((): number => Date.now());
  const run = options.run ?? (async (): Promise<void> => {});
  const report = options.report ?? ((line: string): void => void process.stdout.write(`${line}\n`));

  const handles: ScheduledHandle[] = [];
  const rejected: Cron[] = [];
  const enabled = workspace.crons.filter((cron) => cron.enabled);
  const maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;

  /**
   * How many jobs are waiting for a slot. Read inside the report so a queued
   * job says so - a queue that is invisible looks exactly like a stalled
   * schedule, and those need different fixes.
   */
  let queued = 0;
  // ONE gate for the whole schedule, shared by every cron below. Previously each
  // cron called runWithLimit with a single-element array, which always spawned
  // exactly one worker - so this limit was never enforced against anything.
  const gate = createGate(maxConcurrent);

  for (const cron of enabled) {
    // Bun.CronJob is the handle; ReturnType<typeof Bun.cron> resolves to the
    // callback's Promise because of the overloaded signature.
    let handle: Bun.CronJob;
    try {
      handle = Bun.cron(cron.schedule, async (): Promise<void> => {
        // Queue rather than run directly. Ten jobs at `:00` must not become
        // ten simultaneous agents, and a fired callback that awaits its turn
        // is the natural place to enforce that.
        queued += 1;
        if (queued > maxConcurrent) {
          report(`[cron] ${cron.name} queued (${queued - 1} already running, limit ${maxConcurrent})`);
        }
        // The gate is acquired OUTSIDE the try/finally below, so `queued`
        // counts jobs waiting for a slot as well as jobs holding one. A job
        // waiting is genuinely queued, and reporting otherwise would say
        // "0 already running" while six jobs sat idle behind the limit.
        await gate.acquire();
        try {
          const started = now();
          report(`[cron] ${cron.name} firing at ${new Date(started).toISOString()}`);
          try {
            await run(cron);
            report(`[cron] ${cron.name} finished in ${now() - started}ms`);
          } catch (error) {
            // A failing job must not take the scheduler down with it, or one
            // bad cron silently disables every other cron in the workspace.
            report(`[cron] ${cron.name} failed: ${(error as Error).message}`);
          }
        } finally {
          // Released in a finally, because a job that throws still held the
          // slot; leaking it would permanently shrink the ceiling.
          gate.release();
          queued -= 1;
        }
        // Bun.cron's stop() is void; the return type of the callback must be too.
      });
    } catch (error) {
      // Bun.cron throws on an expression it does not understand, and it does
      // NOT support @every. Letting that escape the loop would leave every
      // later job unregistered while the ones before it kept running - a
      // partial schedule that looks healthy. One bad job is reported and
      // skipped; the rest still register.
      report(`[cron] ${cron.name} REJECTED (${JSON.stringify(cron.schedule)}): ${(error as Error).message}`);
      rejected.push(cron);
      continue;
    }
    handles.push({ stop: (): void => void handle.stop() });
  }

  report(`[cron] registered ${handles.length} job(s): ${enabled.map((c) => c.name).join(", ") || "none"}`);
  if (rejected.length > 0) {
    report(
      `[cron] WARNING: ${rejected.length} job(s) were rejected: ` +
        `${rejected.map((c) => c.name).join(", ")}. Bun.cron uses standard 5-field ` +
        `cron expressions and does NOT support @every.`,
    );
  }
  return handles;
}

/** Whether this runtime can schedule at all. Used by `cod doctor`. */
export function cronSupportAvailable(): boolean {
  return typeof (globalThis as { Bun?: { cron?: unknown } }).Bun?.cron === "function";
}
