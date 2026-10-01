import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openWork, propose, get } from "../src/work";
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
  return made.item.id;
}

const opts = { repo: "", stateDir: "", ask: async () => "approve - fine" };

describe("reading a branch does not execute it", () => {
  test("a .gitattributes diff driver on the branch never RUNS", async () => {
    const dir = repo();
    const state = stateDir();
    const id = seeded(state);
    const g = (...a: string[]): string =>
      execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();

    // A driver script that leaves evidence behind if it is ever executed.
    const marker = join(dir, "DRIVER_RAN");
    const driver = join(dir, "evil.sh");
    writeFileSync(driver, `#!/bin/sh${NL}touch "${marker}"${NL}cat "$1"${NL}`);
    chmodSync(driver, 0o755);

    const base = resolveBase(dir);
    g("checkout", "-q", "-b", `cod/${id}`);
    writeFileSync(join(dir, ".gitattributes"), `*.md diff=${NL}`);
    writeFileSync(join(dir, "notes.md"), "changed" + NL);
    g("add", "-A");
    g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "with attributes");
    g("checkout", "-q", base);
    mkdirSync(join(state, "work"), { recursive: true });

    const h = openWork(state);
    const item = get(h, id);
    h.close();
    await landWork(dir, item!, { ...opts, repo: dir, stateDir: state });

    // The whole point: the file must not exist.
    expect(existsSync(marker)).toBe(false);
  });
});

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
