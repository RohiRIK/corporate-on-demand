/**
 * Parsing the opencode JSONL event stream.
 *
 * `opencode run --format json` emits one JSON object per line, in order:
 * step_start, then one or more `text` parts, then step_finish carrying token
 * counts and cost. This module turns that stream into the two things the
 * dispatcher needs - a progress report per step, and the final answer.
 *
 * Lines that are not JSON are SKIPPED rather than thrown on. A truncated final
 * line is the expected shape of a killed process, and losing the answer to a
 * stray log line would be worse than ignoring it. They are collected in
 * `unparsed` rather than discarded, so a failure can be reported instead of
 * looking like silence.
 *
 * The event shapes here were copied from an observed run, not from
 * documentation. See tests/events.test.ts, whose fixtures are the real lines.
 */

export interface AgentTokens {
  readonly total: number;
  readonly input: number;
  readonly output: number;
  readonly cost: number;
}

/**
 * One provider error, kept rather than flattened.
 *
 * `ref` is the join key: opencode writes the same id into its own log file, so
 * "Unexpected server error" plus a ref becomes a root-cause lookup instead of
 * the useless `agent exited 1: no detail` we used to report.
 */
export interface AgentError {
  readonly name: string;
  readonly message: string;
  readonly statusCode?: number;
  readonly ref?: string;
}

export interface ParsedStream {
  /** One entry per step_start event, in order. */
  readonly steps: readonly number[];
  /** The model's text, concatenated in order. */
  readonly answer: string;
  /** Token counts, or null when the stream never reached a completion. */
  readonly tokens: AgentTokens | null;
  /** Every non-event line, kept so a failure can be reported rather than hidden. */
  readonly unparsed: readonly string[];
  /**
   * A terminal step_finish was seen.
   *
   * This is NOT the same as the run having worked. opencode can exit 0 having
   * dropped the tail of the stream (anomalyco/opencode#31435), so a run with no
   * step_finish is a TRUNCATED run and has to be treated as a failure.
   */
  readonly finished: boolean;
  /** The reason on the terminal step_finish, or null when there was none. */
  readonly finishReason: string | null;
  /**
   * Tools that actually completed.
   *
   * A tool reporting `completed` whose command exited non-zero is NOT here:
   * believing the status field is how a failed build looks like a passing one.
   */
  readonly completedTools: readonly string[];
  readonly errors: readonly AgentError[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseEventStream(raw: string): ParsedStream {
  const steps: number[] = [];
  const texts: string[] = [];
  const unparsed: string[] = [];
  const completedTools: string[] = [];
  const errors: AgentError[] = [];
  let tokens: AgentTokens | null = null;
  let finished = false;
  let finishReason: string | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      unparsed.push(trimmed);
      continue;
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      unparsed.push(trimmed);
      continue;
    }

    if (event.type === "step_start") {
      steps.push(steps.length + 1);
      continue;
    }
    if (event.type === "text") {
      const part = isRecord(event.part) ? event.part : null;
      if (part !== null && typeof part.text === "string") texts.push(part.text);
      continue;
    }
    if (event.type === "step_finish") {
      const part = isRecord(event.part) ? event.part : null;
      const counts = part !== null && isRecord(part.tokens) ? part.tokens : null;
      const reason = part === null ? "" : str(part.reason);
      if (reason !== "") {
        finished = true;
        finishReason = reason;
      }
      // Left null only if there was NO step_finish at all. A step_finish with
      // no numbers still means the run completed, and reports as zeros.
      tokens = {
        total: counts === null ? 0 : num(counts.total),
        input: counts === null ? 0 : num(counts.input),
        output: counts === null ? 0 : num(counts.output),
        cost: part === null ? 0 : num(part.cost),
      };
      continue;
    }
    if (event.type === "tool_use") {
      const part = isRecord(event.part) ? event.part : null;
      const tool = part === null ? "" : str(part.tool);
      const state = part !== null && isRecord(part.state) ? part.state : null;
      const status = state === null ? "" : str(state.status);
      const meta = state !== null && isRecord(state.metadata) ? state.metadata : null;
      const exit = meta === null ? 0 : num(meta.exit);
      if (status === "completed" && exit === 0 && tool !== "") completedTools.push(tool);
      continue;
    }
    if (event.type === "error") {
      const err = isRecord(event.error) ? event.error : null;
      const data = err !== null && isRecord(err.data) ? err.data : null;
      const message = data === null ? "" : str(data.message);
      const ref = /err_[a-z0-9]+/i.exec(message)?.[0];
      errors.push({
        name: err === null ? "" : str(err.name),
        message,
        ...(data !== null && typeof data.statusCode === "number" ? { statusCode: data.statusCode } : {}),
        ...(ref === undefined ? {} : { ref }),
      });
    }
  }

  return { steps, answer: texts.join(""), tokens, unparsed, finished, finishReason, completedTools, errors };
}

/** One line a human can read, for the log. Never the whole model output. */
export function describeRun(parsed: ParsedStream): string {
  if (parsed.tokens === null) {
    return `${parsed.steps.length} step(s), no completion event`;
  }
  return `${parsed.steps.length} step(s), ${parsed.tokens.total} tokens, cost ${parsed.tokens.cost}`;
}
