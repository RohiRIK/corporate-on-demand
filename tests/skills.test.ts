import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInstructions, renderSkill, resolveSkills, writeInstructions, SKILLS_DIR } from "../src/skills";
import type { Department, Worker } from "../src/workspace";

const dirs: string[] = [];
function bundle(): string {
  const root = mkdtempSync(join(tmpdir(), "cod-skills-"));
  dirs.push(root);
  for (const name of ["testing", "git-discipline"]) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "SKILL.md"), `## ${name}\n\nHow to do ${name} in this repo.\n`, "utf8");
  }
  // A directory with no SKILL.md - a half-installed skill.
  mkdirSync(join(root, "empty-one"), { recursive: true });
  return root;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const department: Department = { name: "engineering", purpose: "keep the parser correct", workers: [] };
const worker: Worker = { name: "builder", role: "builds", model: "opencode/space-bunny-free", skills: ["testing", "git-discipline"] };

describe("resolveSkills", () => {
  test("returns the skills that exist, in the order asked for", () => {
    expect(resolveSkills(bundle(), ["git-discipline", "testing"])).toEqual(["git-discipline", "testing"]);
  });

  test("silently drops a skill the bundle does not have", () => {
    // renderSkill is what reports the absence, with a name. Dropping it here
    // without a word would make a typo look like a deliberate choice.
    expect(resolveSkills(bundle(), ["testing", "nonexistent"])).toEqual(["testing"]);
  });

  test("a missing bundle directory yields no skills rather than throwing", () => {
    // A workspace may name skills before the bundle is deployed. That is a
    // degraded agent, not a crashed scheduler.
    expect(resolveSkills("/no/such/bundle", ["testing"])).toEqual([]);
  });
});

describe("renderSkill", () => {
  test("renders the body when the skill exists", () => {
    expect(renderSkill(bundle(), "testing")).toContain("How to do testing");
  });

  test("a MISSING skill renders a named placeholder, never an empty section", () => {
    // The important one. An agent told it has a skill it cannot read will
    // either invent the content or stall, and both look like the model
    // misbehaving rather than like a packaging mistake.
    const rendered = renderSkill(bundle(), "nonexistent");
    expect(rendered).toContain("nonexistent");
    expect(rendered).toContain("MISSING");
  });
});

describe("buildInstructions", () => {
  test("carries the department's standing purpose", () => {
    expect(buildInstructions(department, worker, { name: "j1", task: "do the thing" }, 0, bundle()))
      .toContain("keep the parser correct");
  });

  test("an empty purpose tells the agent to ask rather than guess", () => {
    const noPurpose: Department = { name: "engineering", purpose: "", workers: [] };
    const text = buildInstructions(noPurpose, worker, { name: "j1", task: "t" }, 0, bundle());
    expect(text).toContain("ask the CEO");
  });

  test("names the branch and the worktree", () => {
    const text = buildInstructions(department, worker, { name: "j1", task: "t" }, 0, bundle());
    expect(text).toContain("cod/j1");
  });

  test("embeds the body of every skill the worker needs", () => {
    const text = buildInstructions(department, worker, { name: "j1", task: "t" }, 0, bundle());
    expect(text).toContain("How to do testing");
    expect(text).toContain("How to do git-discipline");
  });

  test("says so plainly when a worker has no skills", () => {
    const plain: Worker = { ...worker, skills: [] };
    expect(buildInstructions(department, plain, { name: "j1", task: "t" }, 0, bundle()))
      .toContain("none assigned");
  });

  test("GLOBAL work is told to stop and report, not to act", () => {
    // This is the boundary. An agent that has tools and global work has to be
    // stopped by instruction, because nothing stops it at runtime yet.
    const text = buildInstructions(department, worker, { name: "j1", task: "t" }, 2, bundle());
    expect(text).toContain("Do not act on it");
    expect(text).toContain("global");
  });

  test("SELF-CONTAINED work is told to stay in its worktree, not to stop", () => {
    const text = buildInstructions(department, worker, { name: "j1", task: "t" }, 0, bundle());
    expect(text).toContain("Stay inside this worktree");
    expect(text).not.toContain("Do not act on it");
  });

  test("no agent is ever told it may push or merge", () => {
    for (const radius of [0, 1, 2]) {
      const text = buildInstructions(department, worker, { name: "j1", task: "t" }, radius, bundle());
      expect(text).toContain("no authority to land anything");
    }
  });

  test("states the job it was actually given", () => {
    expect(buildInstructions(department, worker, { name: "j1", task: "count the files" }, 0, bundle()))
      .toContain("count the files");
  });
});

describe("writeInstructions", () => {
  test("writes AGENTS.md into the worktree and returns the path", () => {
    const path = writeInstructions(join(tmpdir(), "cod-write-probe"), "hello");
    expect(path.endsWith("AGENTS.md")).toBe(true);
    expect(require("node:fs").readFileSync(path, "utf8")).toBe("hello");
    rmSync(join(tmpdir(), "cod-write-probe"), { recursive: true, force: true });
  });

  test("creates the worktree directory if it is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cod-wt-"));
    rmSync(dir, { recursive: true, force: true });
    expect(() => writeInstructions(dir, "x")).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("SKILLS_DIR", () => {
  test("points inside the repository, not at the container", () => {
    // A relative path, so the bundle is found from wherever cod is run. An
    // absolute path here would be a host path baked into the source.
    expect(SKILLS_DIR.startsWith("skills/")).toBe(true);
  });
});
