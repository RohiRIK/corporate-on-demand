import { describe, expect, test } from "bun:test";
import { pickForJob } from "../src/rotate";
import { Registry } from "../src/registry";

/**
 * Model rotation, as the SYSTEM uses it.
 *
 * src/registry.ts passed its own tests for a long time while nothing in src/
 * ever constructed one, so every job used the worker's pinned model and the
 * reliability work bought nothing. These tests go through the function the
 * supervisor actually calls, so "the class works" can no longer stand in for
 * "the system uses it".
 *
 * The policy is STICKY WITH FAILOVER, not random rotation. A worker names its
 * model and keeps it while it works - per-worker routing is settled - and only
 * moves when that model is ejected. Round-robin would send every job to a
 * different, untested model, which is worse than the thing being fixed.
 */

const preferred = { backend: "kilo", model: "kilo/kilo-auto/free" };
const others = [
  { backend: "kilo", model: "kilo/stepfun/step-3.7-flash:free" },
  { backend: "kilo", model: "kilo/poolside/laguna-s-2.1:free" },
];

describe("pickForJob", () => {
  test("a worker with no history gets the model it asked for", () => {
    // Sticky, not random. A worker naming its model is a decision, and
    // overriding it on the first job would make per-worker routing meaningless.
    expect(pickForJob(new Registry(), preferred, others)).toEqual(preferred);
  });

  test("it keeps using it while that model keeps working", () => {
    const r = new Registry();
    for (let i = 0; i < 5; i += 1) r.record({ ...preferred, ok: true, at: i });
    expect(pickForJob(r, preferred, others)).toEqual(preferred);
  });

  test("ONE failure is not enough to move - a blip is not a pattern", () => {
    const r = new Registry();
    r.record({ ...preferred, ok: true, at: 1 });
    r.record({ ...preferred, ok: false, at: 2 });
    expect(pickForJob(r, preferred, others)).toEqual(preferred);
  });

  test("after consecutive failures it MOVES, and that is the whole point", () => {
    const r = new Registry();
    r.record({ ...preferred, ok: false, at: 1 });
    r.record({ ...preferred, ok: false, at: 2 });
    const next = pickForJob(r, preferred, others);
    expect(next).not.toEqual(preferred);
    expect(next?.model).toContain(":free");
  });

  test("it never rotates onto a model it cannot pay for", () => {
    // Every fallback has to be free. A failover onto a paid id is a budget
    // bug, and the pool is supplied free-of-charge precisely so this cannot
    // happen by accident.
    const r = new Registry();
    for (let i = 0; i < 3; i += 1) r.record({ ...preferred, ok: false, at: i });
    for (let n = 0; n < 12; n += 1) {
      const pick = pickForJob(r, preferred, others);
      if (pick !== null) expect(pick.model.endsWith(":free") || pick.model.endsWith("/free")).toBe(true);
    }
  });

  test("it NEVER fails over to another engine", () => {
    // Switching engine mid-job would change the binary and the failure modes
    // under a running worktree, trading a known failure for an unknown one. A
    // worker is pinned to one engine, and a pool of another engine's models is
    // not a fallback for it.
    const crossEngine = [{ backend: "opencode", model: "opencode/space-bunny-free" }];
    const r = new Registry();
    for (let i = 0; i < 3; i += 1) r.record({ ...preferred, ok: false, at: i });
    const pick = pickForJob(r, preferred, crossEngine);
    expect(pick?.backend).toBe("kilo");
    expect(pick?.model).not.toBe("opencode/space-bunny-free");
  });

  test("with no pool at all it still dispatches rather than refusing", () => {
    // Refusing to work is its own kind of silent failure, and it looks exactly
    // like the outage it was meant to survive.
    const r = new Registry();
    for (let i = 0; i < 3; i += 1) r.record({ ...preferred, ok: false, at: i });
    expect(pickForJob(r, preferred, [])).toEqual(preferred);
  });

  test("a model that recovers is preferred again", () => {
    const r = new Registry();
    r.record({ ...preferred, ok: false, at: 1 });
    r.record({ ...preferred, ok: false, at: 2 });
    r.record({ ...preferred, ok: true, at: 3 });
    expect(pickForJob(r, preferred, others)).toEqual(preferred);
  });
});
