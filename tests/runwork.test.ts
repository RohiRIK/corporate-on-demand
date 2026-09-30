import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWork, propose, claim, get } from "../src/work";
import { reconcileOnce } from "../src/reconcile";
import { radiusForWork, describeWorkTarget, canSelfDispatch, runWorkItem } from "../src/runwork";
import type { Driver, Step } from "../src/dispatch";
import type { Cron } from "../src/workspace";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-runwork-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const cron: Cron = { name: "author", agent: "builder", task: "write the answer", schedule: "0 3 * * *", enabled: true, expectTools: true };

describe("radiusForWork", () => {
  test("DERIVES the radius from the target paths, never from the proposer", () => {
    // The bug this replaces: `blast_radius` was an integer the PROPOSING AGENT
    // filled in, so the rule constrained the thing it was supposed to constrain.
    // An agent wanting to ship a global change just wrote 0.
    expect(radiusForWork("touch a report", [])).toBe(0);
    expect(radiusForWork("touch a report", ["notes/plan.md"])).toBe(0);
    expect(radiusForWork("change the schema", ["src/workspace.ts"])).toBe(2);
    expect(radiusForWork("change deps", ["package.json"])).toBe(2);
  });

  test("paths give 0 or 2, never 1 - cross-department is NOT derivable", () => {
    // Stated rather than papered over. Radius 1 means "touches another
    // department's area", and knowing that needs to know WHICH department
    // owns the path - which is a fact about the workspace, not about a string.
    // Guessing it from a path would be inventing precision, so the derived
    // value is deliberately coarse: 0 or 2. Radius 1 is expressed by the job
    // itself and can only ever narrow.
    const derived = [radiusForWork("x", ["notes/a.md"]), radiusForWork("x", ["src/a.ts"]), radiusForWork("x", ["docker/Dockerfile.sandbox"])];
    expect([...new Set(derived)].sort()).toEqual([0, 2]);
  });

  test("a proposed radius can only ever NARROW the derived one", () => {
    // Defence in depth: even if a stale or hostile value arrives it cannot
    // WIDEN authority. And it cannot narrow past global either - see the
    // separate test below, which is the one that matters.
    expect(radiusForWork("x", [], 2)).toBe(0);
    expect(radiusForWork("x", ["src/a.ts"], 1)).toBe(2);
    expect(radiusForWork("x", ["src/a.ts"], 5)).toBe(2);
    // Narrowing still works below global: a self-contained job may declare
    // itself radius 1 to be conservative.
    expect(radiusForWork("x", ["notes/a.md"], 1)).toBe(0);
  });

  test("an agent CANNOT declare its way out of a global boundary", () => {
    // The hole this closes. `min(derived, proposed)` let a proposer write 0
    // for work that names src/workspace.ts and be believed, which is precisely
    // "the rule constrains the thing it constrains". Global is a ceiling only
    // the CEO can lift.
    expect(radiusForWork("change the schema", ["src/workspace.ts"], 0)).toBe(2);
    expect(radiusForWork("change the schema", ["src/workspace.ts"], 1)).toBe(2);
    expect(radiusForWork("change the schema", ["package.json"], 0)).toBe(2);
    expect(radiusForWork("self contained", ["notes/a.md"], 2)).toBe(0);
  });

  test("no target paths means self-contained, which is the safe default", () => {
    expect(radiusForWork("do a thing")).toBe(0);
    expect(radiusForWork("do a thing", [])).toBe(0);
  });
});

describe("canSelfDispatch", () => {
  test("a department may not dispatch GLOBAL work to itself", () => {
    expect(canSelfDispatch(2)).toBe(false);
  });

  test("self-contained and cross-department work may proceed", () => {
    expect(canSelfDispatch(0)).toBe(true);
    expect(canSelfDispatch(1)).toBe(true);
  });
});

