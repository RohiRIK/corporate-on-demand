/**
 * Every git command the SUPERVISOR runs, in one place.
 *
 * The supervisor reads and merges branches that agents wrote. Git has more ways
 * to execute a program than hooks: a diff or textconv driver, a filter, an
 * fsmonitor, a pager, anything in a global config file an agent with a shell
 * could have written to `$HOME/.gitconfig`. The merge used to be guarded
 * against hooks alone, and the reads not at all.
 *
 * So every call here:
 *   - runs with no global and no system config (GIT_CONFIG_GLOBAL=/dev/null,
 *     GIT_CONFIG_NOSYSTEM=1), so nothing outside the repository can add a
 *     driver, a hook path or an alias;
 *   - passes `core.hooksPath=/dev/null` and `core.fsmonitor=false`, which beat
 *     anything the repository's own config says;
 *   - never prompts and never opens a pager.
 *
 * Identity is not inherited either, for the same reason: a merge passes its own.
 * The repository's OWN config is still read - git offers no way to refuse it -
 * which is why the agent sandbox keeps agents out of `.git/config` and
 * `.git/hooks` entirely (see src/sandbox.ts).
 *
 * argv arrays only, through execFileSync: there is no shell anywhere here.
 */

import { execFileSync } from "node:child_process";

/** The environment every supervisor-side git command runs with. */
export function safeGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
  };
}

/** Flags that beat the repository's own config, on every command. */
export const SAFE_GIT_FLAGS = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"] as const;

export interface GitResult {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
  readonly code: number;
}

/** Run git in `repo`. Never throws: a failed command is a result, not an exception. */
export function runGit(repo: string, args: readonly string[], timeoutMs = 60_000): GitResult {
  try {
    const out = execFileSync("git", ["-C", repo, ...SAFE_GIT_FLAGS, ...args], {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      env: safeGitEnv(),
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, out: out.trim(), err: "", code: 0 };
  } catch (error) {
    const e = error as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      ok: false,
      out: String(e.stdout ?? "").trim(),
      err: String(e.stderr ?? "").trim(),
      code: typeof e.status === "number" ? e.status : 1,
    };
  }
}

/** stdout of a successful command, or null. The shape most callers want. */
export function gitOut(repo: string, args: readonly string[], timeoutMs = 60_000): string | null {
  const result = runGit(repo, args, timeoutMs);
  return result.ok ? result.out : null;
}

/**
 * Options that keep `git diff` from running anything a branch names.
 *
 * `--no-ext-diff` stops an external diff driver and `--no-textconv` a textconv
 * one - the second was missing, and a textconv driver runs on a plain
 * `git diff` with no external-diff involvement at all. These go AFTER the
 * subcommand: they are diff options, and before `diff` git rejects them.
 */
export const SAFE_DIFF_OPTIONS = ["--no-ext-diff", "--no-textconv"] as const;

/** Git-level flags for reading a branch: no global attributes file either. */
export const SAFE_DIFF_FLAGS = ["-c", "core.attributesFile=/dev/null"] as const;

/**
 * The branch work is merged INTO, discovered from the repository.
 *
 * It was the literal string "master", in two files, and on a repository whose
 * initial branch is `main` every diff failed and every item was silently
 * `skipped`. Then it was "whatever HEAD points at" - and resolveBase is called
 * with a JOB WORKTREE too, whose HEAD is the job's own `cod/` branch, so the
 * base resolved to the branch being measured and every job "changed nothing".
 *
 * Resolution order, most authoritative first:
 *   1. `refs/remotes/origin/HEAD` - what the remote calls default
 *   2. the branch the MAIN checkout's HEAD points at, read through the common
 *      git dir, so a linked worktree answers for the repository, not itself
 *   3. `master`, then `main` - only if that ref genuinely exists
 *
 * A `cod/` branch is never an answer: a job branch is never the base. Step 3 is
 * verified, so a repo on `main` can never resolve to `master`.
 */
export function resolveBase(repo: string): string {
  const common = gitOut(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const inCommon = (args: readonly string[]): string | null =>
    common === null || common === "" ? gitOut(repo, args) : gitOut(repo, [`--git-dir=${common}`, ...args]);
  const candidates: string[] = [];
  const symbolic = inCommon(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (symbolic !== null && symbolic !== "") candidates.push(symbolic.replace(/^origin\//, ""));
  const head = inCommon(["symbolic-ref", "--short", "HEAD"]);
  if (head !== null && head !== "") candidates.push(head);
  candidates.push("master", "main");
  for (const candidate of candidates) {
    if (candidate.startsWith("cod/")) continue;
    const exists = gitOut(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (exists !== null && exists !== "") return candidate;
  }
  return "HEAD";
}
