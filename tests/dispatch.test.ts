/**
 * The dispatcher contract.
 *
 * These tests are the reason the module exists. The supervision design hung a
 * progress heartbeat off a per-step loop, and no such loop existed - so these
 * pin the properties a supervisor will later depend on being true, before
 * anything depends on them.
 *
 * The load-bearing ones are: step numbers are assigned by the harness rather
 * than the driver, a driver cannot skip one, and a broken progress sink cannot
 * fail the job. Those are what stall detection and fencing rest on.
 */

import { describe, expect, test } from "bun:test";
import { dispatch, echoDriver, StoppedError, type Driver, type Step } from "../src/dispatch";
import type { Cron } from "../src/workspace";

const cron: Cron = {
  name: "nightly",
  agent: "engineering",
  task: "do the thing",
  schedule: "0 3 * * *",
  enabled: true,
  expectTools: true,
};

/** A driver that takes `n` steps and returns a fixed output. */
function driverOf(n: number, out = "done"): Driver {
  return async (_cron, step): Promise<string> => {
    for (let i = 0; i < n; i += 1) {
      await step("act", `step ${i + 1}`);
    }
    return out;
  };
}

describe("dispatch", () => {
  test("reports every step, numbered from 1, in order", async () => {
    const seen: Step[] = [];
    const result = await dispatch(cron, driverOf(3), { onStep: (s) => void seen.push(s) });
    expect(seen.map((s) => s.no)).toEqual([1, 2, 3, 4]);
    expect(seen.map((s) => s.label)).toEqual(["step 1", "step 2", "step 3", "job complete"]);
    expect(result.ok).toBe(true);
    expect(result.output).toBe("done");
  });

  test("the harness assigns step numbers, so a driver cannot lie about progress", async () => {
    // A driver that reports nothing still gets exactly one finish step, and a
    // driver that reports out of band cannot create a gap. step_no is a fact
    // about the loop, not a self-report - this is the basis of stall detection.
    const seen: Step[] = [];
    await dispatch(cron, async () => "silent", { onStep: (s) => void seen.push(s) });
    expect(seen.map((s) => s.no)).toEqual([1]);
    expect(seen[0]?.kind).toBe("finish");
  });

  test("a failing step sink does not fail the job", async () => {
    // A supervisor that dies because logging threw is worse than one that
    // loses a progress line.
    const result = await dispatch(cron, driverOf(2), {
      onStep: () => {
        throw new Error("sink is broken");
      },
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("done");
    // Counted, not silent, so systematic loss is visible.
    expect(result.output).toContain("3 progress report(s) lost");
  });

  test("a driver that throws surfaces as ok:false, not as a rejected promise", async () => {
    // The supervisor settles in a finally and records a result either way, so
    // a rejection here would be a worse contract than a failed result.
    const result = await dispatch(cron, async () => {
      throw new Error("the work blew up");
    });
    expect(result.ok).toBe(false);
    expect(result.output).toBe("the work blew up");
  });

  test("shouldStop is asked between steps and stops at a boundary", async () => {
    let checks = 0;
    const seen: Step[] = [];
    const result = await dispatch(
      cron,
      driverOf(10),
      {
        shouldStop: () => {
          checks += 1;
          return checks > 2;
        },
        onStep: (s) => void seen.push(s),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("stopped at a step boundary");
    // Stopped early rather than running all ten.
    expect(seen.length).toBeLessThan(10);
    expect(checks).toBeGreaterThan(2);
  });

  test("a stop request is checked BEFORE a step runs, not after", async () => {
    // If it were checked after, the agent would have done the work and then
    // been told to stop, which is the opposite of what an interrupt means.
    // `step` is a boundary: the driver reaches it BEFORE doing the next chunk
    // of work. So a stop requested up front must prevent that work entirely.
    const started: string[] = [];
    await dispatch(
      cron,
      async (_c, step) => {
        await step("act", "only");
        started.push("work");
        return "done";
      },
      { shouldStop: () => true },
    );
    expect(started).toEqual([]);
  });

  test("a run that is never stopped completes normally", async () => {
    const result = await dispatch(cron, driverOf(2), { shouldStop: () => false });
    expect(result.ok).toBe(true);
  });

  test("stopped runs still leave a finish step, so the end state is always recorded", async () => {
    const seen: Step[] = [];
    await dispatch(cron, driverOf(5), { shouldStop: (() => {
      let n = 0;
      return () => {
        n += 1;
        return n > 1;
      };
    })(), onStep: (s) => void seen.push(s) });
    expect(seen.at(-1)?.kind).toBe("finish");
  });

  test("StoppedError carries how far the run got", async () => {
    // Useful to the supervisor: it is the difference between "stopped at the
    // start" and "stopped near the end", which decide different responses.
    const error = new StoppedError(7);
    expect(error.completed).toBe(7);
    expect(error.message).toContain("7");
  });

  test("steps carry a duration, so a slow step is visible", async () => {
    let t = 0;
    const seen: Step[] = [];
    await dispatch(cron, driverOf(1), {
      clock: () => {
        t += 5;
        return t;
      },
      onStep: (s) => void seen.push(s),
    });
    expect(seen.every((s) => s.ms > 0)).toBe(true);
  });

  test("the result carries the cron's identity through unchanged", async () => {
    const result = await dispatch(cron, echoDriver);
    expect(result.cron).toBe("nightly");
    expect(result.agent).toBe("engineering");
    expect(result.task).toBe("do the thing");
    expect(result.ok).toBe(true);
  });
});

describe("echoDriver", () => {
  test("produces the same output the old echo did", async () => {
    // The seam is meant to be behaviour-preserving: everything above it must
    // not be able to tell the driver changed.
    const result = await dispatch(cron, echoDriver);
    expect(result.output).toBe("engineering: do the thing");
  });

  test("reports plan, act, observe, finish", async () => {
    const seen: Step[] = [];
    await dispatch(cron, echoDriver, { onStep: (s) => void seen.push(s) });
    expect(seen.map((s) => s.kind)).toEqual(["plan", "act", "observe", "finish"]);
  });
});
