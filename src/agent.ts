/**
 * Running a job for real: an actual model call.
 *
 * The echo this replaces could not fail for interesting reasons, which was
 * exactly why it was useful at first. This can - it shells out, it depends on a
 * free provider, and it can be killed mid-stream. Every one of those failure
 * modes is reported here rather than swallowed, because a failure that vanishes
 * is what makes a schedule untrustworthy.
 *
 * The command runner is injected so the logic is testable without a model.
 *
 * The real one spawns `opencode` DIRECTLY, in this process's own container. An
 * earlier version of this plan used `docker exec`, on the reasoning that the
 * runtime hangs on the host. That reasoning was right and the conclusion was
 * wrong: the supervisor IS the container's PID 1, and the container has neither
 * a docker binary nor a socket - deliberately, so an agent cannot reach the
 * host. A nested `docker exec` therefore failed instantly, and the job reported
 * "agent exited 1" in 4ms. `opencode` is already at /usr/local/bin/opencode.
 */

import { parseEventStream, describeRun, type ParsedStream } from "./events";
import { judgeRun } from "./assert";
import { backendForModel, buildFor } from "./backend";
import { sandboxedArgv, type SandboxChoice, type SandboxPolicy } from "./sandbox";
import type { Cron, Worker } from "./workspace";
import type { StepKind } from "./dispatch";

export const OPENCODE_BIN = "opencode";
export const WORKDIR = "/work";

/**
 * Long enough for a real call (measured 4.4s), short enough that a hung call
 * cannot wedge a scheduler slot indefinitely.
 */
export const DEFAULT_AGENT_TIMEOUT_MS = 180_000;

/** Used when a workspace names no worker. Free, and credential-free. */
export const DEFAULT_MODEL = "opencode/space-bunny-free";

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  /** True when OUR timeout fired, which is a different failure from exit 1. */
  readonly timedOut: boolean;
}

/**
 * Run a command. `cwd` is how the agent is confined to its own worktree.
 *
 * Set on the PROCESS rather than passed to opencode, because `--dir` does not
 * behave the same way for a git worktree - see buildArgs.
 */
export type CommandRunner = (
  args: readonly string[],
  timeoutMs: number,
  cwd?: string,
) => Promise<CommandResult>;

/**
 * The real runner: spawn `opencode` here, in this container.
 *
 * NO SHELL. An argv array, so an argument is an argument.
 *
 * The exit code comes from `proc.exited`, so a non-zero model exit is visible
 * without a shell in the path.
 * No `cd`: the supervisor's working directory is already the work volume, and
 * hardcoding one would silently run agents somewhere they did not ask to work.
 */
