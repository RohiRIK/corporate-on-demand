/**
 * The `cod work` CLI surface.
 *
 * These exist because of a real bug found by review: `work list --state done`
 * silently listed NOTHING, and created a directory named `done` in the working
 * directory. `--state` is the global state-DIRECTORY flag, so it could never
 * have been a status filter - the two collided, and the directory side effect
 * came from openWork() mkdir'ing whatever path it was handed.
 *
 * So the filter is `--status`, and these tests pin that it filters AND that no
 * stray directory appears. A flag that silently does nothing is worse than one
 * that is missing, because it looks like it worked.
 */

import { describe, expect, test, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-cli-work-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CLI = join(import.meta.dir, "..", "src", "index.ts");

interface Run {
  readonly out: string;
  readonly err: string;
  readonly code: number;
}

function cod(dir: string, ...args: string[]): Run {
  const r = spawnSync(process.execPath, ["run", CLI, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    cwd: dir,
    env: { ...process.env, COD_WORKSPACE: join(dir, "cod.json"), COD_STATE_DIR: join(dir, "state") },
  });
  return { out: r.stdout ?? "", err: r.stderr ?? "", code: r.status ?? 1 };
}

function workspace(dir: string): void {
  const r = cod(dir, "init", "acme", "--yes");
  expect(r.code).toBe(0);
}

describe("cod work list --status", () => {
  test("filters by status, and says so when nothing matches", () => {
    const dir = scratch();
    workspace(dir);
    cod(dir, "work", "propose", "--from", "eng", "--to", "eng", "--goal", "alpha");
    cod(dir, "reconcile");
    cod(dir, "work", "propose", "--from", "eng", "--to", "eng", "--goal", "beta");

    const ready = cod(dir, "work", "list", "--status", "ready");
    expect(ready.out).toContain("ready");
    expect(ready.out).toContain("alpha");
    expect(ready.out).not.toContain("beta");

    const proposed = cod(dir, "work", "list", "--status", "proposed");
    expect(proposed.out).toContain("beta");
    expect(proposed.out).not.toContain("alpha");
  });

  test("a status with no rows is an empty list, not a silent lie", () => {
    const dir = scratch();
    workspace(dir);
    cod(dir, "work", "propose", "--from", "eng", "--to", "eng", "--goal", "alpha");
    const done = cod(dir, "work", "list", "--status", "done");
    expect(done.out).toContain("empty");
  });

  test("does NOT create a directory named after the filter", () => {
    // The bug: --state was the state DIRECTORY, so `--state done` pointed the
    // ledger at ./done and openWork() created it.
    const dir = scratch();
    workspace(dir);
    cod(dir, "work", "propose", "--from", "eng", "--to", "eng", "--goal", "alpha");
    for (const status of ["ready", "done", "running", "proposed"]) {
      const r = cod(dir, "work", "list", "--status", status);
      expect(r.code).toBe(0);
      expect(existsSync(join(dir, status))).toBe(false);
    }
  });

  test("--state still means the state directory, unchanged", () => {
    const dir = scratch();
    workspace(dir);
    const r = cod(dir, "work", "list", "--state", join(dir, "custom-state"));
    expect(r.code).toBe(0);
    // It created the state dir it was told to, and NOT a filtered list.
    expect(existsSync(join(dir, "custom-state"))).toBe(true);
  });

  test("an unknown work subcommand is a clear error, not a crash", () => {
    const dir = scratch();
    workspace(dir);
    const r = cod(dir, "work", "frobnicate");
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("unknown work subcommand");
  });
});

describe("rejected is a real state", () => {
  test("a proposal the CEO refuses is `rejected`, not `failed`", () => {
    // The distinction is real: a refusal never ran, while `failed` means work
    // ran and did not succeed. `rejected` was in the state union from the
    // start and was never used, so nothing could observe the difference.
    const dir = scratch();
    workspace(dir);
    const proposed = cod(dir, "work", "propose", "--from", "eng", "--to", "eng", "--goal", "change the schema", "--blast", "2");
    const matched = /proposed (\S+)/.exec(proposed.out)?.[1];
    expect(matched).toBeDefined();
    const id = matched ?? "";
    const r = cod(dir, "reconcile");
    expect(r.out).toContain(`rejected ${id}`);
    const listed = cod(dir, "work", "list", "--status", "rejected");
    expect(listed.out).toContain(id);
    expect(listed.out).toContain("CEO");
  });
});
