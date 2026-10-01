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

import { execFileSync } from "node:child_process";

export interface JobChange {
  readonly changed: readonly string[];
  readonly commits: number;
  readonly head: string | null;
}

const EMPTY: JobChange = { changed: [], commits: 0, head: null };

function git(workdir: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", ["-C", workdir, ...args], {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * What changed on this branch, relative to where it started.
 *
 * Measured against the branch's merge base rather than against the current
 * HEAD of the main line, so it reports THIS job's work and not whatever landed
 * on the line while it ran.
 */
import { resolveBase } from "./land";

export function readJobChange(workdir: string, baseRef?: string): JobChange {
  // baseRef is a caller-supplied override; the DEFAULT is resolved from the
  // repository rather than being the literal "master", which made every call on
  // a main-based repository merge-base against a branch that does not exist.
  const base = git(workdir, ["merge-base", "HEAD", baseRef ?? resolveBase(workdir)]);
  if (base === null || base === "") return EMPTY;
  const changed = git(workdir, ["diff", "--name-only", `${base}..HEAD`]);
  const commits = git(workdir, ["rev-list", "--count", `${base}..HEAD`]);
  const head = git(workdir, ["rev-parse", "--short", "HEAD"]);
  return {
    changed: changed === null || changed === "" ? [] : changed.split("\n").filter((line) => line.trim() !== ""),
    commits: commits === null || commits === "" ? 0 : Number(commits) || 0,
    head,
  };
}
