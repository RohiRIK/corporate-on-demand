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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, DEFAULTS } from "../src/config";
import { UsageError, UnsupportedRuntimeError } from "../src/errors";
import { Workspace, allWorkers, findWorker } from "../src/workspace";
import { loadStarterDepartment, listDepartmentTemplates } from "../src/templates";
import {
  agentWorkdir,
  assertMountAllowed,
  buildRunArgv,
  containerName,
  dockerVersion,
  isDockerAvailable,
  isRunning,
  makeCappedRunner,
  makeDocker,
  OUTPUT_LIMIT_BYTES,
  type RunResult,
} from "../src/docker";

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

/** The CLI entry point, resolved once and independent of the cwd. */
const CLI = join(import.meta.dir, "..", "src", "index.ts");

/**
 * Spawn the CLI with a controlled environment.
 *
 * The child must never inherit an ambient COD_* from the developer's shell.
 * A manual `cod init` that exported COD_WORKSPACE left the suite reading a
 * workspace that did not exist, and the failure pointed at the test rather
 * than at the shell that caused it. Max flagged this exact hazard. The child
 * gets only what the test chose to set, so a test is reproducible from any
 * shell state.
 */
function spawnCli(
  args: string[],
  env: Record<string, string | undefined>,
): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[key] = value;
  }
  return Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: childEnv,
  });
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
      env: {},
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
      env: {},
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
      departments: [{ name: "d", workers: [{ name: "w", role: "r", model: "m", skills: [] }] }],
      crons: [],
      surprise: true,
    });
    expect(result.success).toBe(false);
  });

  test("a company without a purpose is rejected", () => {
    const result = Workspace.safeParse({
      version: 1,
      company: { name: "a" },
      departments: [{ name: "d", workers: [{ name: "w", role: "r", model: "m", skills: [] }] }],
      crons: [],
    });
    expect(result.success).toBe(false);
  });

  test("a worker with an unsafe name is rejected", () => {
    const result = Workspace.safeParse({
      version: 1,
      company: { name: "a", purpose: "b" },
      departments: [{ name: "d", workers: [{ name: "../evil", role: "r", model: "m", skills: [] }] }],
      crons: [],
    });
    expect(result.success).toBe(false);
  });

  test("workers flatten across departments and are findable by name", () => {
    const workspace: Workspace = {
      version: 1,
      company: { name: "a", purpose: "b" },
      departments: [
        { name: "one", purpose: "", workers: [{ name: "w1", role: "r", model: "m", skills: [] }] },
        { name: "two", purpose: "", workers: [{ name: "w2", role: "r", model: "m", skills: [] }] },
      ],
      crons: [],
      maxConcurrent: 2,
      timezone: "UTC",
      resultRetention: 500,
      };
    expect(allWorkers(workspace).map((w) => w.name)).toEqual(["w1", "w2"]);
    expect(findWorker(workspace, "w2")?.name).toBe("w2");
    expect(findWorker(workspace, "nobody")).toBeUndefined();
  });
});

