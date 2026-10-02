import { describe, expect, test } from "bun:test";
import { briefFor } from "../src/runwork";
import type { WorkItem } from "../src/work";

/**
 * The brief is what the agent is actually told.
 *
 * `textOfItem` reads the payload alone, so a retried item received the exact
 * same prompt as its first attempt and had no way to know what the reviewer had
 * objected to. The retry existed; the fix demand did not.
 *
 * Premise, checked before this file was written:
 *   grep -c 'item.reason' src/runwork.ts src/supervisor.ts src/run-work-cli.ts
 *   -> 0 / 0 / 0
 */

function item(reason: string | null): WorkItem {
  return {
    id: "w-test-0001",
    from_agent: "engineering",
    to_agent: "builder",
    kind: "task",
    payload: JSON.stringify({ text: "Write notes/today.md", targetPaths: ["notes/today.md"] }),
    state: "ready",
    reason,
    blast_radius: 0,
    lease_owner: null,
    lease_epoch: 1,
    attempts: 1,
    novelty_key: "k",
    created_seq: 1,
    started_at: null,
  } as unknown as WorkItem;
}

describe("the brief an agent is given", () => {
  const changes = (reason: string) => ({ outcome: "changes-requested" as const, reason });

  const named = "Write notes/today.md\n\nPaths this task named - keep the change to these: notes/today.md";

  test("with no review history it is the task alone, with the paths it named", () => {
    expect(briefFor(item(null))).toBe(named);
    expect(briefFor(item(null), null)).toBe(named);
  });

  test("the named paths are in the brief, because the reviewer holds the change to them", () => {
    // The reviewer is shown "Paths the task named"; the worker used to be shown
    // only the goal, and so was judged against a list it never saw.
    expect(briefFor(item(null))).toContain("notes/today.md");
    const plain = { ...item(null), payload: "Write anything" } as WorkItem;
    expect(briefFor(plain)).toBe("Write anything");
  });

  test("a plain reason on the item is NOT presented as a review", () => {
    // Guards the label. Telling a model "the reviewer said X" when nobody said
    // X is worse than saying nothing at all.
    expect(briefFor(item("could not reach the model provider"))).toBe(named);
  });

  test("AFTER A REVIEW the objection is IN the brief", () => {
    // THE test. Without it a retry re-runs the identical prompt and the whole
    // retry policy is decoration.
    const brief = briefFor(item("the worker's own output"), changes("review (attempt 1): the interpolated values are all blank"));
    expect(brief).toContain("Write notes/today.md");
    expect(brief).toContain("the interpolated values are all blank");
  });

  test("the objection is labelled, so the agent knows it is feedback", () => {
    expect(briefFor(item(null), changes("review (attempt 1): add a test")).toLowerCase()).toContain("reviewed and returned");
  });

  test("EVERY accumulated objection is present, not just the last", () => {
    // Attempt three that only sees attempt two's objection may fix that one and
    // regress the first, and the reviewer will say so for a fourth time.
    const brief = briefFor(item(null), changes("review (attempt 1): no test" + String.fromCharCode(10) + "review (attempt 2): test does not run"));
    expect(brief).toContain("no test");
    expect(brief).toContain("test does not run");
  });

  test("the task still comes FIRST, so the objective is not buried", () => {
    expect(briefFor(item(null), changes("review (attempt 1): fix it")).startsWith("Write notes/today.md")).toBe(true);
  });

  test("only a LIVE request for changes briefs - not a rejection, a landing, or a cleared verdict", () => {
    // A rejected item is not being retried, and a cleared one was unblocked by
    // a person: neither is a list of things the worker must now fix.
    for (const outcome of ["rejected", "landed", "cleared", "skipped", "deferred"] as const) {
      expect(briefFor(item(null), { outcome, reason: "review (attempt 1): x" })).toBe(named);
    }
  });

  test("a reason that merely starts with 'review' is not mistaken for one", () => {
    // The old guard was a prefix test on work.reason, which the worker's commit
    // overwrites. The objection now comes only from the review row.
    expect(briefFor(item("review the docs first"))).toBe(named);
  });
});
