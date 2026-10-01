/**
 * The in-container supervisor: reads the mounted workspace and schedules it.
 *
 * Run with `docker exec`, so a crashed supervisor shows up as a failed exec
 * rather than a container that silently restarts in a loop. It must not
 * register anything when Bun.cron is unavailable — see scheduler.ts.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { Registry } from "./registry";
import { join } from "node:path";
import { Workspace, findWorker } from "./workspace";
import { createLogger, fileSink, newRunId, type Level } from "./log";
import { recordResult } from "./results";
import { beginJob, findAbandoned, formatAbandoned, settleJob } from "./inflight";
import { heartbeatPath, type Heartbeat } from "./liveness";
import { assertCronSupport, scheduleGovernance, scheduleWorkspace, type ScheduledHandle } from "./scheduler";

const WORKSPACE_FILE = process.env["COD_WORKSPACE_FILE"] ?? "/cod/cod.json";
const LOG_DIR = process.env["COD_LOG_DIR"] ?? "/cod/logs";
/**
 * Where the work repository lives, and where per-job worktrees go.
 *
 * `/work` is the volume, so these survive a container restart: a job that dies
 * halfway leaves its branch and its work behind rather than losing it.
 * The worktree root is INSIDE the volume and gitignored, because a worktree
 * nested in the repository it branches from is git's own requirement.
 */
const WORK_REPO = "/work";
const WORKTREE_ROOT = "/work/.cod-worktrees";

/**
 * The blast radius a job runs under.
 *
 * 0 - the NARROWEST - unless the job name opts in. A per-job name convention
 * rather than a model-supplied number, because a self-asserted radius is a
 * trust boundary trusting its subject. The ceiling is clamped: nothing in this
 * function can return above 2, so a bad name cannot grant an unbounded agent.
 */
function blastRadiusFor(cron: { readonly name: string; readonly task: string }): number {
  const global = /(^|[-_.])(global|globalwork)([-_.]|$)/i.test(cron.name);
  if (global) return 2;
  const cross = /(^|[-_.])(cross|crossdept)([-_.]|$)/i.test(cron.name);
  return cross ? 1 : 0;
}

/**
 * One registry for the supervisor's whole life.
 *
 * Process-scoped on purpose. This is a heuristic for ejecting repeat offenders
 * and failing over to another free model, not a ledger: losing it costs
 * nothing and re-learns within a few jobs. A durable copy would be a second
 * source of truth to keep in step with the work ledger, for a problem that does
 * not need one - and the version that existed before this line was a class with
 * tests and no callers, which is the same as not having it.
 */
const REGISTRY = new Registry();

/** The model the reviewer reads with. Free, and rot-prone like the others. */
const REVIEW_MODEL = "kilo/kilo-auto/free";

const STATE_DIR = process.env["COD_STATE_DIR"] ?? "/cod";

/**
 * Dispatch one ledger item through the real agent driver.
 *
 * Shared by the cron path and the governance tick, deliberately: a job run from
 * the ledger and a job run from a schedule must be the same machine, or the
 * second one to change drifts from the first and nobody can tell which is the
 * real behaviour.
 */
