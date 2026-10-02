import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWork, propose, listWork, claimById, commit, recordReview } from "../src/work";
import { runGovernance, governanceIntervalFor } from "../src/governance";
import type { Workspace } from "../src/workspace";

/**
 * The company running itself.
 *
 * Until this existed the loop was real but manual: a human typed `cod cycle`,
 * then `cod meet`, then `cod work run <id>` for each item. Every part worked.
 * Nothing connected them, which is the same shape as a registry with no
 * callers - a working system that requires a person to be present to be one.
 *
 * The test criterion is deliberately the harsh one: NO human in the loop, and a
 * refused item must stay refused rather than being forced through.
 */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-gov-"));
  dirs.push(dir);
  return dir;
}

const workspace = {
  version: 1,
  company: { name: "Acme", purpose: "ship" },
  timezone: "UTC",
  departments: [
    { name: "engineering", purpose: "keep the tests green", workers: [{ name: "builder", role: "builds", model: "kilo/kilo-auto/free", skills: [] }] },
    { name: "cto", purpose: "decide what we build next", workers: [{ name: "cto", role: "decides", model: "kilo/kilo-auto/free", skills: [] }] },
  ],
  crons: [],
} as unknown as Workspace;

const opts = { maxDispatch: 2 };

describe("runGovernance", () => {
  test("one tick proposes, meets AND dispatches, with nobody watching", async () => {
    const dir = scratch();
    const ran: string[] = [];
    const dispatch = async (id: string) => { ran.push(id); return { ok: true, output: "done" }; };
    // TWO ticks, and that is the honest shape: a tick proposes, the meeting
    // decides, and the decisions are PROPOSED work that the NEXT tick
    // reconciles and dispatches. Collapsing it into one tick would mean a
    // meeting could dispatch work it had not yet reconciled.
    const first = await runGovernance(workspace, dir, { ...opts, dispatch });
    expect(first.cycle.proposed.length).toBeGreaterThan(0);
    expect(first.meeting.speaking.length).toBeGreaterThan(1);
    expect(ran.length).toBe(0);

    const second = await runGovernance(workspace, dir, { ...opts, dispatch });
    // Nobody was here for either call.
    expect(ran.length).toBeGreaterThan(0);
    expect(second.summary).toContain("dispatched");
  });

  test("it never dispatches more than the bound", async () => {
    const dir = scratch();
    let count = 0;
    const dispatch = async (id: string) => { count += 1; return { ok: true, output: id }; };
    await runGovernance(workspace, dir, { ...opts, maxDispatch: 1, dispatch });
    await runGovernance(workspace, dir, { ...opts, maxDispatch: 1, dispatch });
    expect(count).toBe(1);
  });

  test("a GLOBAL item is not dispatched by the tick", async () => {
    // The boundary does not get relaxed because nobody is watching. That is
    // precisely when a ceiling matters most.
    const dir = scratch();
    const handle = openWork(dir);
    const made = propose(handle, {
      from: "engineering", to: "ceo", kind: "task", payload: "change the schema",
      goal: "schema-change", targetPaths: ["src/workspace.ts"],
    });
    handle.close();
    if (!made.ok) throw new Error("seed failed");
    const ran: string[] = [];
    const dispatch = async (id: string) => { ran.push(id); return { ok: true, output: "x" }; };
    await runGovernance(workspace, dir, { ...opts, dispatch });
    await runGovernance(workspace, dir, { ...opts, dispatch });
    expect(ran).not.toContain(made.item?.id ?? "");
  });

  test("a failing dispatch is recorded, not swallowed", async () => {
    const dir = scratch();
    const dispatch = async () => ({ ok: false, reason: "provider down" });
    await runGovernance(workspace, dir, { ...opts, dispatch });
    const report = await runGovernance(workspace, dir, { ...opts, dispatch });
    expect(report.failed.length).toBeGreaterThan(0);
    // The REASON, not just the id. In an unattended company nobody is there to
    // go and look, and a bare id is indistinguishable from a bug.
    expect(report.failed[0]?.reason).toBe("provider down");
    expect(report.summary).toContain("failed");
  });

  test("the whole thing reports rather than throwing when nothing works", async () => {
    const report = await runGovernance(workspace, "/proc/not-a-ledger", { ...opts, dispatch: async () => ({ ok: true, output: "x" }) });
    expect(report.summary.length).toBeGreaterThan(0);
  });

  test("it is SAFE to run on an empty company", async () => {
    const dir = scratch();
    const empty = { ...workspace, departments: [] } as unknown as Workspace;
    const report = await runGovernance(empty, dir, { ...opts, dispatch: async () => ({ ok: true, output: "x" }) });
    expect(report.summary.length).toBeGreaterThan(0);
  });

  test("a second tick does not re-dispatch work already DONE", async () => {
    const dir = scratch();
    const ran: string[] = [];
    // A dispatcher that commits what it ran, which is what the real one does.
    // A fake that returns ok and leaves the item `ready` would make the tick
    // look like it re-dispatches forever, when the truth is that the ledger
    // never saw the work finish.
    const d = {
      dispatch: async (id: string) => {
        ran.push(id);
        const handle = openWork(dir);
        try {
          // Claimed by id first, as the real dispatcher does: commit() only
          // accepts work that is running.
          const item = claimById(handle, id, "test");
          if (item !== null) commit(handle, id, item.lease_epoch, "done", "done");
        } finally {
          handle.close();
        }
        return { ok: true, output: "done" };
      },
    };
    await runGovernance(workspace, dir, { ...opts, ...d });
    await runGovernance(workspace, dir, { ...opts, ...d });
    await runGovernance(workspace, dir, { ...opts, ...d });
    expect(ran.length).toBeGreaterThan(0);
    // The property that matters is not "the count stops" - each tick legitimately
    // advances the pipeline one stage (propose -> meet -> dispatch), so the
    // count GROWS. It is that no ITEM is ever dispatched twice. An unattended
    // loop that re-runs finished work is a company that never gets anywhere.
    expect(new Set(ran).size).toBe(ran.length);
  });

  test("the tick does not re-offer work it has already reviewed", async () => {
    const dir = scratch();
    const reviewed: string[] = [];
    // The lander RECORDS, exactly as src/land.ts does. A fake that only
    // returns a verdict tests a fiction: the tick filters on the record, so a
    // lander that writes nothing leaves the item offered for ever, which is the
    // bug rather than the fix.
    const land = async (id: string) => {
      reviewed.push(id);
      const handle = openWork(dir);
      try {
        recordReview(handle, { workId: id, outcome: "rejected", reason: "not good enough", branch: `cod/${id}`, landedSha: "" });
      } finally {
        handle.close();
      }
      return { outcome: "rejected" as const, reason: "not good enough" };
    };
    // The dispatcher COMMITS, or nothing is ever `done` and the tick has nothing
    // to land - which made this test pass with nothing to assert.
    const dispatch = async (id: string) => {
      const handle = openWork(dir);
      try {
        // Claimed by id first, as the real dispatcher does: commit() only
        // accepts work that is running.
        const item = claimById(handle, id, "test");
        if (item !== null) commit(handle, id, item.lease_epoch, "done", "done");
      } finally {
        handle.close();
      }
      return { ok: true, output: "done" };
    };
    const run = () => runGovernance(workspace, dir, { ...opts, dispatch, land });
    await run(); await run(); await run();
    expect(reviewed.length).toBeGreaterThan(0);   // not vacuous
    // The lander is idempotent by contract, but the tick should not be LEANING
    // on that: three ticks, and the same rejected branch is not offered again.
    expect(new Set(reviewed).size).toBe(reviewed.length);
  });

  test("a rejected item appears in the tick's report, not silently", async () => {
    const dir = scratch();
    const land = async (id: string) => {
      const handle = openWork(dir);
      try {
        recordReview(handle, { workId: id, outcome: "rejected", reason: "no test", branch: `cod/${id}`, landedSha: "" });
      } finally {
        handle.close();
      }
      return { outcome: "rejected" as const, reason: "no test" };
    };
    const dispatch = async (id: string) => {
      const handle = openWork(dir);
      try {
        // Claimed by id first, as the real dispatcher does: commit() only
        // accepts work that is running.
        const item = claimById(handle, id, "test");
        if (item !== null) commit(handle, id, item.lease_epoch, "done", "done");
      } finally {
        handle.close();
      }
      return { ok: true, output: "done" };
    };
    await runGovernance(workspace, dir, { ...opts, dispatch, land });
    const report = await runGovernance(workspace, dir, { ...opts, dispatch, land });
    expect(report.landed.some((l) => l.outcome === "rejected")).toBe(true);
  });

  test("a MEETING does not manufacture work every time it runs", async () => {
    // The dangerous shape: each meeting turns every open item into a NEW
    // dispatch, and the next meeting does it again. Left alone that doubles
    // every tick - 2, 4, 8 - with nobody watching.
    const dir = scratch();
    const noop = { dispatch: async () => ({ ok: true, output: "x" }) };
    await runGovernance(workspace, dir, { ...opts, ...noop });
    const handle = openWork(dir);
    const afterFirst = listWork(handle).length;
    handle.close();
    await runGovernance(workspace, dir, { ...opts, ...noop });
    const handle2 = openWork(dir);
    const afterSecond = listWork(handle2).length;
    handle2.close();
    expect(afterSecond).toBe(afterFirst);
  });
});

describe("governanceIntervalFor", () => {
  test("it defaults to a real interval, because the default company is unattended", () => {
    expect(governanceIntervalFor({} as unknown as Workspace)).toBeGreaterThan(0);
  });

  test("a workspace can set it", () => {
    expect(governanceIntervalFor({ governance: { cycleEveryMinutes: 15 } } as unknown as Workspace)).toBe(15);
  });

  test("turning it OFF is honoured - an operator can make a workspace manual", () => {
    expect(governanceIntervalFor({ governance: { enabled: false } } as unknown as Workspace)).toBe(0);
  });

  test("a nonsense interval falls back rather than scheduling nonsense", () => {
    expect(governanceIntervalFor({ governance: { cycleEveryMinutes: -5 } } as unknown as Workspace)).toBeGreaterThan(0);
    expect(governanceIntervalFor({ governance: { cycleEveryMinutes: 0 } } as unknown as Workspace)).toBeGreaterThan(0);
  });
});

// In afterAll, not at module top level: top-level code runs while bun is
// COLLECTING the tests, before any directory exists, and so deleted nothing.
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
