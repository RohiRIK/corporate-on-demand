import { describe, expect, test } from "bun:test";
import { BACKENDS, buildFor, modelIds, backendForModel } from "../src/backend";

describe("the two engines", () => {
  test("both are available", () => {
    expect(BACKENDS.map((b) => b.id).sort()).toEqual(["kilo", "opencode"]);
  });

  test("opencode keeps its EXACT current command shape", () => {
    // A regression guard. Changing this silently is how a job stops running and
    // nobody notices, because the failure looks like a provider outage.
    expect(buildFor("opencode", "opencode/space-bunny-free", "hi", "cod-author")).toEqual([
      "opencode", "run", "--pure", "--auto", "--format", "json",
      "-m", "opencode/space-bunny-free", "--title", "cod-author", '"hi"',
    ]);
  });

  test("kilo uses the same flags - it is an opencode fork", () => {
    const args = buildFor("kilo", "kilo/kilo-auto/free", "hi", "cod-author");
    expect(args.slice(0, 4)).toEqual(["kilo", "run", "--pure", "--format"]);
    expect(args).toContain("json");
    // Verified on the real binary: kilo has no --auto flag.
    expect(args).not.toContain("--auto");
    expect(args[args.indexOf("-m") + 1]).toBe("kilo/kilo-auto/free");
  });

  test("NEITHER engine uses --dir", () => {
    // Measured: `opencode run --dir <git worktree>` fails with an opaque
    // "Unexpected server error". Confinement is the spawn's cwd.
    for (const id of ["opencode", "kilo"]) {
      expect(buildFor(id, modelIds(id)[0] ?? "m", "hi", "cod-author")).not.toContain("--dir");
    }
  });

  test("the prompt is JSON-quoted, so a task with quotes cannot break the shell", () => {
    const args = buildFor("kilo", "kilo/kilo-auto/free", 'say "hi" now', "cod-x");
    expect(args[args.length - 1]).toBe(JSON.stringify('say "hi" now'));
  });

  test("an unknown backend is a named error, not a silent default", () => {
    expect(() => buildFor("nope", "m", "hi", "cod-x")).toThrow(/unknown backend/);
    expect(() => modelIds("nope")).toThrow(/unknown backend/);
  });

  test("every advertised kilo model really is free", () => {
    // `kilo/anthropic/*` returns 401 PAID_MODEL_AUTH_REQUIRED. Advertising a
    // paid model inside a $0 system is a budget bug waiting to happen, and a
    // test is cheaper than discovering it on a bill.
    for (const id of modelIds("kilo")) {
      expect(id.endsWith(":free") || id.endsWith("/free")).toBe(true);
    }
  });

  test("the opencode free set is DECLARED, not inferred from a suffix", () => {
    // Zen's free tier includes ids that do NOT end in "-free" - `big-pickle`
    // is free without announcing it. A suffix check is therefore the wrong
    // test, and asserting one would have deleted a working model. What is
    // asserted is the list itself, so a casual edit is visible in review.
    expect(modelIds("opencode")).toEqual([
      "opencode/space-bunny-free",
      "opencode/big-pickle",
      "opencode/nemotron-3.5-lightning-free",
    ]);
  });
});

describe("backendForModel", () => {
  test("a kilo model id routes to kilo", () => {
    // The workspace schema does not change: the ENGINE is chosen by the model
    // id, so the decision stays visible in cod.json.
    expect(backendForModel("kilo/kilo-auto/free")).toBe("kilo");
    expect(backendForModel("kilo/stepfun/step-3.7-flash:free")).toBe("kilo");
  });

  test("an opencode model routes to opencode", () => {
    expect(backendForModel("opencode/space-bunny-free")).toBe("opencode");
  });

  test("an UNKNOWN model is a named failure, not a silent fallback", () => {
    // Falling back would mean dispatching a model on the wrong engine, and the
    // error would surface as a provider problem rather than a config mistake.
    expect(() => backendForModel("mystery/model-1")).toThrow(/no engine/);
  });
});
