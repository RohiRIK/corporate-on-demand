import { describe, expect, test } from "bun:test";
import { resolveTarget } from "../src/assign";

/**
 * Work is addressed to a DEPARTMENT; a WORKER is what runs.
 *
 * The bug this covers is silent and total. `work run` looked for a worker whose
 * name equalled the item's addressee, but the item is addressed to
 * "engineering" and the worker is called "builder" - so the lookup found
 * nothing, `writeInstructions` was skipped, and a real model went to work in
 * the work volume with NO operating rules at all. It still completed the task,
 * which is exactly why it survived: the job succeeded and the prompt was
 * missing.
 */

const workspace = {
  company: "Acme",
  purpose: "test",
  timezone: "UTC",
  departments: [
    { name: "engineering", purpose: "build", workers: [
      { name: "builder", purpose: "writes code", model: "m", skills: ["git-discipline"] },
      { name: "auditor", purpose: "checks", model: "m", skills: [] },
    ] },
    { name: "cto", purpose: "decide", workers: [
      { name: "cto", purpose: "decide", model: "m", skills: [] },
    ] },
  ],
} as never;

describe("resolveTarget", () => {
  test("an item addressed to a DEPARTMENT resolves to that department's worker", () => {
    // The case that was broken. Nothing was thrown and nothing was logged; the
    // agent simply had no instructions.
    const t = resolveTarget(workspace, "engineering");
    expect(t.department?.name).toBe("engineering");
    expect(t.worker?.name).toBe("builder");
    expect(t.addressedToDepartment).toBe(true);
  });

  test("an item addressed to a WORKER resolves to that worker directly", () => {
    const t = resolveTarget(workspace, "auditor");
    expect(t.worker?.name).toBe("auditor");
    expect(t.department?.name).toBe("engineering");
    expect(t.addressedToDepartment).toBe(false);
  });

  test("a worker name wins over a same-named department", () => {
    // CTO is both a department and its only worker. Either reading runs the
    // same agent, so the worker is preferred and the ambiguity is not silent.
    const t = resolveTarget(workspace, "cto");
    expect(t.worker?.name).toBe("cto");
    expect(t.addressedToDepartment).toBe(false);
  });

  test("an UNKNOWN addressee is a named failure, not a silent one", () => {
    // Never resolve to nothing. An unresolved addressee previously meant "run
    // the agent anyway with no rules", which is the worst possible default.
    const t = resolveTarget(workspace, "marketing");
    expect(t.worker).toBeUndefined();
    expect(t.reason).toContain("marketing");
    expect(t.reason).toContain("no worker or department");
  });

  test("says WHY a worker was chosen when the item named a department", () => {
    // The department self-organises, so its choice is recorded rather than
    // implied - an autonomous system you cannot audit is not autonomous, it is
    // unauditable.
    const t = resolveTarget(workspace, "engineering");
    expect(t.note).toContain("engineering");
    expect(t.note).toContain("builder");
  });

  test("an explicit worker gets no hand-off note", () => {
    expect(resolveTarget(workspace, "auditor").note).toBeUndefined();
  });
});
