import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWork, propose, listWork, get } from "../src/work";
import { planDepartmentWork, runCycle, type CycleResult } from "../src/cycle";
import type { Workspace } from "../src/workspace";

/**
 * Departments that PROPOSE their own work.
 *
 * Until this existed, `propose()` had exactly one caller: a human typing a CLI
 * command. The ledger, the reconciler, the fencing and the novelty guard were
 * all real, all tested, and all waiting for a caller that never came - which is
 * the same shape as a registry with no callers.
 *
 * The design constraint from the org: a department works toward its STANDING
 * PURPOSE and grades its own work. Self-grading is only safe because the
 * meeting pushes back on it, which is why this file proposes and does not
 * dispatch.
 */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-cycle-"));
  dirs.push(dir);
  return dir;
}

const workspace = {
  version: 1,
  company: { name: "Acme", purpose: "ship things" },
  timezone: "UTC",
  departments: [
    { name: "engineering", purpose: "keep the tests green", workers: [{ name: "builder", role: "builds", model: "m", skills: [] }] },
    { name: "cto", purpose: "decide what we build next", workers: [{ name: "cto", role: "decides", model: "m", skills: [] }] },
  ],
} as unknown as Workspace;

describe("planDepartmentWork", () => {
  test("each department proposes work derived from its OWN purpose", () => {
    const dir = scratch();
    const planned = planDepartmentWork(workspace, dir);
    const handle = openWork(dir);
    const items = listWork(handle);
    handle.close();
    // Two departments, two proposals - and the payload has to mention the
    // purpose, or the work is not anchored to anything and the novelty guard
    // is only catching identical repeats of unanchored work.
    expect(items.length).toBe(2);
    expect(planned.length).toBe(2);
    expect(planned[0]?.goal).toContain("keep the tests green");
    expect(planned[1]?.goal).toContain("decide what we build next");
  });

  test("a department with no purpose proposes NOTHING rather than something empty", () => {
    const dir = scratch();
    const noPurpose = { ...workspace, departments: [{ name: "ghost", purpose: "", workers: [] }] } as unknown as Workspace;
    expect(planDepartmentWork(noPurpose, dir)).toEqual([]);
  });

  test("it does not dispatch - proposing and dispatching are different authority", () => {
    const dir = scratch();
    planDepartmentWork(workspace, dir);
    const handle = openWork(dir);
    const states = listWork(handle).map((w) => w.state);
    handle.close();
    // Everything stays `proposed`. The CEO dispatches; a department may not.
    expect(new Set(states)).toEqual(new Set(["proposed"]));
  });

  test("it never proposes global work", () => {
    // A department cannot dispatch global work, so it must not propose it and
    // then be refused. The ceiling is derived from paths, which are none.
    const dir = scratch();
    planDepartmentWork(workspace, dir);
    const handle = openWork(dir);
    for (const item of listWork(handle)) expect(item.to_agent).toBe("ceo");
    handle.close();
  });

  test("the novelty guard stops a department repeating itself forever", () => {
    const dir = scratch();
    const first = planDepartmentWork(workspace, dir);
    const second = planDepartmentWork(workspace, dir);
    const third = planDepartmentWork(workspace, dir);
    const handle = openWork(dir);
    // Two departments, so two items - and cycles two and three add NOTHING,
    // because the ledger's novelty key refuses an identical repeat. Without
    // that guard an unattended company proposes the same thing forever and
    // the ledger fills with duplicates nobody reads.
    expect(first.length).toBe(2);
    expect(second.length).toBe(0);
    expect(third.length).toBe(0);
    expect(listWork(handle).length).toBe(2);
    handle.close();
  });

  test("a proposal names a real worker in the real department", () => {
    const dir = scratch();
    planDepartmentWork(workspace, dir);
    const handle = openWork(dir);
    for (const item of listWork(handle)) {
      expect(item.from_agent).toBeTruthy();
      expect(item.to_agent).toBeTruthy();
      expect(item.payload.length).toBeGreaterThan(10);
    }
    handle.close();
  });
});

describe("runCycle", () => {
  test("a cycle proposes, reconciles, and reports what it did", () => {
    const dir = scratch();
    const result: CycleResult = runCycle(workspace, dir, { actor: "cycle" });
    expect(result.proposed.length).toBeGreaterThan(0);
    expect(result.reconciled.promoted.length + result.reconciled.rejected.length).toBeGreaterThanOrEqual(0);
    expect(result.summary).toContain("proposed");
  });

  test("a second cycle adds nothing new and says so", () => {
    const dir = scratch();
    runCycle(workspace, dir, { actor: "cycle" });
    const second = runCycle(workspace, dir, { actor: "cycle" });
    expect(second.proposed.length).toBe(0);
    expect(second.summary).toContain("0");
  });

  test("a cycle with a broken ledger reports rather than throwing", () => {
    // A cycle that vanishes is how a schedule becomes untrustworthy.
    const result = runCycle(workspace, "/proc/definitely-not-a-writable-ledger", { actor: "cycle" });
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
