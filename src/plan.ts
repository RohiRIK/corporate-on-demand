/**
 * Planning: a department's standing purpose, turned into one concrete task.
 *
 * The company used to ask a department to "propose" its next work and then do
 * nothing with the answer: the planning job ran, its text landed in a ledger
 * column, and no part of the system read it. Worse, the proposal that started it
 * had the same novelty key every time, so a department could only ever propose
 * once - the company did one round of work in its lifetime and then idled.
 *
 * Now a department proposes a PLAN, the plan runs read-only, and its answer is
 * parsed into a TASK with a goal, the paths it expects to touch and a way to
 * tell it worked. The task is proposed like any other work: the reconciler
 * derives its radius from those paths, global work is refused by rule, and the
 * reviewer later judges the change against the goal and the named paths.
 */

import { assertSafeTargetPath } from "./work";
import { globalPathsSummary } from "./boundary";

export interface Plan {
  readonly goal: string;
  readonly paths: readonly string[];
  readonly check: string;
}

export type PlanResult =
  | { readonly kind: "plan"; readonly plan: Plan }
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly reason: string };

/** The answer format a planner is asked for. */
export function planningPrompt(department: string, company: string, purpose: string): string {
  return [
    `You are the ${department} department of ${company}.`,
    `Your department exists to: ${purpose}`,
    "",
    "This is PLANNING, not doing. Look at the repository in your working directory",
    "and decide the single most useful next step toward that purpose. Do not change",
    "any file and do not commit anything.",
    "",
    "Answer in exactly this format, three lines:",
    "GOAL: <one sentence saying what to do>",
    "PATHS: <comma-separated repository paths you expect to create or change>",
    "CHECK: <how anyone could tell it worked>",
    "",
    'If nothing is worth doing right now, answer "GOAL: none".',
    `Do not name these paths - they are global and only the CEO changes them: ${globalPathsSummary()}.`,
  ].join("\n");
}

const MAX_GOAL = 300;

/** One labelled line - GOAL:, PATHS:, CHECK: - tolerating markdown around it. */
function field(output: string, label: string): string | null {
  for (const raw of output.split("\n")) {
    const line = raw.trim().replace(/^[\s>#*_`\-•]+/, "");
    const match = new RegExp(`^${label}\\s*[*_]*\\s*[:\\-\\u2013\\u2014]\\s*[*_]*\\s*(.*)$`, "i").exec(line);
    if (match !== null) return (match[1] ?? "").replace(/[*_`]+$/, "").trim();
  }
  return null;
}

/**
 * Read a planner's answer. Strict about what it accepts, because the result
 * becomes a task that an agent with tools will be dispatched to do.
 */
export function parsePlan(output: string): PlanResult {
  const goal = field(output, "goal");
  if (goal === null || goal === "") return { kind: "invalid", reason: "the plan had no GOAL line" };
  if (/^(none|nothing)\b/i.test(goal)) return { kind: "none" };
  if (goal.length > MAX_GOAL) return { kind: "invalid", reason: `the GOAL is ${goal.length} chars; the limit is ${MAX_GOAL}` };

  const rawPaths = field(output, "paths") ?? "";
  const paths = rawPaths
    .split(",")
    .map((p) => p.trim().replace(/^[`"']+|[`"']+$/g, "").replace(/^\.\//, ""))
    .filter((p) => p !== "" && !/^(none|n\/a|-)$/i.test(p));
  for (const path of paths) {
    try {
      assertSafeTargetPath(path);
    } catch (error) {
      return { kind: "invalid", reason: (error as Error).message };
    }
  }
  if (paths.length > 20) return { kind: "invalid", reason: `the plan names ${paths.length} paths; a single step names at most 20` };

  const check = (field(output, "check") ?? "").slice(0, MAX_GOAL);
  return { kind: "plan", plan: { goal, paths: [...new Set(paths)], check } };
}

/** The payload a planned task carries: what to do, and how it will be judged. */
export function taskPayload(plan: Plan): string {
  return plan.check === "" ? plan.goal : `${plan.goal}\n\nDone when: ${plan.check}`;
}
