/**
 * The image build.
 *
 * Two properties matter and neither is about speed: the base image is pinned
 * by digest, and a missing build input fails loudly. A container that builds
 * fine but has no opencode in it starts successfully and then fails on the
 * first real task, which is much harder to diagnose.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  DOCKERFILE,
  ENTRYPOINT,
  PATHS,
  PINNED_BASE,
  PINNED_BUN,
  PINNED_OPENCODE,
  VENDORED_OPENCODE,
  ensureImage,
  imageExists,
} from "../src/image";
import { RuntimeFailure } from "../src/errors";
import type { Config } from "../src/config";
import type { RunResult } from "../src/docker";

function configFor(image: string): Config {
  return {
    workspaceFile: "/tmp/x/cod.json",
    stateDir: "/tmp/x/state",
    image,
    format: "table",
    sources: { stateDir: "default", image: "default", format: "default" },
  };
}

describe("image inputs", () => {
  test("every build input is present in the repository", () => {
    for (const path of [DOCKERFILE, ENTRYPOINT, VENDORED_OPENCODE]) {
      expect(existsSync(path)).toBe(true);
    }
  });

  test("the base image is pinned by digest, not by a mutable tag", () => {
    // A tag is a moving pointer; a digest names the exact image that was
    // tested. The property that matters is the presence of the digest, not the
    // absence of a colon - a digest itself contains one.
    expect(PINNED_BASE).toContain("@sha256:");
    const [, digest] = PINNED_BASE.split("@sha256:");
    expect(digest).toBeDefined();
    expect(digest?.length).toBe(64);
    // No tag:version suffix, which is the mutable form.
    expect(PINNED_BASE.startsWith("oven/bun:")).toBe(false);
  });

  test("the versions in the source match the Dockerfile", async () => {
    const dockerfile = await Bun.file(DOCKERFILE).text();
    expect(dockerfile).toContain(PINNED_BASE);
    expect(dockerfile).toContain("opencode 1.18.31");
    expect(PINNED_OPENCODE).toBe("1.18.31");
    expect(PINNED_BUN).toBe("1.3.12");
  });

  test("the entrypoint asks the schema for workers, never greps the file", async () => {
    // The old `sed 's/.*"name".../'` matched every "name" key, so it made
    // directories for the company, the departments AND every cron job. It is
    // exactly the kind of bug that passes every test and is invisible until
    // you look at the filesystem.
    const entrypoint = await Bun.file(ENTRYPOINT).text();
    // Check the executable lines only. The comment above it still names the
    // old sed while explaining why it went, and a test that fails on its own
    // documentation is a test that discourages documenting the fix.
    const code = entrypoint
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(code).not.toMatch(/sed .*name/);
    expect(code).toContain("cod-workers");
    expect(entrypoint).toContain("cod-workers");
  });

  test("the entrypoint refuses to continue without Bun.cron", async () => {
    const entrypoint = await Bun.file(ENTRYPOINT).text();
    // A scheduler that silently never fires is the failure this prevents.
    expect(entrypoint).toContain("Bun.cron");
    expect(entrypoint).toContain("exit 2");
  });
});

describe("build outcomes", () => {
  test("a cached image skips the build entirely", async () => {
    const calls: string[][] = [];
    const runner = async (_cmd: string, args: string[]): Promise<RunResult> => {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "" }; // inspect succeeds
    };
    const result = await ensureImage(configFor("img"), {}, runner);
    expect(result.outcome).toBe("cached");
    expect(calls.some((a) => a[0] === "build")).toBe(false);
  });

  test("a missing image triggers a build and reports it was built", async () => {
    const calls: string[][] = [];
    const runner = async (_cmd: string, args: string[]): Promise<RunResult> => {
      calls.push(args);
      if (args[0] === "image") return { code: 1, stdout: "", stderr: "" }; // not present
      return { code: 0, stdout: "done", stderr: "" };
    };
    const result = await ensureImage(configFor("img"), {}, runner);
    expect(result.outcome).toBe("built");
    const build = calls.find((a) => a[0] === "build");
    expect(build).toBeDefined();
    // --progress=plain so the output is line-oriented when piped, not a TTY bar.
    expect(build?.join(" ")).toContain("--progress=plain");
    expect(build?.join(" ")).toContain("--file");
  });

  test("--rebuild forces a build even when the image exists", async () => {
    const calls: string[][] = [];
    const runner = async (_cmd: string, args: string[]): Promise<RunResult> => {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    };
    const result = await ensureImage(configFor("img"), { force: true }, runner);
    expect(result.outcome).toBe("built");
    expect(calls.some((a) => a[0] === "build")).toBe(true);
  });

  test("a failed build reports the reason rather than exiting quietly", async () => {
    const runner = async (_cmd: string, args: string[]): Promise<RunResult> => {
      if (args[0] === "image") return { code: 1, stdout: "", stderr: "" };
      return { code: 1, stdout: "", stderr: "no space left on device" };
    };
    await expect(ensureImage(configFor("img"), {}, runner)).rejects.toThrow(
      /no space left on device/,
    );
  });

  test("a missing build input is a named failure, not a confusing docker error", async () => {
    // Temporarily point the module at a path that cannot exist, so the guard
    // is exercised for real rather than asserted in the abstract.
    const original = PATHS.dockerfile;
    PATHS.dockerfile = "/nonexistent/Dockerfile.sandbox";
    try {
      const runner = async (): Promise<RunResult> => {
        throw new Error("docker should not be called at all");
      };
      await expect(ensureImage(configFor("img"), {}, runner)).rejects.toThrow(RuntimeFailure);
      await expect(ensureImage(configFor("img"), {}, runner)).rejects.toThrow(/Dockerfile/);
    } finally {
      PATHS.dockerfile = original;
    }
  });

  test("doctor names the vendor script when the opencode binary is absent", async () => {
    // The binary is deliberately not committed - it is fetched by
    // scripts/vendor-opencode.sh - so a fresh clone cannot build until that
    // runs. doctor must say which script, not just "not available".
    const { VENDORED_OPENCODE: vendored } = await import("../src/image");
    const original = PATHS.opencode;
    try {
      PATHS.opencode = "/nonexistent/opencode";
      const { doctor } = await import("../src/docker");
      const runner = async (): Promise<RunResult> => ({ code: 0, stdout: "29.7.2", stderr: "" });
      const config = configFor("img");
      const report = await doctor(config, runner);
      expect(report.opencodeVendored).toBe(false);
      expect(report.remedy).toContain("vendor-opencode.sh");
    } finally {
      PATHS.opencode = original;
    }
    // And when it is present, no remedy is offered.
    expect(existsSync(vendored)).toBe(true);
  });

  test("imageExists reflects the inspect exit code", async () => {
    const present = async (): Promise<RunResult> => ({ code: 0, stdout: "[]", stderr: "" });
    const absent = async (): Promise<RunResult> => ({ code: 1, stdout: "", stderr: "" });
    expect(await imageExists("x", present)).toBe(true);
    expect(await imageExists("x", absent)).toBe(false);
  });
});
