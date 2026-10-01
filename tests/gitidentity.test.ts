import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

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

const REPO = "/home/rohi/homelab/projects/corporate-on-demand";

function land(): string {
  // GIT_CONFIG_GLOBAL=/dev/null removes every global setting.
  //
  // spawnSync rather than execFileSync, and BOTH streams, because `bun test`
  // writes its results to stderr - the first version of this captured stdout
  // only and asserted against a version banner, which passed nothing and failed
  // for the wrong reason.
  const r = spawnSync(
    "/home/rohi/.local/bin/bun",
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
