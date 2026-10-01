/**
 * The workspace file: the company, its departments, and its workers.
 *
 * This file is meant to be committed and shared. It holds no secrets, so
 * unlike a state directory it belongs in version control.
 *
 * The three starter workers are a *seed*, not a hardcoded special case: they
 * are read from templates/departments/*.json so more departments can be added
 * without touching this schema.
 */

import { z } from "zod";

/**
 * A skill name.
 *
 * Validated as a plain lowercase identifier because it reaches a FILE PATH in
 * the per-job instruction bundle - the same reason the work-item id and the
 * worktree name validate at their boundaries rather than at the point of use.
 */
const SkillName = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and hyphens");

/** Workers write only inside their own directory; this names that directory. */
export const Worker = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and hyphens"),
  role: z.string().min(1),
  model: z.string().min(1),
  /**
   * The skills this worker's JOB needs, resolved from the bundle at dispatch
   * time. Optional and defaulting to empty, so every workspace written before
   * this field existed still loads.
   */
  skills: z.array(SkillName).default([]),
});
export type Worker = z.infer<typeof Worker>;
/**
 * The shape a workspace FILE may contain, before defaults are applied.
 *
 * Distinct from `Worker` because `skills` is optional on disk and present after
 * parsing. A test or a template writing a workspace should be able to omit it
 * without pretending the field exists.
 */
export type WorkerInput = z.input<typeof Worker>;

export const Department = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and hyphens"),
  /**
   * What this department is FOR. It works from this, not from a list of crons.
   *
   * Optional and defaulting to empty on purpose: an empty purpose must be
   * visible as empty rather than silently invented, so the instruction bundle
   * can tell the agent to ask the CEO instead of guessing at a mission.
   */
  purpose: z.string().default(""),
  workers: z.array(Worker).min(1),
});
export type Department = z.infer<typeof Department>;
/** The shape a workspace FILE may contain, before defaults are applied. */
export type DepartmentInput = z.input<typeof Department>;

export const Company = z.object({
  name: z.string().min(1, "the company needs a name"),
  purpose: z.string().min(1, "the company needs to say what it does"),
});
export type Company = z.infer<typeof Company>;

export const Cron = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and hyphens"),
  schedule: z.string().min(1),
  agent: z.string().min(1),
  task: z.string().min(1),
  enabled: z.boolean().default(true),
  /**
   * Set false for a job that only inspects and reports.
   *
   * Exists because the success assertion requires a completed tool, and a
   * read-only job makes no tool call - so "tell me which departments exist"
   * would be reported as a failure forever. The opt-out is PER JOB on purpose:
   * a global relaxation is exactly how the wrong-reason class comes back,
   * because then every job is allowed to claim work it did not do.
   *
   * Defaults to true, so a workspace written before this field existed keeps
   * its strict behaviour.
   */
  expectTools: z.boolean().default(true),
});
export type Cron = z.infer<typeof Cron>;

/**
 * Strict on purpose: a typo in a workspace file should fail loudly at `init`
 * rather than silently drop a worker that someone believed they had hired.
 */
import { DEFAULT_TIMEZONE, isValidTimezone } from "./timezone";

/**
 * How often the company governs itself.
 *
 * Optional and defaulting to ON, because the default company is an autonomous
 * one. A company that needs a human to type `cod cycle` is not autonomous, it
 * is manual with extra steps - and a loop nobody runs is a loop that was never
 * finished.
 */
const Governance = z.object({
  enabled: z.boolean().default(true),
  /** Minutes between ticks. Nonsense falls back to the default. */
  cycleEveryMinutes: z.number().int().positive().optional(),
});

export const Workspace = z
  .object({
    version: z.literal(1),
    company: Company,
    departments: z.array(Department).min(1),
    crons: z.array(Cron).default([]),
    // How many scheduled jobs may run at once. 0 or negative would deadlock,
    // so the schema refuses it here rather than letting a clamp paper over a
    // configuration mistake the user should see.
    maxConcurrent: z.number().int().min(1).max(64).default(2),
    // The clock every cron expression in this file refers to. Validated with
    // Intl rather than trusted, because a zone that silently behaves as UTC is
    // how every schedule here was hours off before this existed.
    timezone: z.string().refine((z) => isValidTimezone(z), {
      message: "not a valid IANA timezone, e.g. Asia/Jerusalem or UTC",
    }).default(DEFAULT_TIMEZONE),
    // How many result files to keep. One file per run means an unbounded
    // directory otherwise: a job every minute is 525,600 files a year.
    resultRetention: z.number().int().min(1).max(100_000).default(500),
    // Present-but-empty stays distinct from absent, so turning governance OFF
    // is an explicit `{"enabled": false}` rather than a deleted block.
    governance: Governance.prefault({ enabled: true }),
    /**
     * Where landed work is pushed, if anywhere.
     *
     * Optional and ABSENT by default, which is the important part. A fresh
     * workspace gets no writable host mount beyond its own state directory, so
     * the operator opts in by naming a path, and until then the behaviour is
     * exactly what it has always been.
     */
    landing: z.object({
      repo: z.string().min(1),
    }).optional(),
  })
  .strict();
export type Workspace = z.infer<typeof Workspace>;

export const WORKSPACE_VERSION = 1 as const;

/** Every worker across every department, flattened. */
export function allWorkers(workspace: Workspace): Worker[] {
  return workspace.departments.flatMap((department) => department.workers);
}

/** The worker an agent name refers to, or undefined. */
export function findWorker(workspace: Workspace, name: string): Worker | undefined {
  return allWorkers(workspace).find((worker) => worker.name === name);
}
