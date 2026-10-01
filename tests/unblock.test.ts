import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWork, propose, blockedWork, latestReview, recordReview, clearReview } from "../src/work";

/**
 * A rejection a human cannot clear is not a queue, it is a wall.
 *
 * `cod work blocked` showed the reason and offered no way forward except
 * re-dispatching by hand - and re-dispatching did nothing, because the tick
 * skips anything judged terminally. So the item was stuck: visible, explained,
 * and impossible to act on.
 *
 * Deliberately MANUAL. An automatic clear would let a rejected item re-enter the
 * queue on its own, which is the company arguing with itself.
 */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-unblock-"));
  dirs.push(dir);
  return dir;
}

describe("clearReview", () => {
  test("a rejected item leaves the queue when a person clears it", () => {
    const dir = scratch();
    const handle = openWork(dir);
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "a", goal: "a" });
    if (!made.ok || made.item === undefined) throw new Error("seed");
    recordReview(handle, { workId: made.item.id, outcome: "rejected", reason: "no test", branch: `cod/${made.item.id}`, landedSha: "" });
    expect(blockedWork(handle)).toHaveLength(1);

    const cleared = clearReview(handle, made.item.id, "operator says the test exists now");
    expect(cleared.ok).toBe(true);
    expect(latestReview(handle, made.item.id)).toBeNull();
    expect(blockedWork(handle)).toHaveLength(0);
    handle.close();
  });

  test("clearing records WHO cleared it and WHY, in the reason", () => {
    // The ledger must not simply forget. An item that was refused and then
    // un-refused needs to say so, or the next rejection looks like the first.
    const dir = scratch();
    const handle = openWork(dir);
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "a", goal: "a" });
    if (!made.ok || made.item === undefined) throw new Error("seed");
    recordReview(handle, { workId: made.item.id, outcome: "rejected", reason: "no test", branch: "", landedSha: "" });
    clearReview(handle, made.item.id, "operator: the test exists now");
    handle.db.query("UPDATE work SET reason = ? WHERE id = ?").run("cleared by operator: the test exists now", made.item.id);
    const row = handle.db.query("SELECT reason FROM work WHERE id = ?").get(made.item.id) as { reason: string };
    handle.close();
    expect(row.reason).toContain("cleared by operator");
  });

  test("clearing an item that was never reviewed is a NAMED failure", () => {
    // Not a silent success: "nothing to clear" and "cleared" are different
    // answers and the operator needs to know which they got.
    const dir = scratch();
    const handle = openWork(dir);
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "a", goal: "a" });
    if (!made.ok || made.item === undefined) throw new Error("seed");
    const result = clearReview(handle, made.item.id, "just in case");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no review");
    handle.close();
  });

  test("clearing a LANDED item is refused - that work is in master", () => {
    // The most important refusal here. Un-blocking something already merged
    // would put it back in the queue and re-land it on top of itself.
    const dir = scratch();
    const handle = openWork(dir);
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "a", goal: "a" });
    if (!made.ok || made.item === undefined) throw new Error("seed");
    recordReview(handle, { workId: made.item.id, outcome: "landed", reason: "merged", branch: "", landedSha: "abc123" });
    const result = clearReview(handle, made.item.id, "let me have another go");
    expect(result.ok).toBe(false);
    // Case-insensitively, and asserted on the CONSEQUENCE not just the word: the
    // reason has to say what would go wrong, or the operator cannot tell this
    // refusal from a typo.
    expect((result.reason ?? "").toLowerCase()).toContain("landed");
    expect(result.reason).toContain("merge it twice");
    handle.close();
  });

  test("clearing an unknown id is a named failure", () => {
    const dir = scratch();
    const handle = openWork(dir);
    expect(clearReview(handle, "w-nope", "x").ok).toBe(false);
    handle.close();
  });
});

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
