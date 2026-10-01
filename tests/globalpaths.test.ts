import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openWork, propose, get } from "../src/work";
import { landWork, resolveBase, changedPaths } from "../src/land";
import { isGlobalPath } from "../src/boundary";

/**
 * A global file can be removed, and that removal must be REFUSED.
 *
 * Found by Max, and reproduced before fixing: the global-path check matched
 * `/^\+\+\+ b\/(.+)$/` in the diff TEXT. But
 *
 *   git rm verify.sh   ->  --- a/verify.sh
 *                         +++ /dev/null
 *
 * names the file only on the `---` line, which nothing inspected. A rename emits
 * no `+++` line at all. So `git rm verify.sh` LANDED and verify.sh was gone from
 * master. A global path is the one edit whose ABSENCE is itself the blast
 * radius.
 *
 * Fix: ask git for the changed paths (`--name-status`) instead of parsing text,
 * and feed BOTH sides of a rename to the classifier.
 *
 * These assert master's TREE afterwards, not the verdict string.
 */

const dirs: string[] = [];
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-gp-"));
  dirs.push(dir);
  const g = (...a: string[]): string =>
    execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "main", ".");
  writeFileSync(join(dir, "verify.sh"), "#!/bin/sh" + String.fromCharCode(10));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/thing.ts"), "export const a = 1;" + String.fromCharCode(10));
  writeFileSync(join(dir, "notes.md"), "hello" + String.fromCharCode(10));
  g("add", "-A");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base");
  return dir;
}

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-gp-state-"));
  dirs.push(dir);
  return dir;
}

function seeded(state: string): string {
  const handle = openWork(state);
  const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "do it", goal: "do it", targetPaths: ["notes.md"] });
  handle.close();
  if (!made.ok || made.item === undefined) throw new Error("seed");
  return made.item.id;
}

/** Build the branch with raw git so a DELETE and a RENAME can be expressed. */
function branchScript(dir: string, name: string, script: (g: (...a: string[]) => string) => void): void {
  const g = (...a: string[]): string =>
    execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const base = resolveBase(dir);
  g("checkout", "-q", "-b", name);
  script(g);
  g("add", "-A");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "change");
  g("checkout", "-q", base);
}

const opts = { repo: "", stateDir: "", ask: async () => "approve - looks fine to me" };

describe("changedPaths comes from git, not from diff text", () => {
  test("a DELETED global file is in the change set", () => {
    const dir = repo();
    const g = (...a: string[]): string => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
    branchScript(dir, "cod/del", (gg) => gg("rm", "-q", "verify.sh"));
    expect(changedPaths(dir, "cod/del")).toContain("verify.sh");
  });

  test("a RENAME reports BOTH sides - the global path it left", () => {
    const dir = repo();
    // mkdir first: `git mv` into a missing directory fails, and a failed move
    // would have made this test pass for the wrong reason.
    branchScript(dir, "cod/mv", (gg) => { mkdirSync(join(dir, "notes"), { recursive: true }); gg("mv", "src/thing.ts", "notes/moved.ts"); });
    const paths = changedPaths(dir, "cod/mv");
    expect(paths).toContain("src/thing.ts");
    expect(paths).toContain("notes/moved.ts");
  });
});

describe("a global file cannot be deleted or renamed away", () => {
  test("git rm of a global file is REFUSED and the file survives in master", async () => {
    const dir = repo();
    const state = stateDir();
    const id = seeded(state);
    branchScript(dir, `cod/${id}`, (g) => { g("rm", "-q", "verify.sh"); });
    const h = openWork(state);
    const item = get(h, id);
    h.close();
    const result = await landWork(dir, item!, { ...opts, repo: dir, stateDir: state });
    expect(result.outcome).toBe("rejected");
    // The TREE is the proof. The verdict used to be "landed" with the file gone.
    expect(existsSync(join(dir, "verify.sh"))).toBe(true);
  });

  test("renaming a global file away is REFUSED", async () => {
    const dir = repo();
    const state = stateDir();
    const id = seeded(state);
    branchScript(dir, `cod/${id}`, (g) => { mkdirSync(join(dir, "notes"), { recursive: true }); g("mv", "src/thing.ts", "notes/moved.ts"); });
    const h = openWork(state);
    const item = get(h, id);
    h.close();
    const result = await landWork(dir, item!, { ...opts, repo: dir, stateDir: state });
    expect(result.outcome).toBe("rejected");
    expect(existsSync(join(dir, "src/thing.ts"))).toBe(true);
  });

  test("an ordinary delete is still allowed - only GLOBAL paths are refused", async () => {
    // A gate that refuses everything is not a gate, it is an outage.
    const dir = repo();
    const state = stateDir();
    const id = seeded(state);
    branchScript(dir, `cod/${id}`, (g) => { g("rm", "-q", "notes.md"); });
    const h = openWork(state);
    const item = get(h, id);
    h.close();
    const result = await landWork(dir, item!, { ...opts, repo: dir, stateDir: state });
    expect(result.outcome).not.toBe("rejected");
  });
});

describe("isGlobalPath agrees with the list the gate uses", () => {
  test("verify.sh and src/ are global", () => {
    expect(isGlobalPath("verify.sh")).toBe(true);
    expect(isGlobalPath("src/thing.ts")).toBe(true);
    expect(isGlobalPath("notes/moved.ts")).toBe(false);
  });
});

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
