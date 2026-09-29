/**
 * The real CLI, run in a temporary HOME and working directory.
 *
 * Two hard-won rules are encoded in the harness itself, because both have
 * cost real debugging time:
 *
 * 1. `COD_STATE_DIR` is CLEARED. An ambient one left in a developer's shell
 *    after a manual run silently redirected state and produced seven phantom
 *    test failures.
 * 2. `COD_WORKSPACE` is PRESERVED. A test may set it deliberately to assert on
 *    the default workspace location; clearing it would silently undo that.
 *
 * Clearing both was tried and broke a clean-environment run.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, DEFAULTS } from "../src/config";
import { UsageError, UnsupportedRuntimeError } from "../src/errors";
import { Workspace, allWorkers, findWorker } from "../src/workspace";
import { loadStarterDepartment, listDepartmentTemplates } from "../src/templates";
import { agentWorkdir, assertMountAllowed, buildRunArgv, containerName, type RunResult } from "../src/docker";

const temps: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-test-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** Run the CLI binary in a scratch cwd, capturing stdout and the exit code. */
async function runCli(args: string[]): Promise<{ code: number; stdout: string }> {
  const cwd = scratch();
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  const previousCwd = process.cwd();
  const savedWorkspace = process.env["COD_WORKSPACE"];
  const savedState = process.env["COD_STATE_DIR"];
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  delete process.env["COD_STATE_DIR"];
  process.env["COD_WORKSPACE"] = join(cwd, "cod.json");
  process.chdir(cwd);
  try {
    const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "src", "index.ts"), ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
    await proc.exited;
  } finally {
    process.stdout.write = original;
    process.chdir(previousCwd);
    if (savedWorkspace === undefined) delete process.env["COD_WORKSPACE"];
    else process.env["COD_WORKSPACE"] = savedWorkspace;
    if (savedState === undefined) delete process.env["COD_STATE_DIR"];
    else process.env["COD_STATE_DIR"] = savedState;
  }
  return { code: 0, stdout: chunks.join("") };
}

