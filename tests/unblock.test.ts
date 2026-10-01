import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWork, propose, blockedWork, latestReview, recordReview, clearReview } from "../src/work";

/**
 * `cod work unblock` must not destroy the verdict it was called to act on.
 *
 * The review table exists because "a verdict nobody recorded is a verdict
 * nobody keeps" - and clearReview used to DELETE the row. That made an
 * unblocked item indistinguishable from a brand new one: after
 * `cod work unblock <id>` there was no way left to answer "was this ever
 * rejected?", which is the one question an audit trail exists for.
 *
 * Clearing now ARCHIVES: the row survives as `cleared`, carrying the rejection
 * it was cleared from.
 */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-unblock-"));
  dirs.push(dir);
  return dir;
}

function seed(outcome: "rejected" | "landed" | "changes-requested" | "cleared" = "rejected") {
  const dir = scratch();
  const handle = openWork(dir);
  const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "a", goal: "a" });
  if (!made.ok || made.item === undefined) throw new Error("seed");
  recordReview(handle, { workId: made.item.id, outcome, reason: "no test was added", branch: `cod/${made.item.id}`, landedSha: outcome === "landed" ? "abc123" : "" });
  return { dir, handle, id: made.item.id };
}

describe("clearing a rejection", () => {
  test("a rejected item leaves the queue", () => {
    const { handle, id } = seed();
    expect(blockedWork(handle)).toHaveLength(1);
    expect(clearReview(handle, id, "operator: the test exists now").ok).toBe(true);
    expect(blockedWork(handle)).toHaveLength(0);
    handle.close();
  });

  test("THE VERDICT IS KEPT - you can still ask whether it was ever rejected", () => {
    // The defect: DELETE made this unanswerable.
    const { handle, id } = seed();
    clearReview(handle, id, "operator: the test exists now");
    const row = latestReview(handle, id);
    expect(row).not.toBeNull();
    expect(row?.outcome).toBe("cleared");
    expect(row?.reason).toContain("no test was added");
    expect(row?.reason).toContain("cleared by operator");
    handle.close();
  });

  test("the review's own outcome is recorded in the archive, not inferred", () => {
    const { handle, id } = seed();
    clearReview(handle, id, "operator looks again");
    expect(latestReview(handle, id)?.reason).toContain("was rejected");
    handle.close();
  });

  test("clearing writes the operator's reason onto the item", () => {
    const { handle, id } = seed();
    clearReview(handle, id, "the test exists now");
    const row = handle.db.query("SELECT reason FROM work WHERE id = ?").get(id) as { reason: string };
    handle.close();
    expect(row.reason).toContain("cleared by operator");
    expect(row.reason).toContain("the test exists now");
  });

  test("an item never reviewed cannot be cleared, and says so", () => {
    const dir = scratch();
    const handle = openWork(dir);
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "a", goal: "a" });
    if (!made.ok || made.item === undefined) throw new Error("seed");
    const result = clearReview(handle, made.item.id, "just in case");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no review");
    handle.close();
  });

  test("a LANDED item is refused - that work is already in master", () => {
    const { handle, id } = seed("landed");
    const result = clearReview(handle, id, "let me have another go");
    expect(result.ok).toBe(false);
    expect((result.reason ?? "").toLowerCase()).toContain("landed");
    // AND the verdict survives the refusal.
    expect(latestReview(handle, id)?.outcome).toBe("landed");
    handle.close();
  });

  test("clearing TWICE is refused the second time, and history accumulates", () => {
    // The second unblock must not silently discard the first one.
    const { handle, id } = seed();
    expect(clearReview(handle, id, "first look").ok).toBe(true);
    const second = clearReview(handle, id, "second look");
    expect(second.ok).toBe(false);
    const row = latestReview(handle, id);
    expect(row?.reason).toContain("first look");
    expect(row?.reason).not.toContain("second look");
    handle.close();
  });

  test("an unknown id is a named failure", () => {
    const dir = scratch();
    const handle = openWork(dir);
    expect(clearReview(handle, "w-nope", "x").ok).toBe(false);
    handle.close();
  });
});

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
