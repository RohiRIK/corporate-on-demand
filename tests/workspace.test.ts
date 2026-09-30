
import { describe, expect, test } from "bun:test";
import { Workspace } from "../src/workspace";

describe("worker skills and department purpose", () => {
  const base = (extra: Record<string, unknown> = {}) => ({
    version: 1,
    company: { name: "acme", purpose: "test" },
    timezone: "UTC",
    departments: [
      { name: "engineering", workers: [{ name: "builder", role: "builds", model: "opencode/space-bunny-free" }], ...extra },
    ],
  });

  test("a worker names the skills its job needs", () => {
    const parsed = Workspace.safeParse({
      ...base(),
      departments: [{
        name: "engineering",
        workers: [{ name: "builder", role: "builds", model: "opencode/space-bunny-free", skills: ["testing", "git-discipline"] }],
      }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.departments[0]?.workers[0]?.skills).toEqual(["testing", "git-discipline"]);
  });

  test("skills are optional, so an existing workspace still loads", () => {
    // The template ships workers with no skills. Making this required would
    // break every existing cod.json the moment the field lands.
    const parsed = Workspace.safeParse(base());
    expect(parsed.success).toBe(true);
    expect(parsed.data?.departments[0]?.workers[0]?.skills).toEqual([]);
  });

  test("a skill name is a plain lowercase identifier", () => {
    // A skill name reaches a file path in the per-job instruction bundle, so
    // it is validated at the schema rather than trusted at the point of use.
    for (const bad of ["../etc/passwd", "Testing", "a/b", "", "a b"]) {
      const parsed = Workspace.safeParse({
        ...base(),
        departments: [{
          name: "engineering",
          workers: [{ name: "builder", role: "builds", model: "m", skills: [bad] }],
        }],
      });
      expect(parsed.success).toBe(false);
    }
  });

  test("a department declares a standing purpose", () => {
    const parsed = Workspace.safeParse({
      ...base(),
      departments: [{
        name: "engineering",
        purpose: "keep the parser correct",
        workers: [{ name: "builder", role: "builds", model: "m" }],
      }],
    });
    expect(parsed.data?.departments[0]?.purpose).toBe("keep the parser correct");
  });

  test("purpose is optional and defaults to empty", () => {
    // An empty purpose must be visible as empty, not silently invented, so the
    // bundle can tell the agent to ask rather than guess.
    const parsed = Workspace.safeParse(base());
    expect(parsed.data?.departments[0]?.purpose).toBe("");
  });
});
