/**
 * Is the landing repository usable? Checked once, at start-up.
 *
 * The failure this moves earlier: `cod up` succeeded, agents worked, work was
 * reviewed and merged - and only then did the push fail, because the path was a
 * typo. Nothing was lost, but the operator found out minutes or hours late, and
 * the item reported `landed` with the failure buried in the reason.
 *
 * Cheap to check once and impossible to check usefully later. So it happens
 * before the container exists, where a refusal costs a `cod up` that never
 * started rather than a merge that already happened.
 */

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

export interface LandingCheck {
  readonly ok: boolean;
  /** Says what to do, not just what is wrong. */
  readonly reason?: string;
}

function git(repo: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Is this path a git repository with somewhere to push to?
 *
 * Three refusals and each one is a per-merge failure if it is missed:
 * the path does not exist, it is not a repository, or it has no `origin`. The
 * first is the typo; the third is the one that looks most configured and fails
 * every single time.
 */
export function checkLandingRepo(path: string): LandingCheck {
  if (path.trim() === "") {
    return { ok: false, reason: "landing.repo is empty; remove the block or name a repository" };
  }
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: `landing.repo "${path}" does not exist; create it, or remove the landing block from cod.json`,
    };
  }
  if (!statSync(path).isDirectory()) {
    return { ok: false, reason: `landing.repo "${path}" is not a directory` };
  }
  if (git(path, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return {
      ok: false,
      reason: `landing.repo "${path}" is not a git repository; run \`git init\` there`,
    };
  }
  const origin = git(path, ["remote", "get-url", "origin"]);
  if (origin === null || origin === "") {
    return {
      ok: false,
      reason: `landing.repo "${path}" has no origin to push to; run \`git remote add origin <url>\` there`,
    };
  }
  return { ok: true };
}