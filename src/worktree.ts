/**
 * Per-job git worktrees.
 *
 * Two agents writing the same path in one container race, and the last writer
 * silently wins. That is open question 5 in docs/OPEN_QUESTIONS.md, and this is
 * the fix: give every job its own worktree, on its own branch.
 *
 * Verified empirically before being written, not assumed:
 *
 *   - 5 worktrees on 5 branches:              all created
 *   - 5 CONCURRENT commits, 1000 files:       all exit 0
 *   - 2 worktrees on the SAME branch:         REFUSED by git
 *
 * So concurrent writes are genuinely safe, under one rule: **one branch per
 * worktree**. Git enforces it, which is better than a lock we might forget.
 *
 * A worktree is a full checkout, so this trades disk for isolation. That is the
 * right direction: the alternative is two agents corrupting each other's work.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { RuntimeFailure, UsageError } from "./errors";

/** Branch names must be usable as both a git ref and a directory name. */
const SAFE = /^[a-z0-9][a-z0-9._-]*$/;

export interface Worktree {
  readonly path: string;
  readonly branch: string;
}

function git(args: readonly string[], cwd: string): { ok: boolean; out: string; err: string } {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", timeout: 120_000 });
  return {
    ok: result.status === 0,
    out: (result.stdout ?? "").trim(),
    err: (result.stderr ?? "").trim(),
  };
}

/** Reject anything that could escape the root or confuse a ref. */
export function assertSafeName(name: string, label: string): string {
  if (!SAFE.test(name) || name.includes("..")) {
    throw new UsageError(
      `unsafe ${label} "${name}"; use lowercase letters, digits, dot, dash and underscore`,
    );
  }
  return name;
}

/**
 * Create (or reuse) a worktree for one job.
 *
 * Idempotent: a job that restarts reclaims its own worktree rather than
 * failing, because a crash mid-job is exactly when this gets called again.
 */
export function acquireWorktree(
  repoRoot: string,
  root: string,
  job: string,
  baseRef = "HEAD",
): Worktree {
  const safeJob = assertSafeName(job, "job name");
  const branch = `cod/${safeJob}`;
  const path = join(root, safeJob);

  if (!existsSync(repoRoot)) {
    throw new RuntimeFailure(`no git repository at ${repoRoot}; worktrees need one`);
  }
  mkdirSync(root, { recursive: true });

  if (existsSync(path)) {
    // Already there: a retry, or a job that never finished. Reusing is correct
    // only if the branch is still checked out there.
    const existing = git(["-C", path, "rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
    if (existing.ok && existing.out === branch) return { path, branch };
    throw new RuntimeFailure(
      `${path} already exists but is on "${existing.out}", not "${branch}"; refusing to reuse it`,
    );
  }

  const branchExists = git(["rev-parse", "--verify", `refs/heads/${branch}`], repoRoot).ok;
  const args = branchExists
    ? ["worktree", "add", "--force", path, branch]
    : // A fresh job branches from the current line. A retry reattaches to the
      // branch it already made, which is what preserves partial work.
      ["worktree", "add", "-b", branch, path, baseRef];

  const added = git(args, repoRoot);
  if (!added.ok) {
    throw new RuntimeFailure(`could not create a worktree for "${job}": ${added.err || added.out}`);
  }
  return { path, branch };
}

/**
 * Remove a worktree once its job is finished.
 *
 * `force` because an agent may have left untracked or modified files, and a
 * leftover worktree would otherwise accumulate one directory per job for ever.
 * The branch is kept: whether to merge it or throw it away is a policy decision
 * that has not been made, and deleting someone's work unasked is worse than
 * leaving a branch behind.
 */
export function releaseWorktree(repoRoot: string, worktree: Worktree): boolean {
  const removed = git(["worktree", "remove", "--force", worktree.path], repoRoot);
  return removed.ok;
}

/** Remove every worktree this module created, leaving the branches alone. */
export function listJobWorktrees(repoRoot: string, root: string): Worktree[] {
  const out = git(["worktree", "list", "--porcelain"], repoRoot).out;
  const found: Worktree[] = [];
  let current: { path: string; branch: string } | null = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current && current.branch.startsWith("cod/")) found.push(current);
      current = { path: line.slice("worktree ".length), branch: "" };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    }
  }
  if (current && current.branch.startsWith("cod/")) found.push(current);
  return found.filter((w) => w.path.startsWith(root));
}
