import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWork, propose, listWork, get, latestReview, recordReview, type WorkItem } from "../src/work";
import { runGovernance, reviewable } from "../src/governance";
import { runCycle, departmentBusy, departmentStruckOut, departmentRestUntil, isIdlePlan, MAX_STRIKES, MAX_REST_MINUTES, DEFAULT_CYCLE_MINUTES } from "../src/cycle";
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

/**
 * A stub engine: each plan names a NEW notes file - the n-th plan that runs
 * names notes/status-n.md - and tasks just succeed. A planner that names the
 * same file every time would be proposing work that already exists, which is
 * a different property (the department rests; see below).
 */
let plansRun = 0;
function stubDriver(item: WorkItem): Driver {
  return async () => {
    if (item.kind === "plan") {
      plansRun += 1;
      return ["Looked around.", `GOAL: write notes/status-${plansRun}.md describing the state of the notes`, `PATHS: notes/status-${plansRun}.md`, "CHECK: the file exists and is not empty"].join("\n");
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
    // Plans that RAN - the CEO's dispatches, done, that planned a task. This
    // counted the department's PROPOSALS once, which are numbered by
    // generation and so always differ: the test passed while every dispatch
    // after the first was refused as a duplicate and no second plan ever ran.
    const ran = items.filter((w) => w.kind === "plan" && w.from_agent === "ceo" && w.state === "done" && (w.reason ?? "").startsWith("planned w-"));
    const tasks = items.filter((w) => w.kind === "task" && w.from_agent === "engineering");
    // More than one GENERATION of plans RAN: the department iterated.
    expect(ran.length).toBeGreaterThan(1);
    // Each plan's answer became a task carrying the paths it named.
    expect(tasks.length).toBeGreaterThan(1);
    expect(targetPathsOfItem(tasks[0]!)).toEqual(["notes/status-1.md"]);
    expect(targetPathsOfItem(tasks[1]!)).toEqual(["notes/status-2.md"]);
    // And more than one of them was reviewed and landed.
    expect(landed).toContain(tasks[0]!.id);
    expect(landed).toContain(tasks[1]!.id);
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

describe("a department that finds nothing new rests", () => {
  // Found by the dogfood run, the other half of the stall: once every plan was
  // dispatched again, a department whose planner answered "GOAL: none" would
  // plan again on the very next tick, for ever - a model call per role per tick
  // to hear "nothing", and ledger rows that nothing ever prunes.

  /** Run one plan for engineering, through the real path, answering `answer`. */
  async function runPlan(dir: string, answer: string): Promise<WorkItem> {
    const handle = openWork(dir);
    const made = propose(handle, { from: "ceo", to: "engineering", kind: "plan", payload: `plan ${Math.random()}`, goal: `plan ${Math.random()}` });
    handle.close();
    if (!made.ok || made.item === undefined) throw new Error("seed");
    reconcileOnce({ stateDir: dir, actor: "t" });
    await runWorkItem({
      stateDir: dir,
      workId: made.item.id,
      cron: { name: made.item.id, agent: "builder", task: "plan", schedule: "0 0 1 1 *", enabled: true, expectTools: false },
      driver: async () => answer,
    });
    const after = openWork(dir);
    const item = get(after, made.item.id);
    after.close();
    if (item === null) throw new Error("vanished");
    return item;
  }
  const minutes = (n: number): number => n * 60_000;

  test("after a plan that found nothing, the department rests two cycles - then plans again", async () => {
    const dir = scratch();
    const plan = await runPlan(dir, "GOAL: none");
    expect(isIdlePlan(plan)).toBe(true);
    const ranAt = plan.started_at ?? 0;
    const soon = runCycle(workspace, dir, { actor: "t", now: ranAt + minutes(DEFAULT_CYCLE_MINUTES) });
    expect(soon.proposed).toEqual([]);
    expect(soon.summary).toContain("engineering held: resting until");
    const later = runCycle(workspace, dir, { actor: "t", now: ranAt + minutes(2 * DEFAULT_CYCLE_MINUTES) + 1 });
    expect(later.proposed.map((p) => p.from)).toEqual(["engineering"]);
  });

  test("the governance summary - the line the supervisor logs - says who is resting", async () => {
    const dir = scratch();
    await runPlan(dir, "GOAL: none");
    const report = await runGovernance(workspace, dir, { maxDispatch: 0, dispatch: async () => ({ ok: true }) });
    expect(report.summary).toContain("engineering held: resting until");
  });

  test("a plan that proposes work that ALREADY exists counts as finding nothing", async () => {
    const dir = scratch();
    const answer = "GOAL: write notes/a.md\nPATHS: notes/a.md\nCHECK: it exists";
    expect(isIdlePlan(await runPlan(dir, answer))).toBe(false);
    expect(isIdlePlan(await runPlan(dir, answer))).toBe(true);
  });

  test("each further empty plan doubles the rest, up to a day", () => {
    const empty = (seq: number, at: number): WorkItem =>
      ({ id: `p${seq}`, kind: "plan", state: "done", from_agent: "ceo", to_agent: "engineering", reason: "planned nothing: x", created_seq: seq, started_at: at } as unknown as WorkItem);
    const at = 1_000_000;
    expect(departmentRestUntil("engineering", [empty(1, at)], 30)).toBe(at + minutes(60));
    expect(departmentRestUntil("engineering", [empty(1, 0), empty(2, at)], 30)).toBe(at + minutes(120));
    expect(departmentRestUntil("engineering", [empty(1, 0), empty(2, 0), empty(3, at)], 30)).toBe(at + minutes(240));
    const many = Array.from({ length: 12 }, (_, i) => empty(i + 1, i === 11 ? at : 0));
    expect(departmentRestUntil("engineering", many, 30)).toBe(at + minutes(MAX_REST_MINUTES));
  });

  test("a plan whose answer could not be read even on its last retry counts as empty", () => {
    // Otherwise a planner that always answers garbage frees its department to
    // plan again the moment its retries run out - four model calls a cycle, for
    // ever, with nothing to show.
    const failed = (reason: string): WorkItem =>
      ({ id: "p1", kind: "plan", state: "failed", from_agent: "ceo", to_agent: "engineering", reason, created_seq: 1, started_at: 5 } as unknown as WorkItem);
    expect(isIdlePlan(failed("run failed (3/3): the plan had no GOAL line"))).toBe(true);
    expect(departmentRestUntil("engineering", [failed("run failed (3/3): no GOAL")], 30)).not.toBeNull();
    // Still retrying is not empty - it is in motion, and the department is busy.
    expect(isIdlePlan(failed("run failed (1/3): no GOAL"))).toBe(false);
  });

  test("a plan that found something resets it - only an unbroken run of empty plans counts", () => {
    const plan = (seq: number, reason: string): WorkItem =>
      ({ id: `p${seq}`, kind: "plan", state: "done", from_agent: "ceo", to_agent: "engineering", reason, created_seq: seq, started_at: 5 } as unknown as WorkItem);
    expect(departmentRestUntil("engineering", [plan(1, "planned nothing: x"), plan(2, "planned w-1: write it")], 30)).toBeNull();
    // Another department's empty plans are not this one's.
    expect(departmentRestUntil("cto", [plan(1, "planned nothing: x")], 30)).toBeNull();
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
