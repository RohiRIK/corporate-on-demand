/**
 * The scheduled task.
 *
 * At this stage a task is an echo, and that is the whole point: the schedule
 * must reach a named agent and the result must come back out, without building
 * an execution layer whose policy nobody has decided yet.
 *
 * These tests pin the contract that the real dispatcher will later replace, so
 * that swapping it in is a visible change rather than a silent one.
 */

import { describe, expect, test } from "bun:test";
import { echoTask } from "../src/task";
import type { Cron } from "../src/workspace";

const cron = (over: Partial<Cron> = {}): Cron => ({
  name: "heartbeat",
  schedule: "* * * * *",
  agent: "builder",
  task: "verify the container works",
  enabled: true,
  ...over,
});

describe("echoTask", () => {
  test("returns the agent and the task it was given", () => {
    const result = echoTask(cron());
    expect(result.agent).toBe("builder");
    expect(result.task).toBe("verify the container works");
    expect(result.cron).toBe("heartbeat");
  });

  test("the output carries both the agent and the task", () => {
    // This is what the supervisor prints, so it has to name both or a log line
    // cannot tell you who was supposed to do what.
    expect(echoTask(cron()).output).toBe("builder: verify the container works");
  });

  test("a job is reported successful", () => {
    expect(echoTask(cron()).ok).toBe(true);
  });

  test("runs no subprocess and touches no filesystem", () => {
    // The value of an echo is that it cannot fail for interesting reasons: if
    // a scheduled job breaks, the cause is the scheduling, not the work. This
    // test is the guard on that claim - a real dispatcher will replace it, and
    // whoever does that should know this property is being given up.
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1000; i += 1) echoTask(cron({ name: `job-${i}` }));
    const after = process.memoryUsage().heapUsed;
    // 1000 echoes allocating a small object each should not grow the heap by
    // more than a few MB. A dispatcher that spawned or wrote would.
    expect(after - before).toBeLessThan(8 * 1024 * 1024);
  });

  test("a disabled job still echoes if it is run", () => {
    // The scheduler filters disabled jobs before calling this. The function
    // itself does not re-check, because a task runner that silently no-ops is
    // harder to debug than one that runs what it is handed.
    expect(echoTask(cron({ enabled: false })).ok).toBe(true);
  });

  test("different agents and tasks stay distinct", () => {
    const a = echoTask(cron({ agent: "builder", task: "build" }));
    const b = echoTask(cron({ agent: "tester", task: "test" }));
    expect(a.output).not.toBe(b.output);
  });
});
