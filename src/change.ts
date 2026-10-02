/**
 * Reading what a job actually did.
 *
 * The agent commits its own work, so the supervisor does not have to - but it
 * still has to KNOW, because the boundary check and the owner's report are both
 * derived from what is on disk rather than from what the agent said it did.
 *
 * Everything here is best-effort and returns an empty set on any git failure. A
 * job whose worktree has no repository yet has changed nothing, and that is a
 * fact rather than an error.
 */

import { gitOut, resolveBase, SAFE_DIFF_FLAGS as DIFF_FLAGS, SAFE_DIFF_OPTIONS } from "./git";

export interface JobChange {
  readonly changed: readonly string[];
  readonly commits: number;
  readonly head: string | null;
}

const EMPTY: JobChange = { changed: [], commits: 0, head: null };

/**
 * Flags that stop git EXECUTING anything while reading a branch.
 *
 * Kept as exports for the callers that already use them; the definitions live
 * in src/git.ts with the rest of the supervisor's git hardening.
 */
export const SAFE_DIFF_FLAGS = DIFF_FLAGS;

/**
 * Diff options, which go AFTER the subcommand.
 *
 * Passing them before `diff` makes git fail outright - which is how the first
 * version of this broke twenty-five tests with a bare `skipped`.
 */
export const NO_EXT_DIFF = SAFE_DIFF_OPTIONS;

/**
 * What changed on this branch, relative to where it started.
 *
 * Measured against the branch's merge base rather than against the current
 * HEAD of the main line, so it reports THIS job's work and not whatever landed
 * on the line while it ran.
 *
 * The default base is the REPOSITORY's base branch. It used to be resolved from
 * the worktree's own HEAD - which, in a job worktree, IS the job branch - so the
 * merge base was HEAD itself, every job reported zero commits and no changed
 * files, every mutating cron job was recorded as "changed nothing", and the
 * global-path check never saw a single path. src/git.ts resolveBase now reads
 * the main checkout's HEAD and never answers with a `cod/` branch.
 */
export function readJobChange(workdir: string, baseRef?: string): JobChange {
  const base = gitOut(workdir, ["merge-base", "HEAD", baseRef ?? resolveBase(workdir)]);
  if (base === null || base === "") return EMPTY;
  const changed = gitOut(workdir, [...DIFF_FLAGS, "diff", ...SAFE_DIFF_OPTIONS, "--name-only", `${base}..HEAD`]);
  const commits = gitOut(workdir, ["rev-list", "--count", `${base}..HEAD`]);
  const head = gitOut(workdir, ["rev-parse", "--short", "HEAD"]);
  return {
    changed: changed === null || changed === "" ? [] : changed.split("\n").filter((line) => line.trim() !== ""),
    commits: commits === null || commits === "" ? 0 : Number(commits) || 0,
    head,
  };
}
