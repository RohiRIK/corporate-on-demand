import { describe, expect, test } from "bun:test";
import { judgeRun } from "../src/assert";

const line = (o: unknown): string => JSON.stringify(o);

const GOOD = [
  line({ type: "step_start", part: { type: "step-start" } }),
  line({ type: "tool_use", part: { type: "tool", tool: "write", state: { status: "completed" } } }),
  line({ type: "text", part: { type: "text", text: "wrote the file" } }),
  line({ type: "step_finish", part: { type: "step-finish", reason: "stop" } }),
].join("\n");

const run = (raw: string, over: Partial<Parameters<typeof judgeRun>[0]> = {}) =>
  judgeRun({ raw, code: 0, timedOut: false, elapsedMs: 9000, promptLength: 120, ...over });

describe("judgeRun", () => {
  test("a complete run with a completed tool PASSES", () => {
    expect(run(GOOD).ok).toBe(true);
  });

  test("a TRUNCATED stream FAILS even though the exit code is 0", () => {
    // The exact upstream bug: opencode exits 0 having dropped the tail. The
    // exit code says nothing; only the missing step_finish gives it away.
    const v = run(GOOD.split("\n").slice(0, 3).join("\n"));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("no terminal step_finish");
  });

  test("exit 0 with NO text FAILS", () => {
    const v = run(line({ type: "step_finish", part: { reason: "stop" } }));
    expect(v.ok).toBe(false);
  });

  test("exit 0 with NO completed tool FAILS - this is the wrong-reason case", () => {
    // An agent that changed nothing and said it was done. Exit 0, confident
    // text, and still a failed job. This is the bug that shipped once.
    const noTools = [line({ type: "text", part: { type: "text", text: "All done!" } }), line({ type: "step_finish", part: { reason: "stop" } })].join("\n");
    const v = run(noTools);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("no completed tool");
  });

  test("an error event FAILS even when a step_finish says stop", () => {
    const bad = [
      line({ type: "text", part: { type: "text", text: "ok" } }),
      line({ type: "step_finish", part: { reason: "stop" } }),
      line({ type: "error", error: { name: "APIError", data: { message: "boom" } } }),
    ].join("\n");
    const v = run(bad);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("boom");
  });

  test("an EMPTY PROMPT is refused - the AGENTS.md guard", () => {
    // We shipped a bug where an agent was given no instructions and still
    // completed the task. A prompt this short means it was not told anything.
    const v = run(GOOD, { promptLength: 0 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("prompt");
  });

  test("a TIMEOUT FAILS and says so", () => {
    const v = run(GOOD, { timedOut: true, elapsedMs: 180_000 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("timed out");
  });

  test("a non-zero exit FAILS and carries the provider's ref id", () => {
    const err = line({ type: "error", error: { name: "UnknownError", data: { message: "Unexpected server error (ref err_a7a9b326)" } } });
    const v = run(err, { code: 1, elapsedMs: 500 });
    expect(v.ok).toBe(false);
    expect(v.ref).toBe("err_a7a9b326");
  });

  test("a run slower than the budget FAILS - a 280s 'success' is a failure", () => {
    const v = run(GOOD, { elapsedMs: 280_000, budgetMs: 60_000 });
    expect(v.ok).toBe(false);
  });

  test("an ok verdict names the tools, so the operator can see what ran", () => {
    expect(run(GOOD).detail).toContain("write");
  });

  test("a tool that reported completed but exited non-zero is not a completed tool", () => {
    const bogus = [
      line({ type: "text", part: { type: "text", text: "tests pass" } }),
      line({ type: "step_finish", part: { reason: "stop" } }),
      line({ type: "tool_use", part: { type: "tool", tool: "bash", state: { status: "completed", metadata: { exit: 1 } } } }),
    ].join("\n");
    expect(run(bogus).ok).toBe(false);
  });
});
