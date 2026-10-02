import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openWork, propose, get, latestReview, claimById, commit } from "../src/work";
import { landWork } from "../src/land";
import { briefFor } from "../src/runwork";

/**
 * The review LOOP, as opposed to the review itself.
 *
 * Two things were wrong and they are independent:
 *
 *   1. `alreadyRetried` was a BOOLEAN, so `maxRetries` above 1 was inert -
 *      every value except 1 was decoration.
 *   2. A mechanical refusal (a global path, a secret shape) could be retried
 *      at all. Under a loop that stops being theoretical: it invites the worker
 *      to argue with a deterministic check and spends a free model call to do it.
 *
 * Fixtures are duplicated from tests/land.test.ts rather than exported. Duplication
 * here is cheaper than a shared fixture module: these tests would be the only
 * consumer, and a shared helper is a second thing that can be wrong silently.
 */

const dirs: string[] = [];
const NL = String.fromCharCode(10);

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-loop-"));
  dirs.push(dir);
  const g = (...a: string[]): string =>
    execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "master", ".");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  return dir;
}

function branchWith(dir: string, name: string, path: string, body: string): void {
  const g = (...a: string[]): string =>
    execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("checkout", "-q", "-b", name);
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), body);
  g("add", "-A");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "change");
  g("checkout", "-q", "master");
}

function seeded(state: string): string {
  const handle = openWork(state);
  const made = propose(handle, {
    from: "engineering", to: "engineering", kind: "task",
    payload: "write notes", goal: "write notes", targetPaths: ["notes/a.md"],
  });
  handle.close();
  if (!made.ok || made.item === undefined) throw new Error("seed failed");
  return made.item.id;
}

/**
 * Finish an item the way the real worker does - claimed by id, committed done -
 * because only finished work is reviewed. Called again after a request for
 * changes to stand in for the worker's next attempt.
 */
function finished(state: string, id: string): void {
  const handle = openWork(state);
  try {
    handle.db.query("UPDATE work SET state = 'ready' WHERE id = ? AND state = 'proposed'").run(id);
    const claimed = claimById(handle, id, "test-worker");
    if (claimed !== null) commit(handle, id, claimed.lease_epoch, "done", "worker finished");
  } finally {
    handle.close();
  }
}

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-loop-state-"));
  dirs.push(dir);
  return dir;
}

/** Land the same item repeatedly, as the governance tick would. */
function lander(dir: string, state: string, id: string, maxRetries: number | undefined, answer: (why: string) => string) {
  return async (why: string) => {
    finished(state, id); // the worker's attempt this review is of
    const h = openWork(state);
    const item = get(h, id);
    h.close();
    if (item === null) throw new Error(`item ${id} vanished`);
    // `maxRetries` is spread in only when supplied, so a test can exercise the
    // DEFAULT rather than always pinning the value.
    const options =
      maxRetries === undefined
        ? { repo: dir, stateDir: state, ask: async () => answer(why) }
        : { repo: dir, stateDir: state, maxRetries, ask: async () => answer(why) };
    return landWork(dir, item, options);
  };
}

