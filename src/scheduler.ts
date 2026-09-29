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

import { UnsupportedRuntimeError } from "./errors";
import type { Cron, Workspace } from "./workspace";

export interface SchedulerOptions {
  /** Now, in epoch milliseconds. Injected so tests are deterministic. */
  readonly now?: () => number;
  /** Run a job. Injected so tests never shell out. */
  readonly run?: (cron: Cron) => Promise<void>;
  /** Report a job outcome. Defaults to stdout, which the container log captures. */
  readonly report?: (line: string) => void;
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
  const enabled = workspace.crons.filter((cron) => cron.enabled);

  for (const cron of enabled) {
    const handle = Bun.cron(cron.schedule, async (): Promise<void> => {
      const started = now();
      report(`[cron] ${cron.name} firing at ${new Date(started).toISOString()}`);
      try {
        await run(cron);
        report(`[cron] ${cron.name} finished in ${now() - started}ms`);
      } catch (error) {
        // A failing job must not take the scheduler down with it, or one bad
        // cron silently disables every other cron in the workspace.
        report(`[cron] ${cron.name} failed: ${(error as Error).message}`);
      }
      // Bun.cron's stop() is void; the return type of the callback must be too.
    });
    handles.push({ stop: (): void => void handle.stop() });
  }

  report(`[cron] registered ${handles.length} job(s): ${enabled.map((c) => c.name).join(", ") || "none"}`);
  return handles;
}

/** Whether this runtime can schedule at all. Used by `cod doctor`. */
export function cronSupportAvailable(): boolean {
  return typeof (globalThis as { Bun?: { cron?: unknown } }).Bun?.cron === "function";
}
