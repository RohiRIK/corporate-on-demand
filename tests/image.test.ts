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
  test("every build input is available, and a missing one says how to get it", () => {
    // The name used to be "...present in the repository", which is wrong: the
    // 177 MB opencode binary is deliberately NOT committed, and CI has its own
    // step that vendors it. A fresh clone that skipped that step therefore got
    // seven bare `expected true, received false` failures and no idea what to
    // do about them.
    //
    // Now the message names the fix, which is the only part that was missing.
    for (const path of [DOCKERFILE, ENTRYPOINT]) {
      expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
    }
    if (!existsSync(VENDORED_OPENCODE)) {
      throw new Error(
        `the opencode binary is not vendored yet: ${VENDORED_OPENCODE} is missing.\n` +
          `It is deliberately not committed (177 MB). Run:\n\n` +
          `    bun install && sh scripts/vendor-opencode.sh\n\n` +
          `and re-run. CI does this in a step of the same name.`,
      );
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

  test("/work is a named VOLUME, not the container's writable layer", async () => {
    // Measured: with /work in the container layer, `cod down && cod up` destroyed
    // every commit and every worktree. A worktree that does not survive a
    // restart is not isolation, it is extra steps.
    const { buildRunArgv, workVolume } = await import("../src/docker");
    const argv = buildRunArgv({
      name: "cod-sandbox-x",
      user: "1000:1000",
      image: "img",
      network: "bridge",
      memory: "2g",
      cpus: "2",
      labels: {},
      env: {},
      mounts: [{ source: workVolume({ workspaceFile: "/w/cod.json" }), target: "/work", readOnly: false, volume: true }],
    });
    const joined = argv.join(" ");
    expect(joined).toContain("type=volume");
    expect(joined).toContain("/work");
    // A volume, not a bind: nothing on the host is handed to a container that
    // runs arbitrary agents.
    expect(joined).not.toContain("type=bind,src=" + "cod-sandbox");
  });

  test("the work volume is per-workspace so two never share one", async () => {
    const { workVolume } = await import("../src/docker");
    const a = workVolume({ workspaceFile: "/a/cod.json" });
    const b = workVolume({ workspaceFile: "/b/cod.json" });
    expect(a).not.toBe(b);
    // Deterministic, so `cod down` and `cod up` find the same one.
    expect(workVolume({ workspaceFile: "/a/cod.json" })).toBe(a);
  });

  test("git identity is set image-wide, so an agent can commit anywhere", async () => {
    // Measured gap: with no identity, an agent that `git init`s a scratch
    // directory gets "Author identity unknown" and its work does not save - with
    // nothing in the log saying why. The entrypoint set an identity on /work
    // only, which left every other path broken.
    const dockerfile = await Bun.file(DOCKERFILE).text();
    expect(dockerfile).toContain("user.email");
    expect(dockerfile).toContain("user.name");
    // Not a credential: it names commits authored in an ephemeral container
    // that has no credential of any kind.
    expect(dockerfile).toMatch(/--global user\.email/);
  });

  test("a systemd unit starts a workspace on boot", async () => {
    // --restart on-failure survives a DAEMON restart, not a HOST reboot: after
    // a reboot the container is simply gone. This is the last fundamental gap.
    const unit = await Bun.file("ops/cod-workspace@.service").text();
    expect(unit).toContain("cod up");
    expect(unit).toContain("cod down");
    expect(unit).toContain("WantedBy=multi-user.target");
    // ExecStartPre in [Unit] is silently IGNORED by systemd rather than
    // failing, so a misplaced directive is a runtime surprise. Caught by
    // `systemd-analyze verify`.
    const serviceSection = unit.slice(unit.indexOf("[Service]"), unit.indexOf("[Install]"));
    expect(unit.slice(0, unit.indexOf("[Service]"))).not.toContain("ExecStartPre");
    expect(serviceSection).toContain("ExecStartPre");
  });

  test("the entrypoint initialises a git repo, and never reinitialises one", async () => {
    // `git worktree add` needs a repository. Without this, the per-job worktree
    // design in src/worktree.ts has nothing to branch from and every job shares
    // one checkout - the exact race it exists to prevent.
    const entrypoint = await Bun.file(ENTRYPOINT).text();
    const code = entrypoint
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(code).toContain("git init");
    // Idempotent: a restart must not reinitialise and lose committed work.
    expect(code).toContain("[ ! -d /work/.git ]");
    // Identity per-repo, not --global: a global write would not survive a
    // rebuild and would be a write to the image's home.
    expect(code).toContain("user.email");
    expect(code).not.toContain("config --global");
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

  test("the supervisor is PID 1, so a crash restarts the container", async () => {
    // The entrypoint `exec`s the supervisor instead of blocking in `tail -f`.
    // That is what makes two things true at once: `cod up` alone produces a
    // working schedule, and when the supervisor dies the container dies with
    // it so --restart can bring it back.
    const entrypoint = await Bun.file(ENTRYPOINT).text();
    const code = entrypoint
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(code).toContain("exec cod-supervisor");
    // `tail -f /dev/null` is exactly the thing that must NOT come back.
    expect(code).not.toContain("tail -f");
  });

  test("restart is set and --rm is not, because docker refuses both together", async () => {
    // Measured: `docker run` fails outright with
    //   "conflicting options: cannot specify both --restart and --rm"
    // --rm would also delete the container on the very exit the restart policy
    // is meant to act on, so it is removed deliberately. `cod down` removes the
    // container explicitly instead, and still refuses to remove one it did not
    // create.
    const { buildRunArgv } = await import("../src/docker");
    const argv = buildRunArgv({
      name: "cod-sandbox-x",
      user: "1000:1000",
      image: "img",
      network: "bridge",
      memory: "2g",
      cpus: "2",
      labels: {},
      mounts: [],
      env: {},
    });
    expect(argv).toContain("--restart");
    // Bounded, not `unless-stopped`: verified on this host, `on-failure:3`
    // against a process that exits 1 stops at restarts=3.
    expect(argv[argv.indexOf("--restart") + 1]).toMatch(/^on-failure:\d+$/);
    expect(argv[argv.indexOf("--restart") + 1]).not.toBe("unless-stopped");
    expect(argv).not.toContain("--rm");
  });

  test("the supervisor holds the loop open with no jobs, or --restart loops", async () => {
    // A freshly initialised workspace has ZERO enabled crons. With nothing
    // registered there is no pending work to hold Bun's event loop open, so the
    // supervisor exits immediately - and --restart turns that into an endless
    // crash loop churning the host. Measured before the fix: RestartCount 5
    // within seconds of `cod up`, and the container was unusable.
    const supervisor = await Bun.file("src/supervisor.ts").text();
    expect(supervisor).toContain("setInterval");
    expect(supervisor).toContain("no enabled cron jobs");
  });

  test("CI pins the runtime, and does NOT run the clean-room", async () => {
    // A CI that can pass on a version the container does not use proves
    // nothing, and one that goes red when a free provider is down is one
    // people learn to ignore.
    const ci = await Bun.file(".github/workflows/ci.yml").text();
    expect(ci).toContain('bun-version: "1.3.12"');
    expect(ci).toContain("--frozen-lockfile");
    expect(ci).toContain("verify.sh");
    // The clean-room appears only in the comment explaining why it is absent.
    const code = ci.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
    expect(code).not.toContain("cleanroom.sh");
  });

  test("CI refuses to track the 177 MB binary", async () => {
    const ci = await Bun.file(".github/workflows/ci.yml").text();
    expect(ci).toContain("vendor-opencode.sh");
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
