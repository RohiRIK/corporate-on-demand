import { describe, expect, test } from "bun:test";
import { Registry } from "../src/registry";

const candidates = [
  { backend: "opencode", model: "opencode/space-bunny-free" },
  { backend: "kilo", model: "kilo/kilo-auto/free" },
];

describe("the circuit breaker", () => {
  test("a model that keeps failing is dropped from rotation", () => {
    const r = new Registry();
    for (let i = 0; i < 3; i += 1) r.record({ backend: "kilo", model: "kilo/kilo-auto/free", ok: false, at: i * 1000 });
    expect(r.healthy("kilo", "kilo/kilo-auto/free")).toBe(false);
    expect(r.healthy("opencode", "opencode/space-bunny-free")).toBe(true);
  });

  test("one failure after a success is NOT a pattern yet", () => {
    // Consecutive failures trip it. Tripping on a single blip would eject a
    // model for one bad minute and then have nothing left to dispatch to.
    const r = new Registry();
    r.record({ backend: "kilo", model: "m", ok: true, at: 1 });
    r.record({ backend: "kilo", model: "m", ok: false, at: 2 });
    expect(r.healthy("kilo", "m")).toBe(true);
    r.record({ backend: "kilo", model: "m", ok: false, at: 3 });
    expect(r.healthy("kilo", "m")).toBe(false);
  });

  test("a trip is remembered so repeat offenders cannot creep back in", () => {
    // Eject-then-retry-silently is how a broken model stays in the pool, so a
    // tripped model is only readmitted by an actual recorded success.
    const r = new Registry();
    for (let i = 0; i < 3; i += 1) r.record({ backend: "kilo", model: "m", ok: false, at: i });
    expect(r.healthy("kilo", "m")).toBe(false);
    r.record({ backend: "kilo", model: "m", ok: true, at: 99 });
    expect(r.healthy("kilo", "m")).toBe(true);
  });

  test("a success clears the strike count", () => {
    const r = new Registry();
    r.record({ backend: "kilo", model: "m", ok: false, at: 1 });
    r.record({ backend: "kilo", model: "m", ok: true, at: 2 });
    r.record({ backend: "kilo", model: "m", ok: false, at: 3 });
    expect(r.healthy("kilo", "m")).toBe(true);
  });
});

describe("picking a model", () => {
  test("prefers the engine whose model is healthy", () => {
    const r = new Registry();
    for (let i = 0; i < 3; i += 1) r.record({ backend: "opencode", model: "opencode/space-bunny-free", ok: false, at: i });
    expect(r.pick(candidates)).toEqual({ backend: "kilo", model: "kilo/kilo-auto/free" });
  });

  test("when EVERYTHING is unhealthy it STILL returns something", () => {
    // A registry that returns nothing is an outage of its own making, and it
    // would look exactly like the provider outage it was meant to survive.
    const r = new Registry();
    for (let i = 0; i < 9; i += 1) r.record({ backend: "kilo", model: "kilo/kilo-auto/free", ok: false, at: i });
    expect(r.pick([candidates[1]!])).toEqual({ backend: "kilo", model: "kilo/kilo-auto/free" });
  });

  test("it ROTATES across equally good models rather than hammering one", () => {
    // Rotation is the actual fix for per-model rot: one model, pinned, was how
    // we rode Zen to a 25% success rate in the first place.
    const r = new Registry();
    const seen = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const p = r.pick(candidates);
      if (p !== null) seen.add(p.model);
    }
    expect(seen.size).toBe(2);
  });

  test("a proven model is preferred over an unproven one", () => {
    const r = new Registry();
    for (let i = 0; i < 4; i += 1) r.record({ backend: "kilo", model: "kilo/kilo-auto/free", ok: true, at: i });
    expect(r.pick(candidates)?.model).toBe("kilo/kilo-auto/free");
  });

  test("an empty candidate list returns null rather than throwing", () => {
    expect(new Registry().pick([])).toBeNull();
  });

  test("a model that answers but FAILS the assertion is ejected", () => {
    // The one mechanism that protects against a model being confidently wrong:
    // it is not a provider error, it is a wrong answer, and only the assertion
    // can see it.
    const r = new Registry();
    for (let i = 0; i < 2; i += 1) r.record({ backend: "kilo", model: "confidently-wrong", ok: false, at: i });
    expect(r.healthy("kilo", "confidently-wrong")).toBe(false);
  });
});