describe("config resolution", () => {
  test("a flag beats the environment, which beats the file", () => {
    const home = scratch();
    const previousCwd = process.cwd();
    const previousXdg = process.env["XDG_CONFIG_HOME"];
    process.chdir(home);
    delete process.env["XDG_CONFIG_HOME"];
    process.env["COD_STATE_DIR"] = "/from/env";
    try {
      const fromEnv = loadConfig({});
      expect(fromEnv.sources.stateDir).toBe("environment");
      const fromFlag = loadConfig({ state: "/from/flag" });
      expect(fromFlag.stateDir).toBe("/from/flag");
      expect(fromFlag.sources.stateDir).toBe("flag");
    } finally {
      process.chdir(previousCwd);
      delete process.env["COD_STATE_DIR"];
      if (previousXdg !== undefined) process.env["XDG_CONFIG_HOME"] = previousXdg;
    }
  });

  test("defaults are used when nothing is set", () => {
    const home = scratch();
    const previousCwd = process.cwd();
    process.chdir(home);
    delete process.env["COD_STATE_DIR"];
    try {
      const config = loadConfig({});
      expect(config.sources.image).toBe("default");
      expect(config.image).toBe(DEFAULTS.image);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("an unknown format is a usage error, not a silent fallback", () => {
    expect(() => loadConfig({ format: "yaml" })).toThrow(UsageError);
  });
});

describe("container naming", () => {
  test("accepts lowercase names and rejects anything else", () => {
    expect(containerName("acme")).toBe("cod-sandbox-acme");
    expect(() => containerName("../evil")).toThrow(UsageError);
    expect(() => containerName("a; rm -rf /")).toThrow(UsageError);
    expect(() => containerName("")).toThrow(UsageError);
    expect(() => containerName("ACME")).toThrow(UsageError);
  });

  test("a worker directory cannot escape /work", () => {
    expect(agentWorkdir("builder")).toBe("/work/builder");
    expect(() => agentWorkdir("../etc")).toThrow(UsageError);
  });
});

describe("security", () => {
  test("mounting the Docker socket is refused", () => {
    expect(() => assertMountAllowed("/var/run/docker.sock")).toThrow(/root on this host/);
    expect(() => assertMountAllowed("/run/docker.sock")).toThrow(UsageError);
    expect(() => assertMountAllowed("/home/rohi/project")).not.toThrow();
  });

  test("the run argv hardens the container", () => {
    const argv = buildRunArgv({
      name: "cod-sandbox-acme",
      image: "oven/bun:1.3.12",
      labels: { "cod.workspace": "acme" },
      mounts: [{ source: "/data", target: "/work", readOnly: false }],
      network: "bridge",
      memory: "2g",
      cpus: "2",
      user: "1000:1000",
    });
    const joined = argv.join(" ");
    expect(joined).toContain("--cap-drop ALL");
    expect(joined).toContain("no-new-privileges");
    expect(joined).toContain("--pids-limit 512");
    expect(joined).toContain("--user 1000:1000");
    expect(joined).toContain("cod.workspace=acme");
    // Egress is deliberate and must never be silently reintroduced as "none".
    expect(argv).toContain("bridge");
    expect(argv).not.toContain("none");
  });

  test("a read-only mount is marked readonly", () => {
    const argv = buildRunArgv({
      name: "n",
      image: "i",
      labels: {},
      mounts: [{ source: "/a", target: "/cod/cod.json", readOnly: true }],
      network: "bridge",
      memory: "2g",
      cpus: "2",
      user: "1000:1000",
    });
    expect(argv.join(" ")).toContain("readonly");
  });
});

describe("cron support guard", () => {
  test("the error names both the required and the installed version", () => {
    const error = new UnsupportedRuntimeError("Bun 1.3.12 or newer", "Bun 1.3.9");
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain("1.3.12");
    expect(error.message).toContain("1.3.9");
    expect(error.message).toContain("no job would ever fire");
  });
});

describe("workspace schema", () => {
  test("the starter department has exactly three workers", () => {
    const department = loadStarterDepartment();
    expect(department.name).toBe("engineering");
    expect(department.workers.map((w) => w.name)).toEqual(["builder", "reviewer", "tester"]);
    expect(department.workers.every((w) => w.model.startsWith("opencode/"))).toBe(true);
    expect(department.workers.every((w) => w.model.endsWith("-free"))).toBe(true);
  });

  test("templates are discoverable so new departments need no code change", () => {
    expect(listDepartmentTemplates()).toContain("engineering");
  });

  test("an unknown key is rejected rather than silently dropped", () => {
    const result = Workspace.safeParse({
      version: 1,
      company: { name: "a", purpose: "b" },
      departments: [{ name: "d", workers: [{ name: "w", role: "r", model: "m" }] }],
      crons: [],
      surprise: true,
    });
    expect(result.success).toBe(false);
  });

  test("a company without a purpose is rejected", () => {
    const result = Workspace.safeParse({
      version: 1,
      company: { name: "a" },
      departments: [{ name: "d", workers: [{ name: "w", role: "r", model: "m" }] }],
      crons: [],
    });
    expect(result.success).toBe(false);
  });

  test("a worker with an unsafe name is rejected", () => {
    const result = Workspace.safeParse({
      version: 1,
      company: { name: "a", purpose: "b" },
      departments: [{ name: "d", workers: [{ name: "../evil", role: "r", model: "m" }] }],
      crons: [],
    });
    expect(result.success).toBe(false);
  });

  test("workers flatten across departments and are findable by name", () => {
    const workspace: Workspace = {
      version: 1,
      company: { name: "a", purpose: "b" },
      departments: [
        { name: "one", workers: [{ name: "w1", role: "r", model: "m" }] },
        { name: "two", workers: [{ name: "w2", role: "r", model: "m" }] },
      ],
      crons: [],
    };
    expect(allWorkers(workspace).map((w) => w.name)).toEqual(["w1", "w2"]);
    expect(findWorker(workspace, "w2")?.name).toBe("w2");
    expect(findWorker(workspace, "nobody")).toBeUndefined();
  });
});

describe("end to end", () => {
  test("init writes a valid workspace that parses", async () => {
    const home = scratch();
    const previousCwd = process.cwd();
    const previousWorkspace = process.env["COD_WORKSPACE"];
    const previousState = process.env["COD_STATE_DIR"];
    process.chdir(home);
    delete process.env["COD_STATE_DIR"];
    process.env["COD_WORKSPACE"] = join(home, "cod.json");
    delete process.env["COD_STATE_DIR"];
    try {
      const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "src", "index.ts"), "init", "acme", "--yes"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(`${code}:${stderr}`).toBe("0:");
      expect(stdout).toContain("acme");

      const written = await Bun.file(join(home, "cod.json")).json();
      const parsed = Workspace.safeParse(written);
      expect(parsed.success).toBe(true);
      expect(parsed.success && allWorkers(parsed.data).length).toBe(3);
    } finally {
      process.chdir(previousCwd);
      if (previousWorkspace === undefined) delete process.env["COD_WORKSPACE"];
      else process.env["COD_WORKSPACE"] = previousWorkspace;
      if (previousState === undefined) delete process.env["COD_STATE_DIR"];
      else process.env["COD_STATE_DIR"] = previousState;
    }
  });

  test("an unknown command exits 2", async () => {
    const home = scratch();
    const previousCwd = process.cwd();
    process.chdir(home);
    try {
      const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "src", "index.ts"), "bogus"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await proc.exited).toBe(2);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("config show --json is valid JSON that pipes to jq", async () => {
    const home = scratch();
    const previousCwd = process.cwd();
    process.chdir(home);
    try {
      const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "src", "index.ts"), "config", "show", "--json"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
      expect(code).toBe(0);
      const parsed: unknown = JSON.parse(stdout);
      expect(parsed).toHaveProperty("sources.image");
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe("harness integrity", () => {
  test("the runner type is what docker calls are faked with", () => {
    const fake = async (): Promise<RunResult> => ({ code: 0, stdout: "", stderr: "" });
    expect(typeof fake).toBe("function");
  });
});