describe("the review loop", () => {
  test("request-changes retries UP TO the cap, not once", async () => {
    // THE test for the inert maxRetries. With a boolean this returned rejected
    // on the second call whatever the cap said.
    const dir = repo();
    const state = stateDir();
    const id = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "v1" + NL);
    const land = lander(dir, state, id, 3, (why) => `request changes - ${why}`);

    expect((await land("first")).outcome).toBe("changes-requested");
    expect((await land("second")).outcome).toBe("changes-requested");
    expect((await land("third")).outcome).toBe("changes-requested");
    // And the cap is real. An unbounded loop is a company that argues for ever.
    expect((await land("fourth")).outcome).toBe("rejected");
  });

  test("the objection ACCUMULATES, so attempt three sees attempts one and two", async () => {
    const dir = repo();
    const state = stateDir();
    const id = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "v1" + NL);
    const land = lander(dir, state, id, 3, (why) => `request changes - ${why}`);

    await land("alpha");
    await land("beta");

    // The worker runs in between, as it does in production - and its commit
    // REPLACES work.reason. That is what lost every objection but the newest
    // when they lived there; on the review row they survive the run.
    finished(state, id);
    const h = openWork(state);
    const item = get(h, id);
    const review = latestReview(h, id);
    h.close();
    const reason = review?.reason ?? "";
    // Attempt three that only sees attempt two's objection may fix that one and
    // regress the first, and the reviewer will say so for a fourth time.
    expect(reason).toContain("alpha");
    expect(reason).toContain("beta");
    expect(briefFor(item!, review)).toContain("alpha");
    expect(briefFor(item!, review)).toContain("beta");
  });

  test("a MECHANICAL refusal never retries, at any cap", async () => {
    // A global path is a rule, not an opinion. Retrying it spends a free model
    // call asking the worker to argue with a deterministic check - and the
    // reviewer in this test even APPROVES, which is the point: no model may
    // override a mechanical finding.
    const dir = repo();
    const state = stateDir();
    const id = seeded(state);
    branchWith(dir, `cod/${id}`, "package.json", "{}" + NL);
    const land = lander(dir, state, id, 5, () => "approve - looks fine to me");

    const result = await land("only chance");
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toContain("global");
  });

  test("a mechanical refusal is not handed back as review feedback to fix", async () => {
    // Otherwise briefFor would present a rule violation as something the worker
    // can negotiate, which is the opposite of the point.
    const dir = repo();
    const state = stateDir();
    const id = seeded(state);
    branchWith(dir, `cod/${id}`, "package.json", "{}" + NL);
    const land = lander(dir, state, id, 5, () => "request changes - no idea");

    await land("only chance");
    const h = openWork(state);
    const item = get(h, id);
    const review = latestReview(h, id);
    h.close();
    expect(review?.outcome).toBe("rejected");
    // The brief is exactly what it was before any review: the task and the
    // paths it named, and no objection to "fix".
    expect(briefFor(item!, review)).toBe(briefFor(item!, null));
    expect(briefFor(item!, review)).not.toContain("reviewed and returned");
  });

  test("a cap of zero refuses on the first objection", async () => {
    // The operator's lever, and it has to actually work.
    const dir = repo();
    const state = stateDir();
    const id = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "v1" + NL);
    const land = lander(dir, state, id, 0, () => "request changes - no test");
    expect((await land("only chance")).outcome).toBe("rejected");
  });

  test("the DEFAULT cap is three when the caller states none", async () => {
    // Mutation found this: every other test passes maxRetries explicitly, so
    // the fallback was never exercised and could be changed to 1 undetected.
    // An operator who configures nothing must still get the real policy.
    const dir = repo();
    const state = stateDir();
    const id = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "v1" + NL);
    const land = lander(dir, state, id, undefined as unknown as number, () => "request changes - no");

    expect((await land("a")).outcome).toBe("changes-requested");
    expect((await land("b")).outcome).toBe("changes-requested");
    expect((await land("c")).outcome).toBe("changes-requested");
    expect((await land("d")).outcome).toBe("rejected");
  });

  test("a mechanical refusal does not even ASK the model", async () => {
    // Mutation found this too: judgeReview happened to reject mechanical
    // findings anyway, so deleting the early return changed nothing. The thing
    // that actually matters is that no model is consulted about a rule - that
    // is the whole promise of "no model may override a mechanical check", and
    // it must not depend on the reviewer's prompt handling the same rule.
    const dir = repo();
    const state = stateDir();
    const id = seeded(state);
    branchWith(dir, `cod/${id}`, "package.json", "{}" + NL);
    let asked = 0;
    const land = lander(dir, state, id, 5, () => {
      asked += 1;
      return "approve - fine by me";
    });

    const result = await land("only chance");
    expect(result.outcome).toBe("rejected");
    expect(asked).toBe(0);
  });

  test("the loop converges: an approved retry still lands", async () => {
    // A loop that can never end in a merge is a loop that never converges.
    const dir = repo();
    const state = stateDir();
    const id = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "v1" + NL);
    let call = 0;
    const land = lander(dir, state, id, 3, () => {
      call += 1;
      return call < 3 ? "request changes - not yet" : "approve - good now";
    });

    expect((await land("a")).outcome).toBe("changes-requested");
    expect((await land("b")).outcome).toBe("changes-requested");
    expect((await land("c")).outcome).toBe("landed");
  });
});

// In afterAll, not at module top level: top-level code runs while bun is
// COLLECTING the tests, before any directory exists, and so deleted nothing.
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
