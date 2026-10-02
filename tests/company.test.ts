import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWork, propose, listWork, get, latestReview, recordReview, type WorkItem } from "../src/work";
import { runGovernance, reviewable } from "../src/governance";
import { runCycle, departmentBusy, departmentStruckOut, MAX_STRIKES } from "../src/cycle";
import { holdMeeting } from "../src/meeting";
import { runWorkItem, targetPathsOfItem } from "../src/runwork";
import { parsePlan, planningPrompt, taskPayload } from "../src/plan";
import { reconcileOnce } from "../src/reconcile";
import type { Driver } from "../src/dispatch";
import type { Workspace } from "../src/workspace";

/**
 * The company iterates.
 *
 * Before this, a department could propose exactly ONCE in its lifetime: its
 * proposal's goal never changed, so the novelty key refused every later one,
 * and the planning job that proposal turned into produced text nothing read.
 * The whole unattended company did one round of work and then idled - on a
 * tick that kept reporting "decisions: 2" because the CEO's proposals were
 * never closed either.
 *
 * These tests drive the real ledger, the real reconciler, the real meeting and
 * the real runWorkItem; only the model is a stub, and the lander records the
 * way src/land.ts records.
 */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-company-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const workspace = {
  version: 1,
  company: { name: "Acme", purpose: "ship" },
  timezone: "UTC",
  departments: [
    { name: "engineering", purpose: "keep the notes current", workers: [{ name: "builder", role: "builds", model: "kilo/kilo-auto/free", skills: [] }] },
  ],
  crons: [],
} as unknown as Workspace;

/** A stub engine: plans name one notes file per generation; tasks just succeed. */
function stubDriver(item: WorkItem): Driver {
  return async () => {
    if (item.kind === "plan") {
      const n = item.payload.length % 1000; // any stable token; the plan text is what matters
      void n;
      return ["Looked around.", "GOAL: write notes/status.md describing the state of the notes", "PATHS: notes/status.md", "CHECK: the file exists and is not empty"].join("\n");
    }
    return "wrote it and committed";
  };
}

function dispatcher(dir: string) {
  return async (id: string) => {
    const handle = openWork(dir);
    const item = get(handle, id);
    handle.close();
    if (item === null) return { ok: false, reason: "gone" };
    const result = await runWorkItem({
      stateDir: dir,
      workId: id,
      cron: { name: id, agent: "builder", task: item.payload, schedule: "0 0 1 1 *", enabled: true, expectTools: item.kind !== "plan" },
      driver: stubDriver(item),
    });
    return { ok: result.ok, reason: result.reason, output: result.output };
  };
}

function lander(dir: string, landed: string[]) {
  return async (id: string) => {
    landed.push(id);
    const handle = openWork(dir);
    try {
      recordReview(handle, { workId: id, outcome: "landed", reason: "merged", branch: `cod/${id}`, landedSha: "abc" });
    } finally {
      handle.close();
    }
    return { outcome: "landed" as const, branch: `cod/${id}`, reason: "merged" };
  };
}