async function dispatchWorkItem(workspace: Workspace, workId: string): Promise<{ ok: boolean; reason?: string }> {
  const { openWork, get } = await import("./work");
  const { runWorkItem, briefFor } = await import("./runwork");
  const { resolveTarget } = await import("./assign");
  const { driverFor } = await import("./drivers");
  const { acquireWorktree, releaseWorktree } = await import("./worktree");
  const { buildInstructions, writeInstructions, SKILLS_DIR } = await import("./skills");

  const handle = openWork(STATE_DIR);
  let item;
  try {
    item = get(handle, workId);
  } finally {
    handle.close();
  }
  if (item === null) return { ok: false, reason: `no such work item: ${workId}` };

  // An item is addressed to a DEPARTMENT; a WORKER runs it. Bridging the two
  // is not optional: skipping it is what once left a real agent running with no
  // instructions at all, and still completing the task.
  const target = resolveTarget(workspace, item.to_agent);
  if (target.worker === undefined) {
    return { ok: false, reason: target.reason ?? `no worker for "${item.to_agent}"` };
  }
  if (target.note !== undefined) log(target.note);
  const worker = target.worker;
  const department = target.department;
  const goal = briefFor(item);
  const cron = { name: item.id, agent: worker.name, task: goal, schedule: "0 0 1 1 *", enabled: true, expectTools: true };

  const worktree = acquireWorktree(WORK_REPO, WORKTREE_ROOT, item.id);
  try {
    if (department === undefined) return { ok: false, reason: `${worker.name} has no department` };
    writeInstructions(worktree.path, buildInstructions(department, worker, { name: item.id, task: goal }, 0, SKILLS_DIR));
    const result = await runWorkItem({
      stateDir: STATE_DIR,
      workId,
      cron,
      driver: driverFor(worker, workspace.company, { workdir: worktree.path }, REGISTRY),
    });
    return { ok: result.ok, reason: result.reason };
  } finally {
    releaseWorktree(WORK_REPO, worktree);
  }
}

/** One unattended company tick: propose, meet, dispatch. */
async function governanceTick(workspace: Workspace): Promise<void> {
  const { runGovernance } = await import("./governance");
  const report = await runGovernance(workspace, STATE_DIR, {
    dispatch: (id) => dispatchWorkItem(workspace, id),
    // The meeting gets a VOICE in the live loop. Without it the positions are
    // computed from the ledger - honest arithmetic, but arithmetic - and the
    // output says so. This is the step that makes the meeting a discussion.
    askRole: async (prompt) => {
      const { runAgent } = await import("./agent");
      return runAgent(
        { name: "meeting", agent: "cto", task: prompt, schedule: "0 0 1 1 *", enabled: true, expectTools: false },
        null,
        async () => {},
        { model: REVIEW_MODEL, workdir: WORK_REPO },
      );
    },
    land: async (id) => {
      // The one place that merges. The reviewer is a MODEL call, unlike the
      // mechanical checks beside it, because judging scope and whether a test
      // exists is a judgement. It is still only ever ADVISORY: a mechanical
      // refusal cannot be talked past, and the radius decides who lands.
      const { openWork, get } = await import("./work");
      const { landWork } = await import("./land");
      const { runAgent } = await import("./agent");
      const handle = openWork(STATE_DIR);
      let item;
      try {
        item = get(handle, id);
      } finally {
        handle.close();
      }
      if (item === null) return { outcome: "skipped", reason: `no such work item: ${id}` };
      return landWork(WORK_REPO, item, {
        repo: WORK_REPO,
        stateDir: STATE_DIR,
        landingRepo: workspace.landing === undefined ? undefined : "/landing",
        maxRetries: workspace.governance.maxReviewRetries,
        ask: async (prompt) => {
          const out = await runAgent(
            { name: `review-${id}`, agent: "reviewer", task: prompt, schedule: "0 0 1 1 *", enabled: true, expectTools: false },
            null,
            async () => {},
            { model: REVIEW_MODEL, workdir: WORK_REPO },
          );
          return out;
        },
      });
    },
    // The bound is the company's own concurrency ceiling, not a second number:
    // a tick that launched more than the workspace allows would be the
    // scheduler's rule and the tick's rule disagreeing.
    maxDispatch: parsedConcurrency(workspace),
    actor: "governance",
  });
  log(`[governance] ${report.summary}`);
  for (const failure of report.failed) log(`[governance] failed: ${failure.id} - ${failure.reason}`);
  for (const entry of report.landed) log(`[governance] review: ${entry.id} -> ${entry.outcome}`);
}

