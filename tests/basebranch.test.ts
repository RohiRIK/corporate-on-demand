import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openWork, propose, get, claimById, commit } from "../src/work";
import { landWork, resolveBase } from "../src/land";

/**
 * The merge base is a FACT ABOUT THE REPOSITORY, not a constant in the source.
 *
 * `git diff master...${branch}` was hardcoded in land.ts and change.ts. On a
 * repository whose initial branch is `main` - git's own default - that is:
 *
 *   fatal: ambiguous argument 'main...agent': unknown revision
 *
 * which returns null, which landWork reports as `skipped`, NOT as a failure.
 * So every item silently skipped, forever, while the review loop reported a
 * healthy skip. That is the single most likely reason nothing has ever merged.
 *
 * Every fixture in this repository ran `git init -b master`, which baked the
 * assumption into existence. These fixtures use `main` on purpose.
 */

const dirs: string[] = [];

function repo(branch = "main"): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-base-"));
  dirs.push(dir);
  const g = (...a: string[]): string =>
    execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", branch, ".");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  return dir;
}

function branchWith(dir: string, name: string, path: string, body: string): void {
  const g = (...a: string[]): string =>
    execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  // Resolved BEFORE the new branch exists. The first version called
  // resolveBase() at the end, when HEAD was already the feature branch - so it
  // resolved to that branch and "checked out" to itself, leaving the diff
  // empty and the verdict `skipped`. The helper was reproducing the symptom it
  // was supposed to detect.
  const base = resolveBase(dir);
  g("checkout", "-q", "-b", name);
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), body);
  g("add", "-A");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "change");
  g("checkout", "-q", base);
}

function seeded(state: string): string {
  const handle = openWork(state);
  const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "do it", goal: "do it", targetPaths: ["notes/a.md"] });
  handle.close();
  if (!made.ok || made.item === undefined) throw new Error("seed");
  // Finished the way the real worker finishes - claimed by id, committed done -
  // because only finished work is reviewed.
  const finisher = openWork(state);
  finisher.db.query("UPDATE work SET state = 'ready' WHERE id = ?").run(made.item.id);
  const claimed = claimById(finisher, made.item.id, "test-worker");
  if (claimed !== null) commit(finisher, made.item.id, claimed.lease_epoch, "done", "worker finished");
  finisher.close();
  return made.item.id;
}

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-base-state-"));
  dirs.push(dir);
  return dir;
}

const opts = { repo: "", stateDir: "", ask: async () => "approve - looks right" };

describe("resolveBase", () => {
  test("finds `main` in a main repository", () => {
    expect(resolveBase(repo("main"))).toBe("main");
  });

  test("finds `master` in a master repository", () => {
    expect(resolveBase(repo("master"))).toBe("master");
  });

  test("never invents a branch that is not there", () => {
    // A repo on main must NOT resolve to master just because that string is in
    // the fallback list.
    const dir = repo("main");
    // --quiet makes the missing ref a non-zero exit rather than a throw, which
    // is what resolveBase relies on too.
    const exists = (ref: string): boolean => {
      try {
        execFileSync("git", ["-C", dir, "rev-parse", "--verify", "--quiet", ref], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
        return true;
      } catch {
        return false;
      }
    };
    expect(exists("master")).toBe(false); // premise: no master here
    expect(resolveBase(dir)).not.toBe("master");
  });
});

describe("landing works on a main-based repository", () => {
  test("an approved change is merged - the thing that silently never happened", async () => {
    const dir = repo("main");
    const state = stateDir();
    const id = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "v1" + String.fromCharCode(10));
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    const result = await landWork(dir, item!, { ...opts, repo: dir, stateDir: state });
    expect(result.outcome).toBe("landed");
    // Assert the TREE, not just the verdict - the verdict was "skipped" while
    // nothing landed, which is exactly the failure being closed.
    expect(existsSync(join(dir, "notes/a.md"))).toBe(true);
  });

  test("a rejected change is still rejected, and not merely skipped", async () => {
    const dir = repo("main");
    const state = stateDir();
    const id = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "v1" + String.fromCharCode(10));
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    const result = await landWork(dir, item!, { ...opts, repo: dir, stateDir: state, ask: async () => "request changes - no test" });
    expect(result.outcome).toBe("changes-requested");
    expect(result.outcome).not.toBe("skipped");
  });
});

// In afterAll, not at module top level: top-level code runs while bun is
// COLLECTING the tests, before any directory exists, and so deleted nothing.
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