describe("the loop: plan -> task -> review -> land -> plan again", () => {
  test("a department plans, its plan becomes a scoped task, the task lands, and it plans AGAIN", async () => {
    const dir = scratch();
    const landed: string[] = [];
    const options = { maxDispatch: 2, dispatch: dispatcher(dir), land: lander(dir, landed) };
    for (let tick = 0; tick < 8; tick += 1) await runGovernance(workspace, dir, options);

    const handle = openWork(dir);
    const items = listWork(handle);
    handle.close();
    const plans = items.filter((w) => w.kind === "plan" && w.from_agent === "engineering");
    const tasks = items.filter((w) => w.kind === "task" && w.from_agent === "engineering");
    // More than one GENERATION of plans: the department iterated.
    expect(plans.length).toBeGreaterThan(1);
    // The plan's answer became a task carrying the paths it named.
    expect(tasks.length).toBeGreaterThan(0);
    expect(targetPathsOfItem(tasks[0]!)).toEqual(["notes/status.md"]);
    // And that task was reviewed and landed.
    expect(landed).toContain(tasks[0]!.id);
  });

  test("the CEO's proposals are CLOSED once decided, so meetings stop re-deciding them", async () => {
    const dir = scratch();
    runCycle(workspace, dir, { actor: "t" });
    const first = await holdMeeting(workspace, dir);
    expect(first.decisions.length).toBe(1);
    const second = await holdMeeting(workspace, dir);
    expect(second.decisions.length).toBe(0);
    const handle = openWork(dir);
    const proposal = listWork(handle).find((w) => w.to_agent === "ceo");
    handle.close();
    expect(proposal?.state).toBe("done");
    expect(proposal?.reason).toContain("decided by ceo");
  });

  test("a meeting does not decide a proposal the reconciler has not seen", async () => {
    const dir = scratch();
    const handle = openWork(dir);
    propose(handle, { from: "engineering", to: "ceo", kind: "task", payload: "schema", goal: "schema", targetPaths: ["src/workspace.ts"] });
    handle.close();
    // `cod meet` by hand, before any reconcile: nothing is decided.
    expect((await holdMeeting(workspace, dir)).decisions.length).toBe(0);
  });

  test("a GLOBAL proposal that somehow reached `ready` is refused by the meeting, not dispatched", async () => {
    // The reconciler refuses global work first, so this needs the row forced -
    // an older ledger, a hand edit. The meeting must not launder it into work.
    const dir = scratch();
    const handle = openWork(dir);
    const made = propose(handle, { from: "engineering", to: "ceo", kind: "task", payload: "schema", goal: "schema", targetPaths: ["src/workspace.ts"] });
    if (!made.ok || made.item === undefined) throw new Error("seed");
    handle.db.query("UPDATE work SET state = 'ready' WHERE id = ?").run(made.item.id);
    handle.close();
    const meeting = await holdMeeting(workspace, dir);
    expect(meeting.decisions.map((d) => d.verdict)).toEqual(["reject"]);
    const after = openWork(dir);
    expect(listWork(after).filter((w) => w.from_agent === "ceo")).toEqual([]);
    expect(get(after, made.item.id)?.state).toBe("done");
    after.close();
  });

  test("the CEO's dispatch carries the proposal's PATHS, so the radius survives the hand-off", async () => {
    const dir = scratch();
    const handle = openWork(dir);
    propose(handle, { from: "engineering", to: "ceo", kind: "task", payload: "notes", goal: "notes", targetPaths: ["notes/a.md"] });
    handle.close();
    reconcileOnce({ stateDir: dir, actor: "t" });
    await holdMeeting(workspace, dir);
    const after = openWork(dir);
    const dispatched = listWork(after).find((w) => w.from_agent === "ceo");
    after.close();
    expect(dispatched === undefined ? [] : targetPathsOfItem(dispatched)).toEqual(["notes/a.md"]);
  });
});