export const localRunner: CommandRunner = async (args, timeoutMs, cwd) => {
  // NO SHELL. The argv array goes to execve as-is.
  //
  // This used to be `Bun.spawn(["sh", "-lc", args.join(" ")])`, on the stated
  // grounds that "the prompt can be a single JSON-quoted word". That reasoning
  // was wrong: JSON.stringify escapes `"` and not `$` or a backtick, so
  // joining the arguments handed a shell a string in which model-authored text
  // was live shell source.
  //
  // `sh -lc` is also slower (an extra process per agent run) and loses the
  // ability to pass an argument containing a space as one argument.
  //
  // The exit code the old comment worried about losing is `proc.exited`, read
  // directly below - tests/shellinject.test.ts pins it.
  const proc = Bun.spawn([...args], {
    stdout: "pipe",
    stderr: "pipe",
    // Closed, not inherited. An inherited stdin is an open pipe the model
    // process may wait on, and a job that waits is a job that never settles.
    stdin: "ignore",
    // `cwd` is a WORKING DIRECTORY, NOT A BOUNDARY.
    //
    // This comment used to say "THE BOUNDARY" and that was false. The agent
    // runs with tool use, and cwd sets where the process starts - it does not
    // confine it. Verified live: asked to run `ls /cod/work`, a model did
    // exactly that, from its own worktree.
    //
    // docs/SECURITY_POSTURE.md has always said so plainly - "read isolation
    // between agents is not enforced... this is a convention, not a control" -
    // so the codebase contradicted itself, and the convenient half won.
    //
    // Keeping cwd pointed at the worktree is still correct: it is what makes the
    // AGENTS.md bundle and the task land in the right place. It is a placement
    // decision, and the honest name for it is placement.
    cwd,
  });

  // `Bun.spawn`, NOT `node:child_process` execFile. Measured: the identical
  // command resolves in 3.3s through Bun.spawn and HANGS to its own 40s timeout
  // with empty output through execFile, on this exact runtime. The same command
  // through python's subprocess takes 3.4s, so the child is fine and Bun's
  // execFile is not. Using the native API avoids the bug rather than working
  // around its symptoms.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CommandResult>((resolve) => {
    timer = setTimeout(() => {
      proc.kill();
      resolve({ stdout: "", stderr: "", code: 124, timedOut: true });
    }, timeoutMs);
  });

  const finished = (async (): Promise<CommandResult> => {
    // Both streams are drained concurrently: reading one to completion while the
    // other fills can deadlock on a full pipe buffer.
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { stdout, stderr, code, timedOut: false };
  })();

  try {
    return await Promise.race([finished, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * The prompt.
 *
 * Deliberately short and bounded. An agent given the whole workspace and no
 * boundary will wander; one given a single job and a place to answer will
 * finish. The rules live in the AGENTS.md beside it, where the agent can re-read
 * them; the boundary that is actually enforced is the sandbox.
 */
export function buildPrompt(cron: Cron, company: { name: string; purpose: string } | null): string {
  const who = company === null
    ? "You are an agent in an automated workspace."
    : `You are an agent working for ${company.name}, whose purpose is: ${company.purpose}`;
  return [
    who,
    "",
    `Your job: ${cron.task}`,
    "",
    "Read AGENTS.md in your working directory first: it states your department's",
    "purpose, this job, your boundaries, and your skills. Follow it.",
    "",
    "Do the job and report what you did in plain text. Be brief.",
    "Do not ask questions - there is nobody reading this conversation.",
  ].join("\n");
}

/**
 * The command for one run, on whichever engine the model belongs to.
 *
 * `--pure` keeps third-party plugins out, which matters because this image is
 * meant to contain no code but the pinned binary. `--auto` grants tool use:
 * agents act automatically and the CEO manages them. An agent with tools and no
 * boundary is an unbounded actor; the boundary is the Landlock sandbox the
 * supervisor wraps this command in (src/sandbox.ts), not the prompt.
 *
 * `workdir` is accepted and ignored, deliberately: confinement is the spawn's
 * cwd, because `opencode run --dir <git worktree>` was measured to fail with an
 * opaque "Unexpected server error". The parameter stays so callers that think
 * in terms of a worktree do not have to be changed to use a different engine.
 */
export function buildArgs(cron: Cron, model: string, prompt: string, workdir: string): string[] {
  void workdir;
  return buildFor(backendForModel(model), model, prompt, `cod-${cron.name}`);
}

export interface RunAgentOptions {
  readonly runner?: CommandRunner;
  readonly timeoutMs?: number;
  readonly model?: string;
  readonly company?: { name: string; purpose: string } | null;
  /**
   * Which engine to use. Omit it and the model id decides - so a workspace
   * picks its engine by naming a `kilo/...` model and needs no new field.
   */
  readonly backend?: string;
  /**
   * The job's own worktree: the agent STARTS there. Placement, not confinement -
   * confinement is the sandbox below.
   */
  readonly workdir?: string;
  /**
   * The agent sandbox (src/sandbox.ts). `on` wraps the engine in the Landlock
   * launcher with this policy; `missing` refuses to run at all rather than run
   * unconfined; `off` - an explicit choice in cod.json - runs it as it is.
   */
  readonly sandbox?: { readonly choice: SandboxChoice; readonly policy: SandboxPolicy };
}

/**
 * Run one job. Returns the model's text, or a message saying why there is none.
 *
 * Never throws.
 */
export async function runAgent(
  cron: Cron,
  worker: Worker | null,
  step: (kind: StepKind, label: string) => Promise<void>,
  options: RunAgentOptions = {},
): Promise<string> {
  const runner = options.runner ?? localRunner;
  const timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const model = options.model ?? worker?.model ?? DEFAULT_MODEL;
  const prompt = buildPrompt(cron, options.company ?? null);
  // The model id picks the engine unless the caller insists. An explicit
  // backend is only honoured for a model that engine actually advertises, so
  // the two can never disagree.
  // The model id decides the engine, and an explicit `backend` is only honoured
  // when it agrees with the model's own prefix. Letting the two disagree is how
  // a model ends up dispatched on an engine that cannot serve it.
  const routed = backendForModel(model);
  const backendId = options.backend ?? routed;
  if (options.backend !== undefined && options.backend !== routed) {
    return `${FAILURE_PREFIX} model "${model}" belongs to the ${routed} engine, not ${options.backend}`;
  }
  // The clock starts before the call, because the budget is about wall time the
  // operator is waiting, not about time the model spent generating.
  const startedAt = Date.now();

  await step("plan", `${model}: preparing ${cron.name}`);

  // Required and absent is a refusal, never a quiet downgrade to unconfined.
  if (options.sandbox?.choice.kind === "missing") {
    return `${FAILURE_PREFIX} ${options.sandbox.choice.reason}`;
  }
  const engine = buildFor(backendId, model, prompt, `cod-${cron.name}`);
  const argv = options.sandbox?.choice.kind === "on"
    ? sandboxedArgv(options.sandbox.choice.bin, options.sandbox.policy, engine)
    : engine;

  let result: CommandResult;
  try {
    result = await runner(argv, timeoutMs, options.workdir);
  } catch (error) {
    // The runner is injectable, so a caller could supply one that throws.
    // Reported, not propagated: the job still has to settle and record.
    return `${FAILURE_PREFIX} could not be started: ${truncate((error as Error).message, 400)}`;
  }

  const parsed: ParsedStream = parseEventStream(`${result.stdout}\n${result.stderr}`);

  // Report the model's OWN steps, so a long call looks like progress rather
  // than one long silent step. This is the entire reason the dispatcher exists.
  for (const stepNo of parsed.steps) {
    await step("act", `model step ${stepNo}`);
  }
  await step("observe", describeRun(parsed));

  // ONE judgement, from the stream, rather than a ladder of exit-code checks.
  //
  // The ladder this replaces could not tell a truncated run from a finished
  // one, because both exit 0, and it could not tell "did the work" from "said
  // it did the work". Both of those are exactly the failures this system is
  // built to make impossible, and both were reachable through it.
  //
  // The timeout branch keeps its partial output, because a killed call often
  // produced most of the answer and throwing that away helps nobody.
  const verdict = judgeRun({
    raw: `${result.stdout}\n${result.stderr}`,
    code: result.code,
    timedOut: result.timedOut,
    elapsedMs: Date.now() - startedAt,
    promptLength: prompt.length,
    budgetMs: timeoutMs,
    expectTools: cron.expectTools,
  });
  if (!verdict.ok) {
    // The ref id is the join key to the engine's own log, and this is the
    // only place that has both the id and a reason to look. Bounded to one
    // line, and it never throws: a diagnostic that cannot find anything is
    // not allowed to become a second failure.
    let detail = verdict.detail;
    if (verdict.ref !== undefined) {
      try {
        const { describeDiagnostic } = await import("./diagnose");
        detail = `${detail ?? ""} | ${describeDiagnostic(verdict.ref)}`.trim();
      } catch {
        // A log we cannot read is not a reason to fail the reporting.
      }
    }
    if (result.timedOut) {
      return `${FAILURE_PREFIX} ${verdict.reason}; partial output: ${truncate(parsed.answer || "none", 400)}`;
    }
    return `${FAILURE_PREFIX} ${verdict.reason}${detail === undefined || detail === "" ? "" : ` (${detail})`}`;
  }
  return parsed.answer;
}

/**
 * Did the agent actually do the job?
 *
 * `runAgent` returns a string because that is what the dispatcher's Driver
 * contract is, and the supervisor has been writing `ok: true` for every job
 * that SETTLED - which is true of a run that failed, and so `cod results`
 * cheerfully displayed `ok` for an agent that had reported a provider outage.
 *
 * The assertion's verdict was in the text the whole time; nothing read it. So
 * a job could fail and still be recorded as a success, which is the exact
 * wrong-reason failure this work exists to prevent - reintroduced one layer up.
 * The prefix is therefore a contract, and this is the only thing allowed to
 * interpret it.
 */
export const FAILURE_PREFIX = "agent FAILED:";

export function isAgentFailure(output: string): boolean {
  return output.startsWith(FAILURE_PREFIX);
}

function truncate(text: string, width: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}\u2026`;
}
