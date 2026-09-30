import { describe, expect, test } from "bun:test";
import { judgeRun } from "../src/assert";
import { Workspace } from "../src/workspace";
import { runAgent, isAgentFailure } from "../src/agent";
import type { CommandRunner } from "../src/agent";
import type { Cron, Worker } from "../src/workspace";

/**
 * A job that only inspects and reports makes NO tool call.
 *
 * The success assertion requires a completed tool, because that is what kills
 * the "said it did the work" class - so a read-only job would be reported as a
 * failure for ever. The opt-out exists, and it is PER JOB rather than global,
 * because a global relaxation is how the wrong-reason class comes back.
 */

const READONLY_STREAM = [
  JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
  JSON.stringify({ type: "text", part: { type: "text", text: "There are three departments." } }),
  JSON.stringify({ type: "step_finish", part: { type: "step-finish", reason: "stop" } }),
].join("\n");

const base = { code: 0, timedOut: false, elapsedMs: 5000, promptLength: 200 };

describe("a read-only job", () => {
  test("passes when the job opted out", () => {
    const v = judgeRun({ ...base, raw: READONLY_STREAM, expectTools: false });
    expect(v.ok).toBe(true);
    expect(v.detail).toContain("read-only");
  });

  test("still FAILS a read-only job that never finished", () => {
    // The opt-out is NOT a bypass. A truncated read-only run is still a failure.
    const truncated = READONLY_STREAM.split("\n").slice(0, 1).join("\n");
    expect(judgeRun({ ...base, raw: truncated, expectTools: false }).ok).toBe(false);
  });

  test("still FAILS a read-only job that reported an error", () => {
    const boom = `${READONLY_STREAM}\n${JSON.stringify({ type: "error", error: { name: "APIError", data: { message: "boom" } } })}`;
    expect(judgeRun({ ...base, raw: boom, expectTools: false }).ok).toBe(false);
  });

  test("still FAILS a read-only job with an empty prompt", () => {
    expect(judgeRun({ ...base, raw: READONLY_STREAM, promptLength: 0, expectTools: false }).ok).toBe(false);
  });

  test("DEFAULT is strict: the same stream fails without the opt-out", () => {
    // The default matters more than the flag. A workspace that never sets it
    // must get the strict behaviour, or the hole is open everywhere.
    expect(judgeRun({ ...base, raw: READONLY_STREAM }).ok).toBe(false);
  });
});

describe("the schema", () => {
  const workspace = {
    version: 1,
    company: { name: "Acme", purpose: "test" },
    timezone: "UTC",
    departments: [{ name: "engineering", purpose: "build", workers: [{ name: "builder", role: "builds", model: "m", skills: [] }] }],
    crons: [{ name: "report", schedule: "0 3 * * *", agent: "builder", task: "list the departments", enabled: true, expectTools: false }],
  };

  test("accepts expectTools: false", () => {
    expect(Workspace.safeParse(workspace).success).toBe(true);
  });

  test("omitting it defaults to STRICT, so old workspaces keep working", () => {
    const { expectTools: _dropped, ...withoutField } = workspace.crons[0]!;
    const parsed = Workspace.safeParse({ ...workspace, crons: [withoutField] });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.crons[0]?.expectTools).toBe(true);
  });
});

describe("runAgent honours the job's own setting", () => {
  const cron: Cron = { name: "report", agent: "builder", task: "list the departments", schedule: "0 3 * * *", enabled: true, expectTools: false };
  const worker: Worker = { name: "builder", role: "builds", model: "opencode/space-bunny-free", skills: [] };
  const runner = (stdout: string): CommandRunner => async () => ({ stdout, stderr: "", code: 0, timedOut: false });

  test("a read-only job succeeds with no tool call", async () => {
    const out = await runAgent(cron, worker, async () => {}, { runner: runner(READONLY_STREAM), workdir: "/work/x" });
    expect(isAgentFailure(out)).toBe(false);
    expect(out).toContain("three departments");
  });

  test("the SAME stream fails a normal job", async () => {
    // Proves the flag is doing the work, not the stream shape.
    const strict: Cron = { ...cron, expectTools: true };
    const out = await runAgent(strict, worker, async () => {}, { runner: runner(READONLY_STREAM), workdir: "/work/x" });
    expect(isAgentFailure(out)).toBe(true);
    expect(out).toContain("no completed tool");
  });
});
