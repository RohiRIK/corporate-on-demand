import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openWork, propose, get, claimById, commit } from "../src/work";
import { landWork, resolveBase } from "../src/land";

/**
 * A branch under review must not EXECUTE anything while it is being read.
 *
 * `core.hooksPath=/dev/null` was set on the merge only. But `git diff` will run
 * a diff/filter driver that a `.gitattributes` on the branch under review names
 * - as the uid of whoever ran git, and long before any review decision exists.
 * So the guard has to be on the READ, not only on the merge.
 *
 * The probe writes a file if git ever runs the driver. That file existing is the
 * failure; the assertion is deliberately about the filesystem and not about
 * git's output, because git would report success either way.
 */

const dirs: string[] = [];
const NL = String.fromCharCode(10);

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-dg-"));
  dirs.push(dir);
  const g = (...a: string[]): string =>
    execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "main", ".");
  writeFileSync(join(dir, "notes.md"), "hello" + NL);
  g("add", "-A");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base");
  return dir;
}

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-dg-state-"));
  dirs.push(dir);
  return dir;
}

function seeded(state: string): string {
  const handle = openWork(state);
  const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "do it", goal: "do it", targetPaths: ["notes.md"] });
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

const opts = { repo: "", stateDir: "", ask: async () => "approve - fine" };

/**
 * A branch whose diff, if git ever runs a driver on it, leaves a file behind.
 *
 * The first version of this test named a driver in `.gitattributes` that was
 * never CONFIGURED, so git had nothing to run and the test passed with the
 * guard removed - its own commit said so. These configure a real driver in the
 * repository's config, exactly what an agent with a shell could write, and
 * point the attributes at it through `.git/info/attributes`, which git reads
 * for every diff whatever the branch says.
 */
function armed(kind: "textconv" | "command"): { dir: string; state: string; id: string; marker: string } {
  const dir = repo();
  const state = stateDir();
  const id = seeded(state);
  const g = (...a: string[]): string =>
    execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const marker = join(dir, `DRIVER_RAN_${kind}`);
  const driver = join(dir, `evil-${kind}.sh`);
  writeFileSync(driver, `#!/bin/sh${NL}touch "${marker}"${NL}cat "$1" 2>/dev/null${NL}exit 0${NL}`);
  chmodSync(driver, 0o755);
  g("config", `diff.evil.${kind}`, driver);
  mkdirSync(join(dir, ".git", "info"), { recursive: true });
  writeFileSync(join(dir, ".git", "info", "attributes"), `*.md diff=evil${NL}`);

  const base = resolveBase(dir);
  g("checkout", "-q", "-b", `cod/${id}`);
  writeFileSync(join(dir, "notes.md"), "changed" + NL);
  g("add", "notes.md");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "change notes");
  g("checkout", "-q", base);
  // Premise: the driver really is live for an UNGUARDED diff. Without this the
  // test cannot fail, which is how its first version shipped as theatre.
  const unguarded = execFileSync("git", ["-C", dir, "diff", `${base}...cod/${id}`], { encoding: "utf8" });
  void unguarded;
  if (!existsSync(marker)) throw new Error(`premise failed: an unguarded diff did not run the ${kind} driver`);
  rmSync(marker, { force: true });
  return { dir, state, id, marker };
}

describe("reading a branch does not execute it", () => {
  for (const kind of ["textconv", "command"] as const) {
    test(`a configured diff ${kind} driver never RUNS while the branch is reviewed`, async () => {
      const { dir, state, id, marker } = armed(kind);
      const h = openWork(state);
      const item = get(h, id);
      h.close();
      await landWork(dir, item!, { ...opts, repo: dir, stateDir: state });
      // The whole point: the file must not exist.
      expect(existsSync(marker)).toBe(false);
    });
  }
});

// In afterAll, not at module top level: top-level code runs while bun is
// COLLECTING the tests, before any directory exists, and so deleted nothing.
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
