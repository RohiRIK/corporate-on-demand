/**
 * The in-container supervisor: reads the mounted workspace and schedules it.
 *
 * Run with `docker exec`, so a crashed supervisor shows up as a failed exec
 * rather than a container that silently restarts in a loop. It must not
 * register anything when Bun.cron is unavailable — see scheduler.ts.
 */

import { readFileSync } from "node:fs";
import { Workspace } from "./workspace";
import { echoTask } from "./task";
import { assertCronSupport, scheduleWorkspace, type ScheduledHandle } from "./scheduler";

const WORKSPACE_FILE = process.env["COD_WORKSPACE_FILE"] ?? "/cod/cod.json";

function log(line: string): void {
  process.stdout.write(`[supervisor] ${line}\n`);
}

function main(): void {
  // Throws UnsupportedRuntimeError, which exits 2, when Bun.cron is missing.
  // That is the whole point: fail here rather than sit idle for ever.
  assertCronSupport();
  log(`Bun ${Bun.version}, Bun.cron available`);

  let raw: string;
  try {
    raw = readFileSync(WORKSPACE_FILE, "utf8");
  } catch (error) {
    log(`cannot read ${WORKSPACE_FILE}: ${(error as Error).message}`);
    process.exit(1);
  }

  const parsed = Workspace.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    log(`workspace is invalid: ${parsed.error.message}`);
    process.exit(1);
  }

  const handles: ScheduledHandle[] = scheduleWorkspace(parsed.data, {
    report: log,
    run: async (cron): Promise<void> => {
      // The job now runs, and its result comes back out. What it runs is an
      // echo - see src/task.ts for why that is the whole implementation at
      // this stage and what replaces it.
      const result = echoTask(cron);
      log(`job "${result.cron}" -> ${result.output}`);
    },
  });

  const shutdown = (): void => {
    log("stopping");
    for (const handle of handles) handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
