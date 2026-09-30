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

export interface ParsedStream {
  /** One entry per step_start event, in order. */
  readonly steps: readonly number[];
  /** The model's text, concatenated in order. */
  readonly answer: string;
  /** Token counts, or null when the stream never reached a completion. */
  readonly tokens: AgentTokens | null;
  /** Every non-event line, kept so a failure can be reported rather than hidden. */
  readonly unparsed: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseEventStream(raw: string): ParsedStream {
  const steps: number[] = [];
  const texts: string[] = [];
  const unparsed: string[] = [];
  let tokens: AgentTokens | null = null;

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
      // Left null only if there was NO step_finish at all. A step_finish with
      // no numbers still means the run completed, and reports as zeros.
      tokens = {
        total: counts === null ? 0 : num(counts.total),
        input: counts === null ? 0 : num(counts.input),
        output: counts === null ? 0 : num(counts.output),
        cost: part === null ? 0 : num(part.cost),
      };
    }
  }

  return { steps, answer: texts.join(""), tokens, unparsed };
}

/** One line a human can read, for the log. Never the whole model output. */
export function describeRun(parsed: ParsedStream): string {
  if (parsed.tokens === null) {
    return `${parsed.steps.length} step(s), no completion event`;
  }
  return `${parsed.steps.length} step(s), ${parsed.tokens.total} tokens, cost ${parsed.tokens.cost}`;
}
