/**
 * Deciding whether a run actually worked.
 *
 * Exit code 0 is not evidence. We shipped a real bug where an agent was given
 * no instructions at all, produced a confident answer, exited 0, and the job
 * looked fine - because the model was competent enough to guess what was being
 * asked. Judging the STREAM is what makes that class of failure impossible.
 *
 * The upstream truncation bug is what makes this load-bearing rather than
 * belt-and-braces: opencode can exit 0 having dropped the tail of the event
 * stream, so a clean exit and a completed run are different questions and only
 * the stream answers the second one.
 *
 * Order matters and is deliberate. The prompt check comes first, before the
 * stream is even consulted, because a call that was never properly given a task
 * cannot be rescued by a well-formed answer to the wrong question. The exit
 * code is checked late on purpose: it is the weakest signal available, so
 * every stronger signal gets a chance to speak first.
 */

import { parseEventStream, type AgentTokens } from "./events";

/**
 * Below this, the agent was not really told what to do.
 *
 * Not a style preference. The AGENTS.md bug produced a completely empty
 * instruction, and a real model cheerfully did something reasonable anyway.
 * This is the cheapest mechanical guard against ever shipping that again.
 */
export const MIN_PROMPT_LENGTH = 20;

export interface JudgeInput {
  /** stdout and stderr, concatenated, as the JSONL stream. */
  readonly raw: string;
  readonly code: number;
  readonly timedOut: boolean;
  readonly elapsedMs: number;
  /** Length of the prompt actually sent. */
  readonly promptLength: number;
  /** Wall-clock budget. A run that overran it has not been judged on merit. */
  readonly budgetMs?: number;
  /**
   * False for a read-only job, which legitimately completes no tool.
   *
   * The ONE relaxation of the tool rule, and it is opt-in per job. Everything
   * else - the terminal step_finish, the absence of error events, the prompt -
   * still has to hold, so "read-only" cannot be used to excuse a run that did
   * not happen.
   */
  readonly expectTools?: boolean;
}

export interface Verdict {
  readonly ok: boolean;
  /** One line, operator-readable. */
  readonly reason: string;
  /** What ran, when it passed. */
  readonly detail?: string;
  /** The provider's correlation id, when the stream carried one. */
  readonly ref?: string;
  readonly tokens: AgentTokens | null;
  readonly completedTools: readonly string[];
}

export function judgeRun(input: JudgeInput): Verdict {
  const parsed = parseEventStream(input.raw);
  const ref = parsed.errors.find((error) => error.ref !== undefined)?.ref;

  const verdict = (ok: boolean, reason: string, detail?: string): Verdict => ({
    ok,
    reason,
    ...(detail === undefined ? {} : { detail }),
    ...(ref === undefined ? {} : { ref }),
    tokens: parsed.tokens,
    completedTools: parsed.completedTools,
  });

  if (input.promptLength < MIN_PROMPT_LENGTH) {
    return verdict(false, `prompt too short (${input.promptLength} chars); the agent was not given a task`);
  }
  if (input.timedOut) {
    return verdict(false, `agent timed out after ${input.elapsedMs}ms`);
  }
  if (input.budgetMs !== undefined && input.elapsedMs > input.budgetMs) {
    return verdict(false, `run took ${input.elapsedMs}ms, over the ${input.budgetMs}ms budget`);
  }
  if (parsed.errors.length > 0) {
    return verdict(false, `agent reported an error: ${parsed.errors[0]?.message ?? "unknown"}`);
  }
  if (input.code !== 0) {
    // The stderr and the unreadable lines go in the reason, not just the
    // count. `agent exited 3` on its own is the useless "no detail" we set out
    // to replace, and the detail is usually sitting right there in the output
    // we already parsed and threw into `unparsed`.
    const noise = [...parsed.unparsed].join(" ").trim();
    return verdict(false, `agent exited ${input.code}${noise === "" ? "" : `: ${noise}`}`);
  }
  if (parsed.answer === "" && parsed.steps.length === 0 && parsed.completedTools.length === 0) {
    // An entirely empty stream is a different thing from a truncated one, and
    // saying "truncated" about a run that produced nothing at all sends the
    // operator looking for the wrong bug.
    return verdict(false, "agent produced no text and no events");
  }
  if (!parsed.finished) {
    return verdict(false, "no terminal step_finish: the run was truncated, not completed");
  }
  if (parsed.answer === "") {
    return verdict(false, "agent produced no text");
  }
  if (input.expectTools !== false && parsed.completedTools.length === 0) {
    // The wrong-reason case, stated plainly: confident text and a clean exit
    // with nothing having completed means the agent claimed to do something it
    // did not do. That is a failed job wearing a successful-looking record.
    return verdict(false, "no completed tool: the agent produced text without doing anything");
  }
  if (parsed.completedTools.length === 0) {
    // Read-only and opt-in. Still required to have finished cleanly and to
    // have been given a real prompt, so this is a narrower pass, not a bypass.
    return verdict(true, "ok", "read-only run, no tool expected");
  }
  return verdict(true, "ok", `${parsed.completedTools.length} tool(s): ${parsed.completedTools.join(", ")}`);
}
