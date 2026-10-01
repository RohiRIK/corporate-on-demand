import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { checkLandingRepo } from "../src/landing";

/**
 * Validate the landing repository at START-UP, not at land time.
 *
 * The failure this replaces: `cod up` succeeded, agents worked, work was
 * reviewed and merged - and only THEN did the push fail because the path was a
 * typo. The merge was not lost, but the operator found out minutes or hours
 * late, and the item reported `landed` with the failure buried in the reason.
 *
 * Cheap to check once and impossible to check usefully later, so it happens
 * before the container exists.
 */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-lr-"));
  dirs.push(dir);
  return dir;
}

function gitRepo(withOrigin: boolean): string {
  const dir = scratch();
  const g = (...a: string[]): string =>
    execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "master", ".");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  if (withOrigin) g("remote", "add", "origin", "https://example.invalid/repo.git");
  return dir;
}

describe("checkLandingRepo", () => {
  test("a real repository with an origin is accepted", () => {
    const result = checkLandingRepo(gitRepo(true));
    expect(result.ok).toBe(true);
  });

  test("a path that does not exist is refused BY NAME", () => {
    // The typo case, which is the whole reason this exists.
    const result = checkLandingRepo(join(scratch(), "nope"));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("does not exist");
  });

  test("a plain directory is refused - landing work into a non-repo loses it", () => {
    const dir = scratch();
    expect(checkLandingRepo(dir).ok).toBe(false);
  });

  test("a repository with NO origin is refused", () => {
    // A local repo with no remote: the push would fail on every single merge,
    // which is exactly the per-merge failure this moves to start-up.
    const result = checkLandingRepo(gitRepo(false));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("origin");
  });

  test("an EMPTY path is refused rather than skipped", () => {
    // `landing: {}` must not quietly mean "no landing": the operator asked.
    expect(checkLandingRepo("").ok).toBe(false);
  });

  test("each message says how to fix THAT problem", () => {
    // Not one generic hint: a missing path and a missing origin need different
    // advice, and a message that says "fix it" has told the operator nothing.
    const missing = checkLandingRepo(join(scratch(), "nope"));
    expect(missing.reason).toContain("landing.repo");
    expect(missing.reason).toMatch(/create it|remove the landing block/);

    const noOrigin = checkLandingRepo(gitRepo(false));
    expect(noOrigin.reason).toContain("git remote add origin");
  });
});

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
