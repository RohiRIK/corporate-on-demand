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

/** Workers write only inside their own directory; this names that directory. */
export const Worker = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and hyphens"),
  role: z.string().min(1),
  model: z.string().min(1),
});
export type Worker = z.infer<typeof Worker>;

export const Department = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and hyphens"),
  workers: z.array(Worker).min(1),
});
export type Department = z.infer<typeof Department>;

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
});
export type Cron = z.infer<typeof Cron>;

/**
 * Strict on purpose: a typo in a workspace file should fail loudly at `init`
 * rather than silently drop a worker that someone believed they had hired.
 */
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