describe("describeWorkTarget", () => {
  test("names the files, because a refusal has to be actionable", () => {
    expect(describeWorkTarget(["src/a.ts", "src/b.ts"])).toContain("src/a.ts");
  });

  test("says plainly when nothing was named", () => {
    expect(describeWorkTarget([])).toContain("no target paths");
  });
});

describe("runWorkItem", () => {
  function seeded(goal = "write the answer") {
    const dir = scratch();
    const handle = openWork(dir);
    const made = propose(handle, {
      from: "engineering", to: "engineering", kind: "task",
      payload: goal, goal, targetPaths: ["answer.txt"],
    });
    handle.close();
    if (!made.ok || made.item === undefined) throw new Error(`seed failed: ${made.reason ?? "?"}`);
    return { dir, id: made.item.id };
  }

  const okDriver: Driver = async (_c, step): Promise<string> => {
    await step("act", "did the work");
    return "wrote the answer";
  };

  test("runs the item and commits it DONE with the epoch it was given", async () => {
    const { dir, id } = seeded();
    reconcileOnce({ stateDir: dir, actor: "test" });
    const steps: Step[] = [];
    const result = await runWorkItem({ stateDir: dir, workId: id, cron, driver: okDriver, onStep: (s) => void steps.push(s) });
    expect(result.ok).toBe(true);
    const handle = openWork(dir);
    expect(get(handle, id)?.state).toBe("done");
    expect(get(handle, id)?.reason).toContain("wrote the answer");
    handle.close();
    expect(steps.length).toBeGreaterThan(0);
  });

  test("GLOBAL work is REFUSED before the agent runs, and says why", async () => {
    // Refused BEFORE acting, not caught afterwards. The commit is never made
    // and the ledger keeps the reason, so the work is visible rather than lost.
    const dir = scratch();
    const handle = openWork(dir);
    const made = propose(handle, {
      from: "engineering", to: "engineering", kind: "task",
      payload: "change the schema", goal: "schema", targetPaths: ["src/workspace.ts"],
    });
    handle.close();
    if (!made.ok || made.item === undefined) throw new Error("seed failed");
    let ran = false;
    const spy: Driver = async () => { ran = true; return "should not happen"; };
    const result = await runWorkItem({ stateDir: dir, workId: made.item.id, cron, driver: spy });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("global");
    expect(ran).toBe(false);
  });

  test("a driver that throws records FAILED rather than losing the item", async () => {
    const { dir, id } = seeded();
    reconcileOnce({ stateDir: dir, actor: "test" });
    const boom: Driver = async () => { throw new Error("model refused"); };
    const result = await runWorkItem({ stateDir: dir, workId: id, cron, driver: boom });
    expect(result.ok).toBe(false);
    const handle = openWork(dir);
    expect(get(handle, id)?.state).toBe("failed");
    expect(get(handle, id)?.reason).toContain("model refused");
    handle.close();
  });

  test("an unknown id is reported, not thrown", async () => {
    const dir = scratch();
    const result = await runWorkItem({ stateDir: dir, workId: "nope", cron, driver: okDriver });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no such work item");
  });

  test("a FENCED commit is refused: a stale run cannot overwrite a newer one", async () => {
    // The whole point of lease_epoch. A job reclaimed and re-run must not be
    // able to land its stale result over the live one.
    const { dir, id } = seeded();
    reconcileOnce({ stateDir: dir, actor: "test" });
    const handle = openWork(dir);
    const claimed = claim(handle, "first");
    if (claimed === null) throw new Error("nothing claimed");
    handle.db.query("UPDATE work SET state = 'ready', lease_owner = NULL WHERE id = ?").run(id);
    const live = claim(handle, "second");
    if (live === null) throw new Error("re-claim failed");
    // The zombie finishes with its OLD epoch.
    const result = await runWorkItem({
      stateDir: dir, workId: id, cron, driver: okDriver, leaseEpoch: claimed.lease_epoch,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("stale");
    expect(get(handle, id)?.state).toBe("running");
    handle.close();
  });
});
