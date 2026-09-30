/**
 * The global concurrency gate.
 *
 * These tests exist because the previous implementation looked correct and
 * enforced nothing. `runWithLimit(maxConcurrent, [oneClosure])` received a
 * single-element array, so it always spawned exactly one worker: ten crons
 * firing at `:00` ran ten jobs at once, and `maxConcurrent` was read, reported
 * in the heartbeat, and used for nothing.
 *
 * The counter is measured from inside the tasks, which is the only place the
 * true peak is observable. Asserting on scheduling order instead would have
 * passed against the broken version.
 */

import { describe, expect, test } from "bun:test";
import { createGate } from "../src/limit";

/** Run `tasks` through the gate and return the highest simultaneous count. */
async function peakUnderGate(limit: number, count: number): Promise<number> {
  const gate = createGate(limit);
  let active = 0;
  let peak = 0;
  const work = async (): Promise<void> => {
    await gate.acquire();
    active += 1;
    peak = Math.max(peak, active);
    // A real task boundary, so overlap is possible and the test can see it.
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    gate.release();
  };
  // A factory, not a shared promise: every caller must actually run, or the
  // test measures one task and passes against a broken gate.
  await Promise.all(Array.from({ length: count }, () => work()));
  return peak;
}

describe("createGate", () => {
  test("never exceeds the limit", async () => {
    // The bug this pins: with limit 2 and ten callers, the old code ran all ten.
    expect(await peakUnderGate(2, 10)).toBeLessThanOrEqual(2);
  });

  test("the limit is global, not per call-site", async () => {
    // Two separate acquire/release pairs, as two crons would do, must still
    // share one ceiling. This is the specific shape that was broken.
    const gate = createGate(1);
    let active = 0;
    let peak = 0;
    const one = async (): Promise<void> => {
      await gate.acquire();
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      gate.release();
    };
    await Promise.all(Array.from({ length: 6 }, one));
    expect(peak).toBe(1);
  });

  test("a released slot is handed to the next waiter, not freed to nobody", async () => {
    // The distinction that matters: `release` with a waiter present must HAND
    // OVER the slot, so `active` stays at the limit rather than dipping. A gate
    // that simply decremented would let a third task start while the second was
    // still waiting, and the ceiling would be 1 in name only.
    const gate = createGate(1);
    await gate.acquire();
    expect(gate.active()).toBe(1);

    let handed = false;
    const waiter = gate.acquire().then(() => {
      // Resolving means this waiter now owns the slot.
      expect(gate.active()).toBe(1);
      handed = true;
    });
    // Let the waiter reach its await before the slot is released.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(handed).toBe(false);

    gate.release();
    await waiter;
    expect(handed).toBe(true);
    expect(gate.active()).toBe(1);
    gate.release();
  });

  test("a task that throws still frees its slot, via the caller's finally", async () => {
    // The gate does not own the `finally` - `src/scheduler.ts` does. So this
    // test exercises the pattern the scheduler actually uses: acquire, work in
    // a try, release in a finally. If a throwing job leaked its slot, the
    // ceiling would shrink by one on every failure and eventually deadlock the
    // whole schedule.
    const gate = createGate(2);
    const task = async (shouldThrow: boolean): Promise<void> => {
      await gate.acquire();
      try {
        if (shouldThrow) throw new Error("work blew up");
      } finally {
        gate.release();
      }
    };

    expect(gate.active()).toBe(0);
    await expect(task(true)).rejects.toThrow("work blew up");
    expect(gate.active()).toBe(0);

    // A success and a failure interleaved must leave the gate at full width.
    await Promise.allSettled([task(false), task(true), task(false)]);
    expect(gate.active()).toBe(0);

    // And it must still be usable afterwards.
    await task(false);
    expect(gate.active()).toBe(0);
  });

  test("repeated acquire/release cycles return to zero", async () => {
    // The no-leak property on its own, named for what it actually checks.
    const gate = createGate(1);
    for (let n = 0; n < 4; n += 1) {
      await gate.acquire();
      gate.release();
    }
    expect(gate.active()).toBe(0);
  });

  test("a limit below 1 is clamped, not deadlocking", async () => {
    const gate = createGate(0);
    await gate.acquire();
    expect(gate.active()).toBe(1);
    gate.release();
    expect(gate.active()).toBe(0);
  });

  test("waiters are served in arrival order", async () => {
    const gate = createGate(1);
    const order: number[] = [];
    await gate.acquire();
    const waiters = [1, 2, 3].map((n) =>
      gate.acquire().then(() => {
        order.push(n);
        gate.release();
      }),
    );
    gate.release();
    await Promise.all(waiters);
    expect(order).toEqual([1, 2, 3]);
  });
});
