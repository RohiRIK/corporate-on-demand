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
  test("with no review history it is the task alone", () => {
    expect(briefFor(item(null))).toBe("Write notes/today.md");
  });

  test("a plain reason is NOT presented as a review", () => {
    // Guards the label. Telling a model "the reviewer said X" when nobody said
    // X is worse than saying nothing at all.
    expect(briefFor(item("could not reach the model provider"))).toBe("Write notes/today.md");
  });

  test("AFTER A REVIEW the objection is IN the brief", () => {
    // THE test. Without it a retry re-runs the identical prompt and the whole
    // retry policy is decoration.
    const brief = briefFor(item("review: the interpolated values are all blank"));
    expect(brief).toContain("Write notes/today.md");
    expect(brief).toContain("the interpolated values are all blank");
  });

  test("the objection is labelled, so the agent knows it is feedback", () => {
    expect(briefFor(item("review: add a test")).toLowerCase()).toContain("review");
  });

  test("EVERY accumulated objection is present, not just the last", () => {
    // Attempt three that only sees attempt two's objection may fix that one and
    // regress the first, and the reviewer will say so for a fourth time.
    const brief = briefFor(item("review (attempt 1): no test" + String.fromCharCode(10) + "review (attempt 2): test does not run"));
    expect(brief).toContain("no test");
    expect(brief).toContain("test does not run");
  });

  test("the task still comes FIRST, so the objective is not buried", () => {
    expect(briefFor(item("review: fix it")).startsWith("Write notes/today.md")).toBe(true);
  });

  test("a reason that merely CONTAINS the word review is not mistaken for one", () => {
    // "review the docs" is a legitimate task note, not a verdict. The guard is a
    // prefix test; this is the sharp edge it creates, asserted so a change to
    // it is deliberate.
    expect(briefFor(item("please review the docs first"))).toBe("Write notes/today.md");
  });
});