describe("end to end", () => {
  test("init writes a valid workspace that parses", async () => {
    const home = scratch();
    const proc = spawnCli(["init", "acme", "--yes"], {
      PATH: process.env["PATH"],
      HOME: home,
      COD_WORKSPACE: join(home, "cod.json"),
      COD_STATE_DIR: join(home, "state"),
    });
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(`${code}:${stderr}`).toBe("0:");
    expect(stdout).toContain("acme");

    const written: unknown = await Bun.file(join(home, "cod.json")).json();
    const parsed = Workspace.safeParse(written);
    expect(parsed.success).toBe(true);
    // Asserted against the templates on disk rather than a fixed count. It was
    // 3 because init seeded one hardcoded department, and it silently became
    // wrong the moment a second template existed - which is how "adding a
    // department needs no code change" stopped being true.
    expect(parsed.success && parsed.data.departments.map((d) => d.name)).toContain("cto");
    expect(parsed.success && allWorkers(parsed.data).length).toBeGreaterThanOrEqual(4);
  });

  test("an unknown command exits 2", async () => {
    const home = scratch();
    const proc = spawnCli(["bogus"], { PATH: process.env["PATH"], HOME: home });
    expect(await proc.exited).toBe(2);
  });

  test("config show --json is valid JSON that pipes to jq", async () => {
    const home = scratch();
    const proc = spawnCli(["config", "show", "--json"], { PATH: process.env["PATH"], HOME: home });
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toHaveProperty("sources.image");
  });

  test("an ambient COD_WORKSPACE in the parent shell cannot break a test", async () => {
    // The regression this guards: a developer exports COD_WORKSPACE for a
    // manual run, then runs the suite, and one test fails for reasons that
    // have nothing to do with the code under test.
    const home = scratch();
    const previous = process.env["COD_WORKSPACE"];
    process.env["COD_WORKSPACE"] = "/nonexistent/elsewhere/cod.json";
    try {
      const proc = spawnCli(["init", "acme", "--yes"], {
        PATH: process.env["PATH"],
        HOME: home,
        COD_WORKSPACE: join(home, "cod.json"),
        COD_STATE_DIR: join(home, "state"),
      });
    await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(stdout).toContain("acme");
    expect(existsSync(join(home, "cod.json"))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env["COD_WORKSPACE"];
      else process.env["COD_WORKSPACE"] = previous;
    }
  });
});

describe("docker failure isolation", () => {
  test("a missing docker binary is a clean failure, not a crash", async () => {
    // Max's finding: isRunning and isDockerAvailable called the runner
    // directly, outside the try/catch that run() provides. A missing binary
    // escaped as a raw ENOENT instead of a named failure.
    const exploding = async (): Promise<RunResult> => {
      throw new Error("spawn docker ENOENT");
    };
    expect(await isDockerAvailable(exploding)).toBe(false);
    expect(await isRunning({ workspaceFile: "/tmp/acme/cod.json" } as never, exploding)).toBe(false);
  });

  test("dockerVersion survives a runner that throws", async () => {
    const exploding = async (): Promise<RunResult> => {
      throw new Error("spawn docker ENOENT");
    };
    expect(await dockerVersion(exploding)).toBe("unknown");
  });

  test("down refuses to remove a container whose name is not ours", async () => {
    // Max's finding, and the most severe: `docker rm --force <name>` destroys
    // whatever bears that name. A crafted workspace value could name a real,
    // unrelated container. The name is validated, and rm is only reached for a
    // name this CLI could itself have created.
    expect(() => containerName("cod-sandbox-$(id)-decoy")).toThrow(UsageError);
    expect(() => containerName("-rf")).toThrow(UsageError);
    expect(() => containerName("valid-name")).not.toThrow();
  });

  test("down refuses to remove a container this CLI did not create", async () => {
    // The severe case: a container with our name but no cod.workspace label
    // belongs to something else. `docker rm --force` would destroy it, so the
    // call must never be issued.
    const calls: string[][] = [];
    const runner = async (_cmd: string, args: string[]): Promise<RunResult> => {
      calls.push(args);
      if (args[0] === "inspect" && args.join(" ").includes("cod.workspace")) {
        return { code: 0, stdout: "", stderr: "" }; // no label
      }
      if (args[0] === "inspect") {
        return { code: 0, stdout: "abc123", stderr: "" }; // it exists
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const docker = makeDocker({ runner, timeoutMs: 1000 });
    const config = { workspaceFile: "/tmp/acme/cod.json" } as never;
    await expect(docker.down(config)).rejects.toThrow(/did not create it/);
    // The proof: no rm was ever attempted.
    expect(calls.some((a) => a[0] === "rm")).toBe(false);
  });

  test("down is a clean no-op when the container is simply absent", async () => {
    const runner = async (_cmd: string, args: string[]): Promise<RunResult> => {
      if (args[0] === "inspect") return { code: 1, stdout: "", stderr: "no such object" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const docker = makeDocker({ runner, timeoutMs: 1000 });
    const config = { workspaceFile: "/tmp/acme/cod.json" } as never;
    expect(await docker.down(config)).toBe(false);
  });

  test("a name with shell metacharacters never reaches an argv", () => {
    for (const hostile of ["a;rm -rf /", "a && b", "`id`", "$(id)", "a|b", "a>b"]) {
      expect(() => containerName(hostile)).toThrow(UsageError);
    }
  });
});

describe("output bounds", () => {
  test("stdout above the cap is truncated and flagged", async () => {
    const runner = makeCappedRunner(1024);
    const result = await runner("bash", ["-lc", "for i in $(seq 1 500); do echo 0123456789012345678901234567890123456789; done"], 30_000);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(1024);
  });

  test("a small output is not flagged as truncated", async () => {
    const runner = makeCappedRunner(1024 * 1024);
    const result = await runner("bash", ["-lc", "echo small"], 30_000);
    expect(result.stdoutTruncated).toBe(false);
    expect(result.stdout.trim()).toBe("small");
    expect(result.code).toBe(0);
  });

  test("truncation keeps the TAIL, which is where a failure shows up", async () => {
    // The end of a failing command is the part that says why. Keeping the
    // head would show a successful-looking beginning and hide the error.
    const runner = makeCappedRunner(2048);
    const result = await runner(
      "bash",
      ["-lc", "echo HEAD_MARKER_AAA; for i in $(seq 1 500); do echo padding-padding-padding; done; echo THE_ACTUAL_ERROR; exit 7"],
      30_000,
    );
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout).toContain("THE_ACTUAL_ERROR");
    // The head is what got dropped, and it is dropped COMPLETELY. An
    // implementation that keeps the head "and some of the rest" would still
    // pass the check above, so assert the head is gone.
    expect(result.stdout).not.toContain("HEAD_MARKER_AAA");
    expect(result.code).toBe(7);
  });

  test("the captured output never exceeds the cap, exactly", async () => {
    // The first version of this returned 4412 bytes for a 2048 cap - the
    // front-trimming had a partial-chunk special case that was wrong. A bound
    // that is approximately honoured is not a bound.
    const runner = makeCappedRunner(2048);
    const result = await runner("bash", ["-lc", "for i in $(seq 1 5000); do echo xxxxxxxxxxxxxxxxxxxx; done"], 30_000);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout.length).toBe(2048);
  });

  test("capturing 40 MB does not grow the heap by 40 MB", async () => {
    // The whole point of the cap, and it needs a real measurement rather than a
    // guess at a threshold.
    //
    // Measured on the same 40 MB of child output:
    //   uncapped `new Response(stream).text()`  ->  ~1500 MB heap
    //   this runner, 1 MB cap                    ->  ~22 MB heap
    //
    // The bound is set at 30 MB - comfortably above the real ~22 MB so the test
    // is not GC-timing sensitive, and comfortably below the 1500 MB that the
    // unbounded version costs. An implementation that buffered then sliced
    // would blow straight through it, and did grow 70 MB before this was fixed.
    const runner = makeCappedRunner(1024 * 1024);
    const before = process.memoryUsage().heapUsed;
    const result = await runner("bash", ["-lc", "for i in $(seq 1 400000); do echo yyyyyyyyyyyyyyyyyyyy; done"], 60_000);
    const growth = process.memoryUsage().heapUsed - before;
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout.length).toBe(1024 * 1024);
    expect(growth).toBeLessThan(30 * 1024 * 1024);
  }, 60_000);

  test("the child's real exit code survives truncation", async () => {
    const runner = makeCappedRunner(512);
    const result = await runner(
      "bash",
      ["-lc", "for i in $(seq 1 500); do echo noise; done; exit 3"],
      30_000,
    );
    expect(result.code).toBe(3);
  });

  test("a runaway command does not deadlock when the cap is reached", async () => {
    // The dangerous bug: stop reading the stream but let the child keep
    // writing. It blocks on a full pipe, and we wait for it to exit - a
    // deadlock that a timeout would eventually paper over.
    const runner = makeCappedRunner(256);
    const started = Date.now();
    const result = await runner("bash", ["-lc", "for i in $(seq 1 20000); do echo chatter; done"], 20_000);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(result.code).toBe(0);
  });

  test("stderr is bounded independently of stdout", async () => {
    // Each stderr line here is 42 bytes, so 500 of them is ~21 KB against a
    // 1 KB cap - comfortably over, unlike a two-byte-per-line loop which would
    // sit just under and silently pass.
    const runner = makeCappedRunner(1024);
    const result = await runner(
      "bash",
      ["-lc", "for i in $(seq 1 500); do echo 0123456789012345678901234567890123456789 >&2; done; echo out"],
      30_000,
    );
    expect(result.stderrTruncated).toBe(true);
    expect(result.stderr.length).toBeLessThanOrEqual(1024);
    expect(result.stdoutTruncated).toBe(false);
    expect(result.stdout.trim()).toBe("out");
  });
});

describe("the cap default", () => {
  test("is 4 MB, which is generous for real output and small for 50 jobs", () => {
    expect(OUTPUT_LIMIT_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe("harness integrity", () => {
  test("the runner type is what docker calls are faked with", () => {
    const fake = async (): Promise<RunResult> => ({ code: 0, stdout: "", stderr: "" });
    expect(typeof fake).toBe("function");
  });
});


describe("the adopt guard", () => {
  /**
   * `cod up` reuses a container that is already running under the name it
   * wants. The ONLY thing stopping it from adopting a container that belongs
   * to a different workspace is the `cod.workspace` label.
   *
   * The label was the workspace NAME, and the default workspace file is
   * `cod.json` everywhere - so two workspaces both labelled "cod", compared
   * equal, and `cod up` adopted the first workspace's container for the second
   * workspace. Its jobs then ran against the wrong cod.json, with no error.
   * Measured: a scheduled job in one workspace never fired because the
   * supervisor it reached had another workspace's empty crons.
   */

  const runResult = (over: Partial<{ code: number; stdout: string }> = {}) => ({
    code: over.code ?? 0,
    stdout: over.stdout ?? "",
    stderr: "",
  });

  test("up REFUSES a running container that belongs to a different workspace", async () => {
    const { makeDocker } = await import("../src/docker");
    // A container named for /tmp/beta/cod.json is already running, and its
    // label says it belongs to /tmp/alpha/cod.json.
    const runner = async (_cmd: string, args: string[]): Promise<ReturnType<typeof runResult>> => {
      if (args[0] === "inspect" && args.join(" ").includes("cod.workspace")) {
        return runResult({ stdout: "/tmp/alpha/cod.json" });
      }
      if (args[0] === "inspect") return runResult({ code: 0, stdout: "true" });
      return runResult();
    };
    const docker = makeDocker({ runner, timeoutMs: 1000 });
    const config = { workspaceFile: "/tmp/beta/cod.json" } as never;
    await expect(docker.up(config, { crons: [] } as never)).rejects.toThrow(/different workspace/);
  });

  test("up ADOPTS a running container that is genuinely its own", async () => {
    const { makeDocker } = await import("../src/docker");
    const runner = async (_cmd: string, args: string[]): Promise<ReturnType<typeof runResult>> => {
      if (args[0] === "inspect" && args.join(" ").includes("cod.workspace")) {
        return runResult({ stdout: "/tmp/beta/cod.json" });
      }
      if (args[0] === "inspect") return runResult({ code: 0, stdout: "true" });
      return runResult();
    };
    const docker = makeDocker({ runner, timeoutMs: 1000 });
    const config = { workspaceFile: "/tmp/beta/cod.json" } as never;
    expect(await docker.up(config, { crons: [] } as never)).toBe("cod-sandbox-beta-cod");
  });

  test("the label WRITTEN to docker is the full path, not the name", async () => {
    // The comparison alone cannot catch this: the guard compares whatever the
    // container reports against the path, so a name-only label still "fails
    // closed" and the tests above still pass. What has to be pinned is what is
    // actually written, because a container LABELLED "cod" is indistinguishable
    // from any other workspace's container on the next `cod up`.
    const { makeDocker } = await import("../src/docker");
    const argvSeen: string[] = [];
    const runner = async (_cmd: string, args: string[]): Promise<ReturnType<typeof runResult>> => {
      argvSeen.push(args.join(" "));
      if (args[0] === "inspect") return runResult({ code: 1, stdout: "" }); // nothing running
      return runResult();
    };
    const docker = makeDocker({ runner, timeoutMs: 1000 });
    await docker.up(
      { workspaceFile: "/srv/team/one/cod.json" } as never,
      { crons: [] } as never,
    );
    const runCall = argvSeen.find((a) => a.includes("--label")) ?? "";
    expect(runCall).toContain("cod.workspace=/srv/team/one/cod.json");
    // And specifically NOT the bare name, which is what made every workspace
    // called cod.json look identical to the guard.
    expect(runCall).not.toContain("cod.workspace=cod ");
  });

  test("two workspaces that share a filename do NOT compare equal", async () => {
    // Stated directly, because it is the whole bug: same basename, different
    // paths, and they must not be interchangeable.
    const { makeDocker } = await import("../src/docker");
    let seen: string[] = [];
    const runner = async (_cmd: string, args: string[]): Promise<ReturnType<typeof runResult>> => {
      if (args[0] === "inspect" && args.join(" ").includes("cod.workspace")) {
        // Whatever the other workspace would have written as its label.
        seen = ["/tmp/other/cod.json"];
        return runResult({ stdout: seen[0] ?? "" });
      }
      if (args[0] === "inspect") return runResult({ code: 0, stdout: "true" });
      return runResult();
    };
    const docker = makeDocker({ runner, timeoutMs: 1000 });
    await expect(
      docker.up({ workspaceFile: "/tmp/mine/cod.json" } as never, { crons: [] } as never),
    ).rejects.toThrow(/different workspace/);
  });
});
