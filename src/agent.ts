/**
 * Running a job for real: an actual model call.
 *
 * The echo this replaces could not fail for interesting reasons, which was
 * exactly why it was useful at first. This can - it shells out, it depends on a
 * free provider, and it can be killed mid-stream. Every one of those failure
 * modes is reported here rather than swallowed, because a failure that vanishes
 * is what makes a schedule untrustworthy.
 *
 * The command runner is injected so the logic is testable without Docker and
 * without a model. The real one uses `docker exec`, because the supervisor runs
 * inside the container and the runtime HANGS when invoked on the host: measured
 * 280s with no output, while the provider endpoint returns HTTP 200 in 0.45s.
 * The container path is the one measured working, so it is the one used.
 */

import { execFile } from "node:child_process";
import { parseEventStream, describeRun, type ParsedStream } from "./events";
import type { Cron, Worker } from "./workspace";
import type { StepKind } from "./dispatch";

export const OPENCODE_BIN = "opencode";
export const CONTAINER = "cod-sandbox-cod";
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

export type CommandRunner = (args: readonly string[], timeoutMs: number) => Promise<CommandResult>;

/**
 * The real runner: run inside the container.
 *
 * `-e` is not passed, because `sh -lc` would then swallow the command's exit
 * code; the code is read from the shell's status instead.
 */
export const dockerRunner: CommandRunner = (args, timeoutMs) =>
  new Promise<CommandResult>((resolve) => {
    let settled = false;
    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = execFile(
      "docker",
      ["exec", CONTAINER, "sh", "-lc", `cd ${WORKDIR} && ${args.join(" ")}`],
      { encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const killed = error !== null && "killed" in error && (error as { killed?: boolean }).killed === true;
        const code = error === null ? 0 : typeof (error as { code?: unknown }).code === "number"
          ? ((error as { code?: number }).code as number)
          : 1;
        finish({ stdout: stdout ?? "", stderr: stderr ?? "", code, timedOut: killed });
      },
    );
    child.on("error", () => finish({ stdout: "", stderr: "docker exec could not start", code: 127, timedOut: false }));
  });

/**
 * The prompt.
 *
 * Deliberately short and bounded. An agent given the whole workspace and no
 * boundary will wander; one given a single job and a place to answer will
 * finish. No autonomy model has been chosen, so this does the least defensible
 * thing: it asks for text, and grants no tool use at all.
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
    "Do the job and report what you did in plain text. Be brief.",
    "Do not ask questions - there is nobody reading this conversation.",
    "Do not claim to have changed any files; you cannot.",
  ].join("\n");
}

/**
 * Build the command.
 *
 * `--pure` keeps third-party plugins out, which matters because this image is
 * meant to contain no code but the pinned binary. The model comes from the
 * worker, because per-worker routing is a settled decision.
 *
 * Deliberately NOT `--auto`: that grants tool-use permission, and no decision
 * has been made about what an agent may touch. The prompt is JSON-quoted so a
 * task containing quotes or newlines cannot break the shell command.
 */
export function buildArgs(cron: Cron, model: string, prompt: string): string[] {
  return [
    OPENCODE_BIN, "run", "--pure", "--format", "json",
    "-m", model,
    "--title", `cod-${cron.name}`,
    JSON.stringify(prompt),
  ];
}

export interface RunAgentOptions {
  readonly runner?: CommandRunner;
  readonly timeoutMs?: number;
  readonly model?: string;
  readonly company?: { name: string; purpose: string } | null;
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
  const runner = options.runner ?? dockerRunner;
  const timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const model = options.model ?? worker?.model ?? DEFAULT_MODEL;
  const prompt = buildPrompt(cron, options.company ?? null);

  await step("plan", `${model}: preparing ${cron.name}`);

  let result: CommandResult;
  try {
    result = await runner(buildArgs(cron, model, prompt), timeoutMs);
  } catch (error) {
    // The runner is injectable, so a caller could supply one that throws.
    // Reported, not propagated: the job still has to settle and record.
    return `agent could not be started: ${truncate((error as Error).message, 400)}`;
  }

  const parsed: ParsedStream = parseEventStream(`${result.stdout}\n${result.stderr}`);

  // Report the model's OWN steps, so a long call looks like progress rather
  // than one long silent step. This is the entire reason the dispatcher exists.
  for (const stepNo of parsed.steps) {
    await step("act", `model step ${stepNo}`);
  }
  await step("observe", describeRun(parsed));

  if (result.timedOut) {
    // Partial output is kept: a killed call often produced most of the answer.
    return `agent timed out after ${timeoutMs}ms; partial output: ${truncate(parsed.answer || "none", 400)}`;
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim() || parsed.unparsed.join(" ") || "no detail";
    return `agent exited ${result.code}: ${truncate(detail, 400)}`;
  }
  if (parsed.answer === "") {
    return `agent produced no text; ${parsed.unparsed.length} unreadable line(s)`;
  }
  return parsed.answer;
}

function truncate(text: string, width: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}\u2026`;
}