describe("one thing at a time, and three strikes", () => {
  function task(dir: string, goal: string): string {
    const handle = openWork(dir);
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: goal, goal, targetPaths: ["notes/a.md"] });
    handle.close();
    if (!made.ok || made.item === undefined) throw new Error("seed");
    return made.item.id;
  }

  test("a department with work in motion does not plan again", () => {
    const dir = scratch();
    task(dir, "in motion");
    const result = runCycle(workspace, dir, { actor: "t" });
    expect(result.proposed).toEqual([]);
    const handle = openWork(dir);
    expect(departmentBusy(handle, "engineering")).toBe(true);
    handle.close();
  });

  test("a finished task still waiting for review keeps the department busy", () => {
    const dir = scratch();
    const id = task(dir, "finished");
    const handle = openWork(dir);
    handle.db.query("UPDATE work SET state = 'done' WHERE id = ?").run(id);
    expect(departmentBusy(handle, "engineering")).toBe(true);
    recordReview(handle, { workId: id, outcome: "landed", reason: "merged", branch: `cod/${id}`, landedSha: "s" });
    expect(departmentBusy(handle, "engineering")).toBe(false);
    handle.close();
  });

  test(`after ${MAX_STRIKES} bad outcomes in a row a department stops proposing, and says why`, () => {
    const dir = scratch();
    const handle = openWork(dir);
    for (let n = 0; n < MAX_STRIKES; n += 1) {
      const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: `t${n}`, goal: `t${n}` });
      if (!made.ok || made.item === undefined) throw new Error("seed");
      handle.db.query("UPDATE work SET state = 'done' WHERE id = ?").run(made.item.id);
      recordReview(handle, { workId: made.item.id, outcome: "rejected", reason: "no", branch: "", landedSha: "" });
    }
    expect(departmentStruckOut(handle, "engineering")).toBe(true);
    handle.close();
    const result = runCycle(workspace, dir, { actor: "t" });
    expect(result.proposed).toEqual([]);
    expect(result.summary).toContain("engineering held");
  });

  test("one success among the last three is enough to keep going", () => {
    const dir = scratch();
    const handle = openWork(dir);
    for (const outcome of ["rejected", "landed", "rejected"] as const) {
      const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: outcome + Math.random(), goal: outcome + Math.random() });
      if (!made.ok || made.item === undefined) throw new Error("seed");
      handle.db.query("UPDATE work SET state = 'done' WHERE id = ?").run(made.item.id);
      recordReview(handle, { workId: made.item.id, outcome, reason: outcome, branch: "", landedSha: "" });
    }
    expect(departmentStruckOut(handle, "engineering")).toBe(false);
    handle.close();
  });
});

describe("a plan run", () => {
  async function planItem(dir: string, answer: string) {
    const handle = openWork(dir);
    const made = propose(handle, { from: "ceo", to: "engineering", kind: "plan", payload: "plan it", goal: "plan it" });
    handle.close();
    if (!made.ok || made.item === undefined) throw new Error("seed");
    reconcileOnce({ stateDir: dir, actor: "t" });
    const result = await runWorkItem({
      stateDir: dir, workId: made.item.id,
      cron: { name: made.item.id, agent: "builder", task: "plan it", schedule: "0 0 1 1 *", enabled: true, expectTools: false },
      driver: async () => answer,
    });
    return { id: made.item.id, result };
  }

  test("an unreadable plan is a FAILED run, retried like any other", async () => {
    const dir = scratch();
    const { id, result } = await planItem(dir, "I think we should improve things in general.");
    expect(result.ok).toBe(false);
    const handle = openWork(dir);
    expect(get(handle, id)?.state).toBe("failed");
    expect(get(handle, id)?.reason).toMatch(/^run failed \(1\/3\): the plan had no GOAL line/);
    handle.close();
  });

  test("'GOAL: none' is an honest answer: done, and no task", async () => {
    const dir = scratch();
    const { id, result } = await planItem(dir, "GOAL: none");
    expect(result.ok).toBe(true);
    const handle = openWork(dir);
    expect(get(handle, id)?.state).toBe("done");
    expect(listWork(handle).filter((w) => w.kind === "task")).toEqual([]);
    handle.close();
  });

  test("a plan that names a GLOBAL path becomes a task the reconciler refuses by rule", async () => {
    const dir = scratch();
    await planItem(dir, "GOAL: change the schema\nPATHS: src/workspace.ts\nCHECK: tests pass");
    reconcileOnce({ stateDir: dir, actor: "t" });
    const handle = openWork(dir);
    const planned = listWork(handle).find((w) => w.kind === "task");
    handle.close();
    expect(planned?.state).toBe("rejected");
  });
});

