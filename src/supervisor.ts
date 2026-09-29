/**
 * The in-container supervisor: reads the mounted workspace and schedules it.
 *
 * Run with `docker exec`, so a crashed supervisor shows up as a failed exec
 * rather than a container that silently restarts in a loop. It must not
 * register anything when Bun.cron is unavailable — see scheduler.ts.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Workspace } from "./workspace";
import { echoTask } from "./task";
import { createLogger, fileSink, newRunId, type Level } from "./log";
import { recordResult } from "./results";
import { heartbeatPath, type Heartbeat } from "./liveness";
import { assertCronSupport, scheduleWorkspace, type ScheduledHandle } from "./scheduler";

const WORKSPACE_FILE = process.env["COD_WORKSPACE_FILE"] ?? "/cod/cod.json";
const LOG_DIR = process.env["COD_LOG_DIR"] ?? "/cod/logs";
const STATE_DIR = process.env["COD_STATE_DIR"] ?? "/cod";

/**
 * Distinguishes two runs inside the same millisecond, which happens whenever
 * several jobs share a minute boundary. Without it one result would overwrite
 * another and a run would go missing with nothing to indicate it.
 */
let runSeq = 0;

/**
 * Write proof of life.
 *
 * The container blocks in `tail -f`, so it stays "up" long after the supervisor
 * dies. This file is the only thing that distinguishes a running schedule from
 * a dead one, and `cod status` reads it to refuse to call a dead supervisor
 * healthy. Written on start and on every tick.
 */
function beat(jobs: readonly string[]): void {
  const heartbeat: Heartbeat = {
    runId: RUN_ID,
    startedAt: STARTED_AT,
    seenAt: Date.now(),
    jobs,
    maxConcurrent: parsedMaxConcurrent,
  };
  try {
    writeFileSync(heartbeatPath(STATE_DIR), `${JSON.stringify(heartbeat, null, 2)}\n`, "utf8");
  } catch (error) {
    log(`could not write the heartbeat: ${(error as Error).message}`, "warn");
  }
}

const STARTED_AT = Date.now();
let parsedMaxConcurrent = 2;

/**
 * The supervisor's run id, fixed for the life of the process.
 *
 * Every event it emits carries it, so `cod logs --run <id>` reconstructs one
 * supervisor's whole life - including across a restart, where a new id
 * appears and the gap between the two is itself the evidence.
 */
const RUN_ID = newRunId();

/**
 * A logger that writes JSONL to the state directory and mirrors to stdout.
 *
 * The file is the record that survives the container; stdout is for whoever is
 * watching. Both go through the same sink so the two can never disagree.
 */
const logger = createLogger({
  sink: fileSink(join(LOG_DIR, "cod.jsonl")),
  level: (process.env["COD_LOG_LEVEL"] as Level | undefined) ?? "info",
  runId: RUN_ID,
});

/** Report to the logger and keep the terminal usable. */
function log(line: string, level: Level = "info"): void {
  logger[level](line);
  const prefix = level === "info" ? "" : `${level}: `;
  process.stdout.write(`[supervisor] ${prefix}${line}\n`);
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

  parsedMaxConcurrent = parsed.data.maxConcurrent;
  const resultRetention = parsed.data.resultRetention;
  const jobNames = parsed.data.crons.filter((c) => c.enabled).map((c) => c.name);
  beat(jobNames);
  log(`heartbeat written for ${jobNames.length} job(s), run ${RUN_ID}`);
  log(`timezone ${parsed.data.timezone} (${new Date().toString().slice(-25)})`);

  const handles: ScheduledHandle[] = scheduleWorkspace(parsed.data, {
    report: log,
    maxConcurrent: parsed.data.maxConcurrent,
    run: async (cron): Promise<void> => {
      beat(jobNames);
      // Prune here rather than on every write, so a busy schedule does not
      // re-scan the directory 500 times a minute.
      const { pruneResults } = await import("./results");
      const pruned = pruneResults(STATE_DIR, resultRetention);
      if (pruned.removed > 0) {
        log(`pruned ${pruned.removed} old result(s), keeping ${resultRetention}`);
      }
      const startedAt = Date.now();
      // Recorded in a `finally` so a FAILED job leaves a trace. A failure that
      // vanishes is exactly what makes a schedule untrustworthy - you cannot
      // debug what you cannot see, and "it just stopped" is the worst report.
      try {
        const result = echoTask(cron);
        log(`job "${result.cron}" -> ${result.output}`);
        recordResult(
          {
            cron: result.cron,
            agent: result.agent,
            task: result.task,
            startedAt,
            finishedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            ok: true,
            output: result.output,
          },
          { stateDir: STATE_DIR, seq: runSeq },
        );
        runSeq += 1;
      } catch (error) {
        const message = (error as Error).message;
        log(`job "${cron.name}" FAILED: ${message}`, "error");
        recordResult(
          {
            cron: cron.name,
            agent: cron.agent,
            task: cron.task,
            startedAt,
            finishedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            ok: false,
            output: "",
            error: message,
          },
          { stateDir: STATE_DIR, seq: runSeq },
        );
        runSeq += 1;
      }
    },
  });

  const shutdown = (): void => {
    log("stopping");
    beat([]);
    for (const handle of handles) handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
