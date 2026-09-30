/**
 * The per-job instruction bundle.
 *
 * An agent that can act needs three things before it starts: what its
 * department is FOR, what it is allowed to touch, and which skills its job
 * needs. All three go into one generated AGENTS.md in the job's own worktree,
 * because that is the one place opencode is verified to read project
 * instructions from - measured, not assumed: with an AGENTS.md present, a model
 * call created the requested file. See tests/skills.test.ts.
 *
 * Regenerated per job, never shared between concurrent jobs. Two jobs writing
 * one AGENTS.md is the same class of bug as two agents writing one result file,
 * and it fails in a way that looks like nondeterminism.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Department, Worker, Workspace } from "./workspace";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where skill bodies live, relative to the repository root.
 *
 * Relative on purpose: an absolute host path baked into the source would break
 * in the container, where the repository is at a different place entirely.
 */
export const SKILLS_DIR = "skills/agent";

/** Absolute path to the bundle, so an audit works from any working directory. */
export function resolveSkillsRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", SKILLS_DIR);
}

/** Every skill name the bundle ships, sorted. */
export function availableSkills(skillsRoot: string): string[] {
  if (!existsSync(skillsRoot)) return [];
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

export interface SkillAudit {
  /** Skills named by a worker that the bundle does not ship. */
  readonly unknown: readonly string[];
  /** Skills named by a worker that resolved. */
  readonly known: readonly string[];
  /** Workers that name no skills at all - a different problem from a typo. */
  readonly untouched: readonly string[];
}

/**
 * Check a workspace's skill names against the bundle.
 *
 * `resolveSkills` deliberately skips names it cannot find and notes the skip in
 * AGENTS.md, so the run continues. That is right for a workspace written before
 * a skill existed, and wrong for a **typo**: the agent then runs with no rule at
 * all and nothing on the surface says why.
 *
 * This makes the difference visible, per worker, without refusing to start.
 */
export function auditWorkspaceSkills(workspace: Workspace): SkillAudit {
  const skillsRoot = resolveSkillsRoot();
  const available = new Set(availableSkills(skillsRoot));
  const unknown: string[] = [];
  const known: string[] = [];
  const untouched: string[] = [];

  for (const department of workspace.departments) {
    for (const worker of department.workers) {
      if (worker.skills.length === 0) {
        untouched.push(`${department.name}/${worker.name}`);
        continue;
      }
      for (const name of worker.skills) {
        if (available.has(name)) known.push(name);
        // Attributed to the worker: "unknown skill: x" does not say whose rules
        // are quietly missing.
        else unknown.push(`${name} (named by ${department.name}/${worker.name})`);
      }
    }
  }
  return { unknown: [...new Set(unknown)], known: [...new Set(known)], untouched };
}

/** The skills a worker is given, skipping any it names but the bundle lacks. */
export function resolveSkills(skillsRoot: string, names: readonly string[]): string[] {
  let available: string[];
  try {
    available = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // A workspace may name skills before the bundle is deployed. That is a
    // degraded agent, not a crashed scheduler.
    return [];
  }
  return names.filter((name) => available.includes(name));
}

/** One skill's body, or a named placeholder if it is missing. */
export function renderSkill(skillsRoot: string, name: string): string {
  try {
    return readFileSync(join(skillsRoot, name, "SKILL.md"), "utf8");
  } catch {
    // Named in the workspace but absent from the bundle is a MISTAKE worth
    // saying out loud, not a crash. An agent that believes it has a skill it
    // cannot read will either invent the content or stall, and both look like
    // the model misbehaving rather than like a packaging fault.
    return `## ${name}\n\n**THIS SKILL IS MISSING from the bundle.** Ask for it rather than improvising.`;
  }
}

/**
 * Build the instruction file for one job.
 *
 * The boundaries live here rather than in the prompt because a file the agent
 * can re-read is more durable than an instruction it read once and forgot.
 */
export function buildInstructions(
  department: Department,
  worker: Worker,
  job: { readonly name: string; readonly task: string },
  blastRadius: number,
  skillsRoot: string,
): string {
  const skills = resolveSkills(skillsRoot, worker.skills);
  const lines = [
    `# ${department.name.toUpperCase()} — ${worker.name}`,
    "",
    "## Standing purpose",
    "",
    department.purpose.length > 0
      ? department.purpose
      : "(none declared — ask the CEO what this department is for before starting work.)",
    "",
    "## This job",
    "",
    job.task,
    "",
    "## Boundaries",
    "",
    `- You are working on branch \`cod/${job.name}\` in your own worktree.`,
    `- Blast radius for this job: ${blastRadius} (0 self-contained, 1 cross-department, 2 global).`,
    blastRadius >= 2
      ? "- **This is global work. Do not act on it. Report to the CEO and stop.**"
      : "- Stay inside this worktree. Do not touch paths outside it.",
    "- Do not push, merge, or force-push. You have no authority to land anything.",
    "- When you are finished, commit your work with a clear message.",
    "",
    "## Skills",
    "",
  ];
  if (skills.length === 0) {
    lines.push("(none assigned to this worker.)", "");
  }
  for (const name of skills) {
    lines.push(renderSkill(skillsRoot, name), "");
  }
  return lines.join("\n");
}

/** Write the bundle into a job worktree. Returns the path written. */
export function writeInstructions(worktreePath: string, contents: string): string {
  mkdirSync(worktreePath, { recursive: true });
  const path = join(worktreePath, "AGENTS.md");
  writeFileSync(path, contents, "utf8");
  return path;
}
