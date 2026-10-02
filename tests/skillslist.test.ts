import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditWorkspaceSkills } from "../src/skills";
import type { Workspace } from "../src/workspace";

/**
 * A skill name that does not resolve used to degrade silently.
 *
 * `resolveSkills` skips names the bundle lacks and notes it in AGENTS.md, so a
 * workspace with `"skills": ["gitt纪律"]` - or a plausible typo like
 * `git-discplines` - produces an agent that runs with NO git rules and no
 * obvious reason why.
 *
 * For a company with no human watching, a silently missing rule is exactly the
 * failure the whole boundary design is there to prevent: the agent looks
 * compliant because nothing told it otherwise.
 */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-skilllist-"));
  dirs.push(dir);
  return dir;
}

const withSkills = (skills: string[]): Workspace => ({
  version: 1,
  company: { name: "Acme", purpose: "ship" },
  timezone: "UTC",
  departments: [{ name: "engineering", purpose: "build", workers: [{ name: "builder", role: "builds", model: "m", skills }] }],
  crons: [],
} as unknown as Workspace);

describe("auditWorkspaceSkills", () => {
  test("every skill the bundle ships is RESOLVABLE", () => {
    const report = auditWorkspaceSkills(withSkills(["git-discipline", "testing", "escalation", "debugging", "reviewing", "wrap-up"]));
    expect(report.unknown).toEqual([]);
    expect(report.known).toHaveLength(6);
  });

  test("a typo is reported by name, not silently skipped", () => {
    const report = auditWorkspaceSkills(withSkills(["git-discipline", "git-discplines"]));
    // Named AND attributed: "unknown skill: x" does not say whose rules are
    // quietly missing, and this company has nobody to ask.
    expect(report.unknown).toHaveLength(1);
    expect(report.unknown[0]).toContain("git-discplines");
    expect(report.unknown[0]).toContain("engineering/builder");
    // The one that resolved is still fine - the typo is an addition, not a
    // replacement, and reporting the good one too would be noise.
    expect(report.known).toEqual(["git-discipline"]);
  });

  test("a worker with NO skills is reported as empty, not as broken", () => {
    const report = auditWorkspaceSkills(withSkills([]));
    expect(report.unknown).toEqual([]);
    expect(report.untouched).toContain("engineering/builder");
  });

  test("every unknown is attributed to the worker that named it", () => {
    const report = auditWorkspaceSkills(withSkills(["not-a-skill"]));
    expect(report.unknown[0]).toContain("engineering/builder");
  });

  test("one unknown across several workers is reported once each", () => {
    const workspace = {
      ...withSkills([]),
      departments: [
        { name: "engineering", purpose: "b", workers: [{ name: "builder", role: "r", model: "m", skills: ["nope"] }] },
        { name: "cto", purpose: "d", workers: [{ name: "cto", role: "r", model: "m", skills: ["nope"] }] },
      ],
    } as unknown as Workspace;
    expect(auditWorkspaceSkills(workspace).unknown).toHaveLength(2);
  });
});

// In afterAll, not at module top level: top-level code runs while bun is
// COLLECTING the tests, before any directory exists, and so deleted nothing.
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
