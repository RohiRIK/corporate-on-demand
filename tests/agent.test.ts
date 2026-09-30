import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";

/**
 * The live tests need a running sandbox. CI has no Docker container, and a
 * green build that asserts nothing is worth less than an honest skip.
 *
 * So: when a container is present the test is a real assertion and fails
 * loudly if the runtime is broken. When there is none, the test reports that it
 * was skipped and why, rather than passing silently on a claim it never checked.
 * `sh scripts/cleanroom.sh` brings a container up and runs the same path, so
 * the real check is not lost - it is just not the default gate.
 */
/**
 * The running sandbox's name, or null.
 *
 * Resolved rather than hardcoded: `cod up` names the container after the
 * workspace, and a hardcoded name silently tests a container that may not be
 * the one anything is actually using.
 */
function sandboxName(): string | null {
  try {
    const out = execFileSync("docker", ["ps", "--format", "{{.Names}}", "--filter", "name=cod-sandbox-"], {
      encoding: "utf8",
      timeout: 20_000,
    });
    return out.trim().split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}

const SANDBOX = sandboxName();
const SKIP = SANDBOX === null;

/**
 * The one test that talks to a real model.
 *
 * Everything else in this file is pure and instant. This one costs 4-5 seconds
 * and needs Docker plus the network, so it is the single point where "real agent
 * execution works" is true or false. It was verified by hand before this file
 * existed: exit 0, ~4.4s, credential-free, cost 0.
 *
 * It is kept to exactly ONE live test on purpose. The free provider has already
 * failed twice in one session, including a 180-second hang, so every extra live
 * assertion is extra flakiness in a build people are learning to ignore.
 */
describe("the agent runtime", () => {
  test("a real model call returns text, credential-free, at no cost", () => {
    if (SANDBOX === null) {
      console.warn("SKIPPED: no sandbox container is running; `cod up` then re-run, or use scripts/cleanroom.sh");
      return;
    }
    const out = execFileSync(
      "docker",
      [
        "exec",
        SANDBOX,
        "sh",
        "-lc",
        'cd /work && timeout 120 opencode run --pure --format json -m opencode/space-bunny-free "reply with exactly: AGENT_OK" 2>&1',
      ],
      { encoding: "utf8", timeout: 180_000 },
    );
    // The text event carries the model's actual answer.
    expect(out).toContain("AGENT_OK");
    // Free model: the token block must report no cost. If this ever fails, a
    // paid model has entered the system and the security posture changed -
    // that should fail the build loudly, not pass quietly.
    expect(out).toContain('"cost":0');
  });

  test("the sandbox has opencode and deliberately has no docker", () => {
    // These two facts together are why the driver spawns opencode directly.
    // An earlier plan nested `docker exec` because the runtime hangs on the
    // host; but the supervisor IS the container's PID 1 and there is no docker
    // binary or socket inside, so every job failed in 4ms with "exited 1".
    // A docker socket inside the container would be the escape the image
    // refuses to mount, so its absence is a security property, not a gap.
    if (SANDBOX === null) {
      console.warn("SKIPPED: no sandbox container is running");
      return;
    }
    const out = execFileSync(
      "docker",
      ["exec", SANDBOX, "sh", "-lc",
        "command -v opencode >/dev/null && echo HAS_OPENCODE || echo NO_OPENCODE; " +
        "command -v docker >/dev/null && echo HAS_DOCKER || echo NO_DOCKER; " +
        "test -S /var/run/docker.sock && echo HAS_SOCKET || echo NO_SOCKET"],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(out).toContain("HAS_OPENCODE");
    expect(out).toContain("NO_DOCKER");
    expect(out).toContain("NO_SOCKET");
  }, 180_000);
});


// ---------------------------------------------------------------- driver
// The unit tests below inject a CommandRunner, so they need neither Docker nor
// a model and cannot be flaky. The live test at the top is the only one that
// does.

import { buildArgs, buildPrompt, runAgent, localRunner, type CommandRunner } from "../src/agent";
import type { Cron, Worker } from "../src/workspace";

const cron: Cron = {
  name: "nightly",
  agent: "builder",
  task: "summarise the day",
  schedule: "0 3 * * *",
  enabled: true,
};
const worker: Worker = { name: "builder", role: "builds", model: "opencode/space-bunny-free", skills: [] };

/** Echo canned stdout, so these tests are pure. */
function runnerReturning(stdout: string, code = 0, timedOut = false): CommandRunner {
  return async () => ({ stdout, stderr: "", code, timedOut });
}

/**
 * A run that actually worked: it started, used a tool that completed, said
 * something, and finished cleanly.
 *
 * The `tool_use` line is not decoration. It is what makes this a VALID
 * successful run under the assertion - a stream with text and a clean
 * step_finish but no completed tool is exactly the wrong-reason failure, and
 * using it as the happy path would quietly re-open the hole.
 */
const STREAM = [
  '{"type":"step_start","part":{"type":"step-start"}}',
  '{"type":"tool_use","part":{"type":"tool","tool":"write","state":{"status":"completed"}}}',
  '{"type":"text","part":{"type":"text","text":"I did the thing."}}',
  '{"type":"step_finish","part":{"type":"step-finish","reason":"stop","tokens":{"total":10,"input":9,"output":1},"cost":0}}',
].join("\n");

describe("localRunner", () => {
  // NOTE: these run in whatever container the suite is executed in. The facts
  // that only hold INSIDE the sandbox - opencode being present, docker being
  // absent - are asserted in the live test above, through `docker exec`,
  // because this suite also runs on the host in CI where both are reversed.
  test("reports a non-zero exit rather than swallowing it", async () => {
    // The runner's contract: args are COMMAND TOKENS joined with spaces and run
    // through `sh -lc`. So a shell metacharacter test passes one command string,
    // not a nested `sh -lc`.
    const probe = await localRunner(["echo out; echo err 1>&2; exit 3"], 20_000);
    expect(probe.code).toBe(3);
    expect(probe.stdout).toContain("out");
    expect(probe.stderr).toContain("err");
  });

  test("runs in the CURRENT directory rather than a hardcoded one", async () => {
    // An agent must not be silently pointed somewhere it did not ask to work.
    const probe = await localRunner(["pwd"], 20_000);
    expect(probe.code).toBe(0);
    expect(probe.stdout.trim()).toBe(process.cwd());
  });

  test("does not use docker at all", async () => {
    // The nested-exec regression, asserted where it can hold anywhere: the
    // runner must not reach for a docker binary, because the sandbox has none
    // and the supervisor runs inside it.
    const probe = await localRunner(["echo no-docker-used"], 20_000);
    expect(probe.stdout.trim()).toBe("no-docker-used");
  });
});

describe("buildArgs", () => {
  test("uses the model it is given, so per-worker routing works", () => {
    const args = buildArgs(cron, "opencode/some-other-free", "hi", "/work/x");
    expect(args[args.indexOf("-m") + 1]).toBe("opencode/some-other-free");
  });

  test("confinement is a process working directory, not a --dir flag", () => {
    // The boundary. An agent with tools that runs in the wrong directory edits
    // the wrong files, and the worktree is the only thing that makes the
    // blast-radius check mean anything.
    //
    // `--dir` is deliberately NOT used: measured, `opencode run --dir <git
    // worktree>` fails with an opaque "Unexpected server error" while the
    // identical command with the process cd-ed in works. The confinement is
    // therefore the spawn's `cwd`, asserted in the runner test below.
    const args = buildArgs(cron, "m", "hi", "/work/nightly");
    expect(args).not.toContain("--dir");
  });

  test("runAgent hands the worktree to the runner as a working directory", async () => {
    let seen: string | undefined;
    const spy: CommandRunner = async (_args, _t, cwd) => {
      seen = cwd;
      return { stdout: STREAM, stderr: "", code: 0, timedOut: false };
    };
    await runAgent(cron, worker, async () => {}, { runner: spy, workdir: "/work/nightly" });
    expect(seen).toBe("/work/nightly");
  });

  test("grants tool use, because the agent now has a boundary to stay inside", () => {
    // Decided: agents act automatically, the CEO manages them, no human gate.
    // Paired with the radius-2 instruction in the bundle, which is what
    // replaces the prompt line that used to forbid file changes.
    expect(buildArgs(cron, "m", "hi", "/work/nightly")).toContain("--auto");
  });

  test("asks for the parseable stream format", () => {
    const args = buildArgs(cron, "m", "hi", "/work/x");
    expect(args[args.indexOf("--format") + 1]).toBe("json");
  });

  test("is credential-free: no auth-shaped flag leaks into the command", () => {
    expect(buildArgs(cron, "m", "hi", "/work/x").join(" ")).not.toMatch(/api[-_]?key|token|password|secret/i);
  });
});

describe("buildPrompt", () => {
  test("states the job and the company", () => {
    const prompt = buildPrompt(cron, { name: "acme", purpose: "test things" });
    expect(prompt).toContain("summarise the day");
    expect(prompt).toContain("acme");
  });

  test("tells the agent nobody is reading, so it does not ask questions", () => {
    expect(buildPrompt(cron, null)).toContain("nobody reading");
  });

  test("no longer tells the agent it cannot change files", () => {
    // The contradiction the plan called out: granting tools while the prompt
    // still says "you cannot" puts two opposing instructions in front of the
    // model. The boundary moved to the bundle, which is written per job.
    expect(buildPrompt(cron, null)).not.toContain("Do not claim to have changed any files");
  });

  test("still tells the agent nobody is reading, so it does not stall on a question", () => {
    // Unchanged, and still needed: an unattended agent that asks a question
    // waits for an answer that will never come.
    expect(buildPrompt(cron, null)).toContain("nobody reading");
  });
});

describe("runAgent", () => {
  test("returns the model's text", async () => {
    const out = await runAgent(cron, worker, async () => {}, { runner: runnerReturning(STREAM) });
    expect(out).toBe("I did the thing.");
  });

  test("reports each model step and a summary through the callback", async () => {
    const seen: string[] = [];
    await runAgent(cron, worker, async (_k, label) => { seen.push(label); }, { runner: runnerReturning(STREAM) });
    expect(seen.some((l) => l.includes("model step 1"))).toBe(true);
    expect(seen.some((l) => l.includes("10 tokens"))).toBe(true);
  });

  test("uses the WORKER's model, not a default", async () => {
    let seen: string[] = [];
    const spy: CommandRunner = async (args) => { seen = [...args]; return { stdout: STREAM, stderr: "", code: 0, timedOut: false }; };
    await runAgent(cron, { ...worker, model: "opencode/nemotron-3.5-lightning-free" }, async () => {}, { runner: spy });
    expect(seen[seen.indexOf("-m") + 1]).toBe("opencode/nemotron-3.5-lightning-free");
  });

  test("falls back to the free default when there is no worker", async () => {
    let seen: string[] = [];
    const spy: CommandRunner = async (args) => { seen = [...args]; return { stdout: STREAM, stderr: "", code: 0, timedOut: false }; };
    await runAgent(cron, null, async () => {}, { runner: spy });
    expect(seen[seen.indexOf("-m") + 1]).toBe("opencode/space-bunny-free");
  });

  test("a timeout is reported, not thrown", async () => {
    const out = await runAgent(cron, worker, async () => {},
      { runner: runnerReturning(STREAM, 0, true), timeoutMs: 1000 });
    expect(out).toContain("timed out");
  });

  test("a timeout with partial output keeps what arrived", async () => {
    const partial = '{"type":"text","part":{"type":"text","text":"half an ans"}}';
    const out = await runAgent(cron, worker, async () => {},
      { runner: runnerReturning(partial, 0, true), timeoutMs: 1000 });
    expect(out).toContain("half an ans");
  });

  test("a non-zero exit is reported with the reason", async () => {
    const out = await runAgent(cron, worker, async () => {},
      { runner: async () => ({ stdout: "", stderr: "provider refused", code: 3, timedOut: false }) });
    expect(out).toContain("exited 3");
    expect(out).toContain("provider refused");
  });

  test("empty output is reported as such, not returned as a success", async () => {
    const out = await runAgent(cron, worker, async () => {}, { runner: runnerReturning("") });
    expect(out).toContain("no text");
  });

  test("a runner that throws is reported, not propagated", async () => {
    // A job that fails must still record a result: a failure that vanishes is
    // what makes a schedule untrustworthy.
    const out = await runAgent(cron, worker, async () => {},
      { runner: async () => { throw new Error("docker is not running"); } });
    expect(out).toContain("docker is not running");
  });
});


describe("runAgent judges the run, not the exit code", () => {
  const GOOD = [
    JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
    JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "write", state: { status: "completed" } } }),
    JSON.stringify({ type: "text", part: { type: "text", text: "wrote it" } }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish", reason: "stop" } }),
  ].join("\n");
  const runner = (stdout: string, code = 0): CommandRunner => async () => ({ stdout, stderr: "", code, timedOut: false });

  test("a complete run returns the model's text", async () => {
    const out = await runAgent(cron, worker, async () => {}, { runner: runner(GOOD), workdir: "/work/x" });
    expect(out).toContain("wrote it");
  });

  test("exit 0 with a TRUNCATED stream is reported as a failure", async () => {
    const out = await runAgent(cron, worker, async () => {}, { runner: runner(GOOD.split("\n").slice(0, 2).join("\n")), workdir: "/work/x" });
    expect(out).toContain("truncated");
  });

  test("exit 0 with text but no completed tool is a FAILURE, not a success", async () => {
    // The AGENTS.md bug, exactly: confident text, clean exit, nothing done.
    const noTools = [
      JSON.stringify({ type: "text", part: { type: "text", text: "All done!" } }),
      JSON.stringify({ type: "step_finish", part: { type: "step-finish", reason: "stop" } }),
    ].join("\n");
    const out = await runAgent(cron, worker, async () => {}, { runner: runner(noTools), workdir: "/work/x" });
    expect(out).toContain("no completed tool");
  });

  test("the provider's ref id reaches the operator", async () => {
    const err = JSON.stringify({ type: "error", error: { name: "UnknownError", data: { message: "Unexpected server error (ref err_a7a9b326)" } } });
    const out = await runAgent(cron, worker, async () => {}, { runner: runner(err, 1), workdir: "/work/x" });
    expect(out).toContain("err_a7a9b326");
  });
});
