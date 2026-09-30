import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWork, listWork } from "../src/work";
import { holdMeeting, castFor, type Meeting } from "../src/meeting";
import { runCycle } from "../src/cycle";
import type { Workspace } from "../src/workspace";

/**
 * A meeting, not a report.
 *
 * The version this replaces collected activity, listed the pipeline and wrote
 * minutes. No agent spoke and nothing was decided - which the roadmap named as
 * the exact thing that is not a meeting, and which then happened anyway.
 *
 * Three properties, and each one is the reason this file exists:
 *   1. every role SPEAKS - it has a position, not a row in a table
 *   2. the CEO DECIDES - and a decision is an explicit state change
 *   3. the product is WORK - decisions become ledger items, not prose
 */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-meet-"));
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

describe("castFor", () => {
  test("the cast is DERIVED, so a department joins by existing", () => {
    const cast = castFor(workspace);
    expect(cast.map((c) => c.role).sort()).toEqual(["ceo", "cto", "engineering"]);
  });

  test("a department added later joins with no code change", () => {
    const grown = { ...workspace, departments: [...workspace.departments, { name: "cfo", purpose: "control spend", workers: [{ name: "cfo", role: "cfo", model: "m", skills: [] }] }] } as unknown as Workspace;
    expect(castFor(grown).map((c) => c.role)).toContain("cfo");
  });

  test("CTO is a WORKING role with a purpose, not a meeting-only attendee", () => {
    const cto = castFor(workspace).find((c) => c.role === "cto");
    expect(cto?.purpose).toBe("decide what we build next");
  });

  test("the CEO is always present and always first", () => {
    expect(castFor(workspace)[0]?.role).toBe("ceo");
  });
});

describe("holdMeeting", () => {
  test("EVERY role speaks - the difference between a meeting and a report", () => {
    const dir = scratch();
    const meeting: Meeting = holdMeeting(workspace, dir);
    expect(meeting.speaking.map((s) => s.role).sort()).toEqual(["ceo", "cto", "engineering"]);
    for (const statement of meeting.speaking) {
      expect(statement.position.length).toBeGreaterThan(20);
    }
  });

  test("a role's position is about ITS OWN work, not a shared activity dump", () => {
    const dir = scratch();
    const meeting = holdMeeting(workspace, dir);
    const engineering = meeting.speaking.find((s) => s.role === "engineering");
    expect(engineering?.position).toContain("engineering");
  });

  test("the CEO decides, and the decisions are states not prose", () => {
    const dir = scratch();
    // A cycle first: a meeting with nothing on the table decides nothing, and
    // that is correct. The sequence that matters is cycle, then meeting.
    runCycle(workspace, dir, { actor: "cycle" });
    const meeting: Meeting = holdMeeting(workspace, dir);
    expect(meeting.decisions.length).toBeGreaterThan(0);
    for (const d of meeting.decisions) {
      expect(d.by).toBe("ceo");
      expect(d.verdict).toMatch(/dispatch|defer|reject/);
    }
  });

  test("the PRODUCT of the meeting is work, not minutes", () => {
    // A decision that produces no work item is a discussion.
    const dir = scratch();
    runCycle(workspace, dir, { actor: "cycle" });
    const before = countItems(dir);
    const meeting = holdMeeting(workspace, dir);
    // The meeting ADDS work. If its only output were prose this would not move.
    expect(meeting.decisions.length).toBeGreaterThan(0);
    expect(countItems(dir)).toBeGreaterThan(before);
  });

  test("the CEO dispatches TO a department, never to itself", () => {
    const dir = scratch();
    runCycle(workspace, dir, { actor: "cycle" });
    holdMeeting(workspace, dir);
    const handle = openWork(dir);
    // Departments' proposals are addressed to the CEO; the CEO's decisions must
    // be addressed BACK to a department. Dispatching to itself is a dead
    // letter: an item with no department to be done by.
    const fromCeo = listWork(handle).filter((w) => w.from_agent === "ceo");
    const roles = new Set(fromCeo.map((w) => w.to_agent));
    handle.close();
    expect(fromCeo.length).toBeGreaterThan(0);
    expect(roles.has("ceo")).toBe(false);
    expect([...roles].every((r) => r === "engineering" || r === "cto")).toBe(true);
  });

  test("nothing is decided about work the meeting did not see", () => {
    const dir = scratch();
    const empty = holdMeeting({ ...workspace, departments: [] } as unknown as Workspace, dir);
    // With nothing proposed there is nothing to decide. Inventing a decision
    // would be the meeting manufacturing work out of nothing.
    expect(empty.decisions.length).toBe(0);
    expect(empty.speaking.length).toBeGreaterThan(0); // the CEO still speaks
  });

  test("an empty ledger does not crash the meeting", () => {
    const dir = scratch();
    const meeting = holdMeeting({ ...workspace, departments: [] } as unknown as Workspace, dir);
    expect(meeting.summary.length).toBeGreaterThan(0);
  });
});

function countItems(dir: string): number {
  const handle = openWork(dir);
  try {
    return listWork(handle).length;
  } finally {
    handle.close();
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
