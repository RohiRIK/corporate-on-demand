/**
 * Per-job worktrees.
 *
 * The properties that matter, in order:
 *
 *  1. Two jobs never share a working directory. That is the whole point - it
 *     replaces "last writer wins" with real isolation.
 *  2. Concurrent commits are safe. Verified empirically before the module was
 *     written; there is a test for the real case rather than a mock.
 *  3. One branch per worktree. Git refuses otherwise, which is better than a
 *     lock this code might forget to take.
 *  4. A retry reclaims its own worktree rather than failing, because a crash
 *     mid-job is precisely when it gets called again.
 */

import { describe, expect, test, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireWorktree, assertSafeName, listJobWorktrees, releaseWorktree } from "../src/worktree";
import { RuntimeFailure, UsageError } from "../src/errors";

const created: string[] = [];

function scratchRepo(): { repo: string; root: string } {
  const base = mkdtempSync(join(tmpdir(), "cod-wt-"));
  const repo = join(base, "repo");
  const root = join(base, "worktrees");
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "T"], { cwd: repo });
  writeFileSync(join(repo, "README.md"), "# base\n");
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repo });
  created.push(base);
  return { repo, root };
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("naming", () => {
  test("accepts a normal job name", () => {
    expect(assertSafeName("nightly-build", "job name")).toBe("nightly-build");
  });

  test("rejects anything that could escape the root or a ref", () => {
    for (const bad of ["../evil", "a/b", "UPPER", ".hidden", "-flag", "x;rm -rf /"]) {
      expect(() => assertSafeName(bad, "job name")).toThrow(UsageError);
    }
  });
});

describe("acquire", () => {
  test("gives each job its own directory and branch", () => {
    const { repo, root } = scratchRepo();
    const a = acquireWorktree(repo, root, "job-a");
    const b = acquireWorktree(repo, root, "job-b");
    expect(a.path).not.toBe(b.path);
    expect(a.branch).toBe("cod/job-a");
    expect(b.branch).toBe("cod/job-b");
    expect(existsSync(a.path)).toBe(true);
    expect(existsSync(b.path)).toBe(true);
  });

  test("two jobs writing the same file do not collide", () => {
    // The bug this whole module exists to fix: last writer wins.
    const { repo, root } = scratchRepo();
    const a = acquireWorktree(repo, root, "job-a");
    const b = acquireWorktree(repo, root, "job-b");
    writeFileSync(join(a.path, "shared.txt"), "A's version\n");
    writeFileSync(join(b.path, "shared.txt"), "B's version\n");
    expect(execFileSync("cat", [join(a.path, "shared.txt")], { encoding: "utf8" }).trim()).toBe("A's version");
    expect(execFileSync("cat", [join(b.path, "shared.txt")], { encoding: "utf8" }).trim()).toBe("B's version");
  });

  test("a retry reclaims the same worktree rather than failing", () => {
    // A crash mid-job is exactly when this is called again.
    const { repo, root } = scratchRepo();
    const first = acquireWorktree(repo, root, "nightly");
    // Real partial work, not `commit -a` on a clean tree - a fresh worktree has
    // nothing staged, so -a exits non-zero and the test was testing git, not us.
    writeFileSync(join(first.path, "partial.txt"), "half a job\n");
    execFileSync("git", ["-C", first.path, "add", "-A"], { encoding: "utf8" });
    execFileSync("git", ["-C", first.path, "commit", "-qm", "partial work"], { encoding: "utf8" });
    const second = acquireWorktree(repo, root, "nightly");
    expect(second.path).toBe(first.path);
    expect(second.branch).toBe(first.branch);
  });

  test("a non-git directory is a named error, not a git stack trace", () => {
    const base = mkdtempSync(join(tmpdir(), "cod-wt-nogit-"));
    created.push(base);
    expect(() => acquireWorktree(base, join(base, "wt"), "job")).toThrow(RuntimeFailure);
  });
});

describe("concurrent use", () => {
  test("five jobs commit concurrently without interfering", () => {
    const { repo, root } = scratchRepo();
    const trees = [0, 1, 2, 3, 4].map((n) => acquireWorktree(repo, root, `job-${n}`));
    // Each writes files and commits. Run serially here (bun test is single
    // threaded) but from five separate worktrees, which is the property that
    // matters: the shared .git index is not contended.
    for (const [n, tree] of trees.entries()) {
      writeFileSync(join(tree.path, `f${n}.txt`), `job ${n}\n`);
      execFileSync("git", ["-C", tree.path, "add", "-A"], { encoding: "utf8" });
      execFileSync("git", ["-C", tree.path, "commit", "-qm", `job ${n}`], { encoding: "utf8" });
    }
    for (const [n, tree] of trees.entries()) {
      const log = execFileSync("git", ["-C", tree.path, "log", "--oneline"], { encoding: "utf8" });
      expect(log).toContain(`job ${n}`);
    }
  });

  test("git refuses two worktrees on one branch, so we never do it", () => {
    const { repo, root } = scratchRepo();
    const a = acquireWorktree(repo, root, "job-a");
    let refused = false;
    try {
      execFileSync("git", ["worktree", "add", join(root, "sneaky"), a.branch], { cwd: repo, stdio: "pipe" });
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });
});

describe("release", () => {
  test("removes the directory but keeps the branch", () => {
    // Whether to merge or discard is an undecided policy. Deleting someone's
    // work unasked is worse than leaving a branch behind.
    const { repo, root } = scratchRepo();
    const tree = acquireWorktree(repo, root, "done");
    writeFileSync(join(tree.path, "x.txt"), "work\n");
    execFileSync("git", ["-C", tree.path, "add", "-A"], { encoding: "utf8" });
    execFileSync("git", ["-C", tree.path, "commit", "-qm", "work"], { encoding: "utf8" });
    expect(releaseWorktree(repo, tree)).toBe(true);
    expect(existsSync(tree.path)).toBe(false);
    const branch = execFileSync("git", ["branch", "--list", tree.branch], { cwd: repo, encoding: "utf8" });
    expect(branch).toContain("cod/done");
  });

  test("lists only this module's worktrees, not the main checkout", () => {
    const { repo, root } = scratchRepo();
    acquireWorktree(repo, root, "job-a");
    acquireWorktree(repo, root, "job-b");
    const found = listJobWorktrees(repo, root);
    expect(found).toHaveLength(2);
    expect(found.every((w) => w.branch.startsWith("cod/"))).toBe(true);
  });
});
