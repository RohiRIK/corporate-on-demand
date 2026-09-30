/**
 * Workspace identity: the container name and the work volume must both be
 * derived from the workspace FILE PATH, not its basename.
 *
 * The bug this pins. `workVolume` derived its name from the parent directory
 * AND the filename, so two workspaces never shared a volume. `containerName`
 * used only the basename - and the default workspace file is always
 * `cod.json`. So EVERY workspace on the machine was named `cod-sandbox-cod`,
 * and `cod up` reused whichever container it found first.
 *
 * The consequence is silent and bad: the second workspace's jobs ran in the
 * first workspace's container, reading the first workspace's cod.json and
 * writing into the first workspace's state directory. No error, wrong results.
 * Measured during the real-agent work: a job scheduled in one workspace never
 * fired because the supervisor it reached had a different workspace's (empty)
 * crons.
 */
import { describe, expect, test } from "bun:test";
import { containerNameForFile, workVolume, containerName } from "../src/docker";
import { containerNameFor } from "../src/supervise";
import { UsageError } from "../src/errors";
import type { Config } from "../src/config";

const config = (workspaceFile: string): Config =>
  ({ workspaceFile, stateDir: "/state", image: "cod-sandbox:1.3.12" }) as Config;

describe("containerNameForFile", () => {
  test("two workspaces in different directories get different containers", () => {
    // The bug. Both files are named cod.json, which is the default.
    const a = containerNameForFile("/home/me/alpha/cod.json");
    const b = containerNameForFile("/home/me/beta/cod.json");
    expect(a).not.toBe(b);
  });

  test("two workspaces in the SAME directory with different names differ", () => {
    expect(containerNameForFile("/w/alpha.json")).not.toBe(containerNameForFile("/w/beta.json"));
  });

  test("it agrees with the work volume for the same workspace", () => {
    // They are derived from the same path, so the two names always correspond.
    // When they drifted, `purge` could remove a volume the container was not
    // using, or the reverse.
    const file = "/home/me/alpha/cod.json";
    const container = containerNameForFile(file);
    const volume = workVolume({ workspaceFile: file });
    expect(volume).toBe(`${container}-work`);
  });

  test("it is stable: the same path always gives the same name", () => {
    expect(containerNameForFile("/a/b/cod.json")).toBe(containerNameForFile("/a/b/cod.json"));
  });

  test("a path cannot inject shell or container-name characters", () => {
    // Sanitised, never rejected: a workspace file may legitimately live in a
    // directory with a dot or a space in it. The output is filtered to
    // [a-z0-9-] so it can never be a second argument to something.
    const hostile = containerNameForFile("/tmp/$(id); rm -rf/-x/cod.json");
    expect(hostile).toMatch(/^cod-sandbox-[a-z0-9-]+$/);
    expect(hostile).not.toContain("$");
    expect(hostile).not.toContain(";");
    expect(hostile).not.toContain(" ");
  });

  test("a bare filename still produces a usable name", () => {
    expect(containerNameForFile("cod.json")).toBe("cod-sandbox-cod");
  });

  test("a path with no parent does not produce a leading dash", () => {
    expect(containerNameForFile("acme.json")).not.toContain("--");
  });

  test("directory names are NOT spelled out letter by letter", () => {
    // The second, older bug, inherited from the original workVolume:
    // `[...parent, name]` spreads a STRING into its CHARACTERS, so "beta"
    // became "b-e-t-a" and every volume was named "c-o-d-e-2-e-acme-work".
    // It hid because the mangled name was still unique - just unreadable, and
    // far longer than intended for something with a length cap.
    expect(containerNameForFile("/tmp/beta/cod.json")).toBe("cod-sandbox-beta-cod");
    expect(workVolume({ workspaceFile: "/tmp/cod-e2e/acme.json" })).toBe("cod-sandbox-cod-e2e-acme-work");
  });

  test("two long paths in different deep directories still differ", () => {
    // Truncation must keep enough of the tail to stay unique, or a deep tree
    // would collide all over again.
    const a = containerNameForFile(`/very/long/path/that/keeps/going/aaaa/cod.json`);
    const b = containerNameForFile(`/very/long/path/that/keeps/going/bbbb/cod.json`);
    expect(a).not.toBe(b);
  });
});

describe("containerNameFor (the config-facing helper)", () => {
  test("uses the same derivation as the volume", () => {
    const c = config("/home/me/alpha/cod.json");
    expect(containerNameFor(c)).toBe(containerNameForFile(c.workspaceFile));
  });

  test("it is the value `cod up` will actually use", () => {
    // The regression, stated as a property: the helper the CLI calls and the
    // name docker.ts computes must never be two different strings.
    const c = config("/srv/team/one/cod.json");
    expect(containerNameFor(c)).toBe(`${workVolume({ workspaceFile: c.workspaceFile }).replace(/-work$/, "")}`);
  });
});

describe("containerName (the strict, name-only form)", () => {
  // Kept for callers that hold a validated workspace NAME. Its rejection
  // behaviour is still a real control, so it stays pinned.
  test("rejects anything that is not a plain lowercase name", () => {
    for (const bad of ["../evil", "a; rm -rf /", "", "ACME", "-rf", "cod-sandbox-$(id)-decoy"]) {
      expect(() => containerName(bad)).toThrow(UsageError);
    }
  });

  test("accepts a plain name", () => {
    expect(containerName("acme")).toBe("cod-sandbox-acme");
  });
});