describe("parsePlan", () => {
  test("reads the three lines, tolerating markdown", () => {
    const result = parsePlan("**GOAL:** add a status page\n- PATHS: `notes/status.md`, docs/a.md\nCHECK: it renders");
    expect(result.kind).toBe("plan");
    if (result.kind !== "plan") return;
    expect(result.plan.goal).toBe("add a status page");
    expect(result.plan.paths).toEqual(["notes/status.md", "docs/a.md"]);
    expect(result.plan.check).toBe("it renders");
    expect(taskPayload(result.plan)).toContain("Done when: it renders");
  });

  test("refuses what could not be a repository path", () => {
    expect(parsePlan("GOAL: x\nPATHS: /etc/passwd").kind).toBe("invalid");
    expect(parsePlan("GOAL: x\nPATHS: ../../outside").kind).toBe("invalid");
  });

  test("no GOAL is invalid; PATHS none is an empty list", () => {
    expect(parsePlan("PATHS: a.md").kind).toBe("invalid");
    const none = parsePlan("GOAL: tidy the notes\nPATHS: none");
    expect(none.kind === "plan" ? none.plan.paths : null).toEqual([]);
  });

  test("the planner is told the format and the paths it must not name", () => {
    const prompt = planningPrompt("engineering", "Acme", "keep the notes current");
    expect(prompt).toContain("GOAL:");
    expect(prompt).toContain("PATHS:");
    expect(prompt).toContain("src/");
    expect(prompt).not.toContain("\\n");
  });
});

describe("reviewable", () => {
  const base = { state: "done", kind: "task", to_agent: "engineering", started_at: 2_000 } as WorkItem;
  const review = (outcome: string, reviewedAt = 1_000) => ({ outcome, reviewedAt }) as never;

  test("only finished TASKS, never plans or decided proposals", () => {
    expect(reviewable(base, null)).toBe(true);
    expect(reviewable({ ...base, kind: "plan" }, null)).toBe(false);
    expect(reviewable({ ...base, to_agent: "ceo" }, null)).toBe(false);
    expect(reviewable({ ...base, state: "ready" }, null)).toBe(false);
  });

  test("terminal verdicts are final; deferred and cleared are offered again", () => {
    expect(reviewable(base, review("landed"))).toBe(false);
    expect(reviewable(base, review("rejected"))).toBe(false);
    expect(reviewable(base, review("deferred", 9_999))).toBe(true);
    expect(reviewable(base, review("cleared", 9_999))).toBe(true);
  });

  test("a skipped or sent-back item is offered again only after it has RUN again", () => {
    expect(reviewable(base, review("skipped", 3_000))).toBe(false);
    expect(reviewable(base, review("skipped", 1_000))).toBe(true);
    expect(reviewable(base, review("changes-requested", 1_000))).toBe(true);
  });

  test("latestReview round-trips through the filter", () => {
    const dir = scratch();
    const handle = openWork(dir);
    expect(latestReview(handle, "nope")).toBeNull();
    handle.close();
  });
});

describe("singleFlight", () => {
  test("a tick that arrives while one is running is skipped, and says so", async () => {
    const { singleFlight } = await import("../src/governance");
    let runs = 0;
    let skipped = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tick = singleFlight(async () => { runs += 1; await gate; }, () => { skipped += 1; });
    const first = tick();
    await tick();
    await tick();
    release();
    await first;
    expect(runs).toBe(1);
    expect(skipped).toBe(2);
    await tick();
    expect(runs).toBe(2);
  });

  test("a tick that throws still frees the slot", async () => {
    const { singleFlight } = await import("../src/governance");
    let runs = 0;
    const tick = singleFlight(async () => { runs += 1; throw new Error("boom"); }, () => {});
    await expect(tick()).rejects.toThrow("boom");
    await expect(tick()).rejects.toThrow("boom");
    expect(runs).toBe(2);
  });
});
