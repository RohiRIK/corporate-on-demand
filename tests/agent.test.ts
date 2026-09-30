import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";

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
    const out = execFileSync(
      "docker",
      [
        "exec",
        "cod-sandbox-cod",
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
  }, 180_000);
});


// ---------------------------------------------------------------- driver
// The unit tests below inject a CommandRunner, so they need neither Docker nor
// a model and cannot be flaky. The live test at the top is the only one that
// does.

import { buildArgs, buildPrompt, runAgent, type CommandRunner } from "../src/agent";
import type { Cron, Worker } from "../src/workspace";

const cron: Cron = {
  name: "nightly",
  agent: "builder",
  task: "summarise the day",
  schedule: "0 3 * * *",
  enabled: true,
};
const worker: Worker = { name: "builder", role: "builds", model: "opencode/space-bunny-free" };

/** Echo canned stdout, so these tests are pure. */
function runnerReturning(stdout: string, code = 0, timedOut = false): CommandRunner {
  return async () => ({ stdout, stderr: "", code, timedOut });
}

const STREAM = [
  '{"type":"step_start","part":{"type":"step-start"}}',
  '{"type":"text","part":{"type":"text","text":"I did the thing."}}',
  '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":10,"input":9,"output":1},"cost":0}}',
].join("\n");

describe("buildArgs", () => {
  test("uses the model it is given, so per-worker routing works", () => {
    const args = buildArgs(cron, "opencode/some-other-free", "hi");
    expect(args[args.indexOf("-m") + 1]).toBe("opencode/some-other-free");
  });

  test("never grants tool-use permission", () => {
    // No decision has been made about what an agent may touch, so --auto is
    // withheld. If this test ever needs deleting, that decision was made.
    expect(buildArgs(cron, "m", "hi")).not.toContain("--auto");
  });

  test("asks for the parseable stream format", () => {
    const args = buildArgs(cron, "m", "hi");
    expect(args[args.indexOf("--format") + 1]).toBe("json");
  });

  test("is credential-free: no auth-shaped flag leaks into the command", () => {
    expect(buildArgs(cron, "m", "hi").join(" ")).not.toMatch(/api[-_]?key|token|password|secret/i);
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

  test("forbids claiming to have changed files, because it cannot", () => {
    expect(buildPrompt(cron, null)).toContain("cannot");
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
