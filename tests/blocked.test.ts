import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWork, propose, blockedWork, recordReview } from "../src/work";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-blocked-"));
  dirs.push(dir);
  return dir;
}

describe("blockedWork", () => {
  test("only REJECTED work is blocked", () => {
    // A landed item is done. A skipped one never ran. Neither is waiting on a
    // person, and listing them would bury the ones that are.
    const dir = scratch();
    const handle = openWork(dir);
    const rejected = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "a", goal: "a" });
    const landed = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "b", goal: "b" });
    if (!rejected.ok || rejected.item === undefined) throw new Error("seed");
    if (!landed.ok || landed.item === undefined) throw new Error("seed");
    recordReview(handle, { workId: rejected.item.id, outcome: "rejected", reason: "no test", branch: `cod/${rejected.item.id}`, landedSha: "" });
    recordReview(handle, { workId: landed.item.id, outcome: "landed", reason: "merged", branch: `cod/${landed.item.id}`, landedSha: "abc123" });
    const blocked = blockedWork(handle);
    handle.close();
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.item.id).toBe(rejected.item.id);
    expect(blocked[0]?.review.reason).toContain("no test");
  });

  test("work never reviewed is not blocked", () => {
    const dir = scratch();
    const handle = openWork(dir);
    propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "a", goal: "a" });
    expect(blockedWork(handle)).toEqual([]);
    handle.close();
  });

  test("the OLDEST rejection comes first - it has waited longest", () => {
    const dir = scratch();
    const handle = openWork(dir);
    for (const goal of ["first", "second"]) {
      const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: goal, goal });
      if (!made.ok || made.item === undefined) continue;
      recordReview(handle, { workId: made.item.id, outcome: "rejected", reason: goal, branch: "", landedSha: "", reviewedAt: goal === "first" ? 1000 : 2000 });
    }
    const blocked = blockedWork(handle);
    handle.close();
    expect(blocked[0]?.review.reason).toBe("first");
  });

  test("a re-review that succeeds CLEARS it - the queue is not a graveyard", () => {
    const dir = scratch();
    const handle = openWork(dir);
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "a", goal: "a" });
    if (!made.ok || made.item === undefined) throw new Error("seed");
    recordReview(handle, { workId: made.item.id, outcome: "rejected", reason: "no test", branch: "", landedSha: "" });
    expect(blockedWork(handle)).toHaveLength(1);
    recordReview(handle, { workId: made.item.id, outcome: "landed", reason: "merged", branch: "", landedSha: "s" });
    expect(blockedWork(handle)).toHaveLength(0);
    handle.close();
  });
});

// In afterAll, not at module top level: top-level code runs while bun is
// COLLECTING the tests, before any directory exists, and so deleted nothing.
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