function parsedConcurrency(workspace: Workspace): number {
  return typeof workspace.maxConcurrent === "number" && workspace.maxConcurrent > 0
    ? workspace.maxConcurrent
    : 2;
}

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

  // Anything still announced in flight was killed by the last crash. Named on
  // startup, because "where did it stop" is the question a crashed supervisor
  // cannot answer from its own log - the log died with it.
  for (const stuck of findAbandoned(STATE_DIR)) {
    log(`ABANDONED: ${formatAbandoned(stuck)}`, "error");
  }

  const handles: ScheduledHandle[] = scheduleWorkspace(parsed.data, {
    report: log,
    maxConcurrent: parsed.data.maxConcurrent,
    run: async (cron): Promise<void> => {
      beat(jobNames);
      // Announce BEFORE the work. If the supervisor dies mid-job, this marker is
      // the only evidence it happened at all - absence of a result is the signal
      // real schedulers use, and it is the whole point of src/inflight.ts.
      const marker = beginJob(STATE_DIR, cron);
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
        // Through the dispatcher, not around it. The step loop is the reason
        // `dispatch` exists: it is what turns a multi-minute model call into
        // observable progress instead of one long silence.
        //
        // The worker's OWN model is resolved here, because the supervisor is
        // the only thing that holds the parsed workspace. A cron naming a
        // worker that does not exist falls back to the free default and says
        // so, rather than failing a job that could still have run.
        const { dispatch } = await import("./dispatch");
        const { driverFor } = await import("./drivers");
        const { acquireWorktree, releaseWorktree } = await import("./worktree");
        const { buildInstructions, writeInstructions, SKILLS_DIR } = await import("./skills");

        // Each job gets its own git worktree, so concurrent jobs cannot collide
        // and a half-finished job keeps its work. The worktree is ALSO the
        // boundary: `--dir` confines the agent to it, which is what makes the
        // blast-radius check mean anything.
        const worktree = acquireWorktree(WORK_REPO, WORKTREE_ROOT, cron.name);
        const worker = findWorker(parsed.data, cron.agent);
        const department = worker === undefined
          ? undefined
          : parsed.data.departments.find((d) => d.workers.some((w) => w.name === worker.name));
        if (worker !== undefined && department !== undefined) {
          // Radius 0 - the NARROWEST boundary - because an agent now has tools.
          // The ledger currently lets a proposer assert its own radius, which is
          // a trust boundary trusting its subject; defaulting closed is the
          // opposite and stays safe until that radius is derived server-side.
          writeInstructions(
            worktree.path,
            buildInstructions(department, worker, { name: cron.name, task: cron.task }, 0, SKILLS_DIR),
          );
        }
        log(`job "${cron.name}" worktree ${worktree.branch} at ${worktree.path}`);

        try {
        const result = await dispatch(cron, driverFor(worker ?? null, parsed.data.company, { workdir: worktree.path }, REGISTRY), {
          onStep: (step): void => {
            log(`step ${step.no}/${step.kind}: ${step.label} (${step.ms}ms)`);
          },
        });

        // What the job ACTUALLY did, read from disk. The boundary check and
        // the owner's report both come from here rather than from the agent's
        // own account - a self-report is not evidence, which is the same reason
        // the end-to-end checks never grep the output for a phrase they asked
        // for.
        const { isAgentFailure } = await import("./agent");
        const { readJobChange } = await import("./change");
        const { classifyChange, summariseChange } = await import("./boundary");
        const change = readJobChange(worktree.path);
        const classified = classifyChange(change.changed, blastRadiusFor(cron));
        log(`job "${cron.name}" ${summariseChange(classified)} (${change.commits} commit(s), head ${change.head ?? "none"})`);

        log(`job "${result.cron}" -> ${result.output}`);
        recordResult(
          {
            cron: result.cron,
            agent: result.agent,
            task: result.task,
            startedAt,
            finishedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            // NOT unconditionally true. `ok` used to mean "the job settled",
            // which is true of a run that FAILED - so a provider outage was
            // displayed to the owner as a success.
            // `ok` is not "the process exited 0".
            //
            // It used to be, which meant an agent that streamed a perfectly
            // well-formed answer, exited 0, and committed NOTHING was recorded
            // as a success with zero changed files. The most common real
            // outcome - the agent chatted and shipped nothing - produced a
            // clean success line and no demand for a fix.
            //
            // A read-only job is the legitimate exception and has always opted
            // out explicitly via `expectTools: false`, so this cannot reject
            // work that was told to only report.
            ok: !isAgentFailure(result.output) && !(cron.expectTools !== false && change.commits === 0),
            output: result.output,
            branch: worktree.branch,
            changedFiles: classified.changed,
            commitCount: change.commits,
            blastRadius: classified.radius,
            ...(classified.exceeded ? { refused: summariseChange(classified) } : {}),
          },
          { stateDir: STATE_DIR, seq: runSeq },
        );
        } finally {
          // The BRANCH is kept, the worktree is not. A job that dies halfway
          // leaves its commits behind rather than losing them, and the
          // directory does not accumulate one per job for ever.
          try {
            releaseWorktree(WORK_REPO, worktree);
          } catch (releaseError) {
            log(`could not release the worktree for "${cron.name}": ${(releaseError as Error).message}`, "error");
          }
        }
        settleJob(STATE_DIR, marker);
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
        settleJob(STATE_DIR, marker);
        runSeq += 1;
      }
    },
  });

  // The company governing itself. Registered on its OWN interval, not as a cron
  // entry: a cron is a job with a task and an agent, and routing the CEO's cycle
  // through one makes an authority boundary impossible to point at later.
  //
  // Runs one tick immediately on startup rather than waiting a full interval:
  // a company that takes 30 minutes to notice a pending item looks broken, and
  // the first tick after a restart is exactly when there is work to do.
  const governance = scheduleGovernance(parsed.data, async (): Promise<void> => {
    beat(jobNames);
    await governanceTick(parsed.data);
  }, { report: log });
  if (governance !== null) handles.push(governance);
  // Fire and forget: a slow first tick must not delay the supervisor reporting
  // healthy, and a failed tick is logged rather than thrown into startup.
  void governanceTick(parsed.data).catch((error: unknown) => {
    log(`[governance] first tick failed: ${(error as Error).message}`);
  });

  const shutdown = (): void => {
    log("stopping");
    beat([]);
    for (const handle of handles) handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // With no enabled jobs there is nothing to hold the event loop open, so this
  // process exits immediately - and `--restart` turns that into a crash loop
  // that churns the host forever. A freshly initialised workspace has zero
  // crons, so this is the DEFAULT case, not an edge case.
  //
  // Hold the loop with a long timer, and say why: silence here would look
  // identical to a healthy idle supervisor.
  if (jobNames.length === 0) {
    log("no enabled cron jobs; holding the container open until one is added", "warn");
  }
  // One tick, two jobs: report liveness, then converge the ledger.
  //
  // Reconcile is the CEO's loop and it rides the EXISTING interval rather than
  // a new timer - there is already a free 30s tick here, and a second one would
  // be another thing that can drift. It is level-triggered, so running it on
  // every pass regardless of what changed is exactly right: a proposal that
  // landed while the process was down is promoted on the next tick rather than
  // waiting for an event that will never come.
  setInterval(() => {
    beat(jobNames);
    try {
      const { reconcileOnce, formatReport } = require("./reconcile") as typeof import("./reconcile");
      const report = reconcileOnce({ stateDir: STATE_DIR, actor: "supervisor" });
      for (const line of formatReport(report)) {
        if (line.startsWith("nothing to do")) continue;
        log(line);
      }
      for (const error of report.errors) log(`reconcile ERROR ${error}`, "error");
    } catch (error) {
      // A reconcile failure must not take the supervisor down, or one bad
      // ledger stops every cron in the workspace.
      log(`reconcile failed: ${(error as Error).message}`, "error");
    }
  }, 30_000);
}

main();
