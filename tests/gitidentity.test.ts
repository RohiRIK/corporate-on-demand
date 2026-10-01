import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

/**
 * A merge that depends on an AMBIENT git identity works on my machine and fails
 * in CI.
 *
 * That is exactly what happened: four `landWork` tests passed locally and failed
 * on the runner with `git merge failed`, because the runner has no global
 * user.name/user.email and the container does. Not a test artefact - a real
 * dependence on the environment, which would also bite anyone running this
 * outside the image.
 *
 * The environment is reproduced rather than mocked, because mocking git would
 * have hidden exactly the thing that broke.
 */

// Resolved from this file, not hardcoded.
//
// The first version hardcoded my local bun path, and it passed on my machine
// and returned EMPTY on CI - which failed for the fourth time in a row on a
// test whose whole purpose was to work somewhere else. `process.execPath` is
// the bun running these tests, so it is correct on every machine.
const REPO = resolve(import.meta.dir, "..");

function land(): string {
  // GIT_CONFIG_GLOBAL=/dev/null removes every global setting.
  //
  // spawnSync rather than execFileSync, and BOTH streams, because `bun test`
  // writes its results to stderr - the first version of this captured stdout
  // only and asserted against a version banner, which passed nothing and failed
  // for the wrong reason.
  const r = spawnSync(
    process.execPath,
    ["test", "./tests/land.test.ts", "-t", "an approved change is merged into master"],
    {
      encoding: "utf8",
      timeout: 300_000,
      cwd: REPO,
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    },
  );
  return `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
}

describe("landing without an ambient git identity", () => {
  test("there is no global git identity to lean on", () => {
    // Guards the premise. If a global identity exists, this whole file is
    // vacuous and would pass for the wrong reason - which is the failure mode
    // this file exists to catch.
    let name = "";
    try {
      name = execFileSync("git", ["config", "--global", "user.email"], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
      }).trim();
    } catch {
      name = "";
    }
    expect(name).toBe("");
  });

  test("the merge still happens", () => {
    const out = land();
    expect(out).toContain("1 pass");
    expect(out).not.toContain("git merge failed");
  });
});
