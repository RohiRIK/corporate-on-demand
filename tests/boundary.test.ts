import { describe, expect, test } from "bun:test";
import { radiusExceeded, classifyChange, summariseChange } from "../src/boundary";

/**
 * The boundary between "the agent was told to stay inside" and "the agent
 * actually did".
 *
 * An instruction in a file is a request, not a control. The only thing that can
 * be enforced is what changed on disk, so this module judges the FILES. Every
 * test here is written to pass only if the check reads the paths - a check
 * against the agent's own description of what it did proves nothing, which is
 * the same trap as asking a job to "reply with X" and grepping for X.
 */
describe("radiusExceeded", () => {
  test("radius 0 and 1 are never exceeded by repository files", () => {
    // Self-contained and cross-department work are allowed to touch these; only
    // GLOBAL work is fenced.
    for (const radius of [0, 1]) {
      expect(radiusExceeded(["src/agent.ts", "README.md"], radius)).toBe(false);
    }
  });

  test("radius 2 is exceeded by anything global", () => {
    for (const path of ["src/agent.ts", "docker/Dockerfile.sandbox", "ops/cod-workspace@.service", "package.json", "verify.sh", ".github/workflows/ci.yml"]) {
      expect(radiusExceeded([path], 2)).toBe(true);
    }
  });

  test("radius 2 is NOT exceeded by a self-contained new file", () => {
    // Otherwise radius 2 is meaningless: nothing could ever pass it.
    expect(radiusExceeded(["answer.txt", "notes.md", "docs/x.md"], 2)).toBe(false);
  });

  test("a path that merely CONTAINS a global prefix is not global", () => {
    // "srcs/" is not "src/", and "myops/" is not "ops/". A prefix match without
    // the boundary would refuse honest work.
    expect(radiusExceeded(["srcs/thing.ts", "myops/notes.md", "packages/one/x.js"], 2)).toBe(false);
  });

  test("an absolute path into a global area is caught", () => {
    expect(radiusExceeded(["/work/src/docker.ts"], 2)).toBe(true);
  });

  test("an empty change set never exceeds", () => {
    expect(radiusExceeded([], 2)).toBe(false);
  });
});

describe("classifyChange", () => {
  test("reports the files, and the global ones when radius is 2", () => {
    const c = classifyChange(["answer.txt", "src/agent.ts"], 2);
    expect(c.changed).toEqual(["answer.txt", "src/agent.ts"]);
    expect(c.global).toEqual(["src/agent.ts"]);
    expect(c.exceeded).toBe(true);
  });

  test("reports nothing global for a self-contained change", () => {
    const c = classifyChange(["answer.txt"], 0);
    expect(c.global).toEqual([]);
    expect(c.exceeded).toBe(false);
  });

  test("a DELETED global file counts as global", () => {
    // Deleting src/agent.ts is at least as dangerous as editing it, and a check
    // that only looked at additions would wave it through.
    expect(radiusExceeded(["src/agent.ts"], 2)).toBe(true);
  });
});

describe("summariseChange", () => {
  test("one line a human can read", () => {
    const s = summariseChange(classifyChange(["a.txt", "b.txt", "c.txt"], 0));
    expect(s).toContain("3 file");
    expect(s.split("\n").length).toBe(1);
  });

  test("says so plainly when nothing changed", () => {
    expect(summariseChange(classifyChange([], 0))).toBe("no files changed");
  });

  test("names the offending global files, because a refusal must be actionable", () => {
    const s = summariseChange(classifyChange(["src/a.ts", "src/b.ts"], 2));
    expect(s).toContain("src/a.ts");
    // Case-insensitive on purpose: the assertion is that the refusal says
    // "global", not which case it happens to be shouted in.
    expect(s.toLowerCase()).toContain("global");
  });
});
