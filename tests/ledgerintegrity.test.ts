import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openWork, propose, claim, claimById, commit, get, reject, blockedWork, clearReview,
  runFailureReason, parseRunFailure, isRetryableFailure, MAX_RUN_ATTEMPTS, MAX_REASON, type WorkDb,
} from "../src/work";
import { reconcileOnce } from "../src/reconcile";
import { runWorkItem } from "../src/runwork";
import type { Driver } from "../src/dispatch";
import type { Cron } from "../src/workspace";

/**
 * The ledger's state machine, held to what it claims.
 *
 * Every test here reproduces a defect that was measured on this tree before it
 * was fixed - not a property that merely seemed worth having:
 *
 *   - `cod work commit <proposed-id> --epoch 0` marked a PROPOSAL done, because
 *     commit() checked the epoch and nothing else, and a proposal sits at 0.
 *   - running the second of two ready items claimed the FIRST, by addressee,
 *     then fenced out the second's result.
 *   - an agent that failed was committed `done` and reported `ok: true`.
 *   - a failed item was in no queue at all, so `cod status` said nothing was
 *     waiting on anyone while it sat dead.
 */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-ledger-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const cron: Cron = { name: "job", agent: "builder", task: "do it", schedule: "0 0 1 1 *", enabled: true, expectTools: true };

function ledger(): { dir: string; handle: WorkDb } {
  const dir = scratch();
  return { dir, handle: openWork(dir) };
}

function proposeOne(handle: WorkDb, goal: string): string {
  const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: goal, goal });
  if (!made.ok || made.item === undefined) throw new Error(`seed failed: ${made.reason ?? "?"}`);
  return made.item.id;
}

describe("commit only finishes work that is running", () => {
  test("a PROPOSAL cannot be committed at epoch 0 - the CEO is not bypassed", () => {
    const { handle } = ledger();
    const id = proposeOne(handle, "never reconciled");
    const outcome = commit(handle, id, 0, "done", "never ran");
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("not running");
    expect(get(handle, id)?.state).toBe("proposed");
    handle.close();
  });

  test("a READY item cannot be committed either - it was never claimed", () => {
    const { dir, handle } = ledger();
    const id = proposeOne(handle, "reconciled, never claimed");
    reconcileOnce({ stateDir: dir, actor: "t", handle });
    expect(commit(handle, id, 0, "done").ok).toBe(false);
    expect(get(handle, id)?.state).toBe("ready");
    handle.close();
  });

  test("a claimed item still commits, and a stale epoch is still FENCED rather than 'not running'", () => {
    const { dir, handle } = ledger();
    const id = proposeOne(handle, "real work");
    reconcileOnce({ stateDir: dir, actor: "t", handle });
    const claimed = claimById(handle, id, "w");
    if (claimed === null) throw new Error("claim failed");
    expect(commit(handle, id, claimed.lease_epoch, "done", "finished").ok).toBe(true);
    const stale = commit(handle, id, claimed.lease_epoch, "failed", "zombie");
    expect(stale.fenced).toBe(true);
    expect(stale.reason).toContain("stale");
    handle.close();
  });

  test("the recorded reason is bounded and redacted", () => {
    const { dir, handle } = ledger();
    const id = proposeOne(handle, "chatty");
    reconcileOnce({ stateDir: dir, actor: "t", handle });
    const claimed = claimById(handle, id, "w");
    if (claimed === null) throw new Error("claim failed");
    const key = `sk-${"a".repeat(40)}`;
    commit(handle, id, claimed.lease_epoch, "done", `found ${key} ${"x".repeat(10_000)}`);
    const reason = get(handle, id)?.reason ?? "";
    expect(reason).not.toContain(key);
    expect(reason).toContain("[REDACTED]");
    expect(reason.length).toBeLessThanOrEqual(MAX_REASON);
    expect(reason).toContain("[truncated]");
    handle.close();
  });
});

describe("claimById claims THE item, not the next one for its department", () => {
  test("two ready items: claiming the second claims the second", () => {
    const { dir, handle } = ledger();
    const first = proposeOne(handle, "first");
    const second = proposeOne(handle, "second");
    reconcileOnce({ stateDir: dir, actor: "t", handle });
    expect(claimById(handle, second, "w")?.id).toBe(second);
    expect(get(handle, first)?.state).toBe("ready");
    handle.close();
  });

  test("an item that is not ready is not claimable by id", () => {
    const { handle } = ledger();
    const id = proposeOne(handle, "still proposed");
    expect(claimById(handle, id, "w")).toBeNull();
    handle.close();
  });

  test("runWorkItem on the SECOND of two items runs and commits the second", async () => {
    // The measured bug: the first item was left `running` with nobody on it,
    // and the second item's real result was fenced out.
    const { dir, handle } = ledger();
    const first = proposeOne(handle, "first");
    const second = proposeOne(handle, "second");
    handle.close();
    reconcileOnce({ stateDir: dir, actor: "t" });
    const driver: Driver = async () => "did the second";
    const result = await runWorkItem({ stateDir: dir, workId: second, cron, driver });
    expect(result.ok).toBe(true);
    const after = openWork(dir);
    expect(get(after, second)?.state).toBe("done");
    expect(get(after, first)?.state).toBe("ready");
    expect(get(after, first)?.attempts).toBe(0);
    after.close();
  });
});

describe("a failed run is FAILED, and it is retried a bounded number of times", () => {
  const failing: Driver = async () => "agent FAILED: agent reported an error: provider returned 500";

  test("an agent failure is not recorded as done", async () => {
    const { dir, handle } = ledger();
    const id = proposeOne(handle, "flaky provider");
    handle.close();
    reconcileOnce({ stateDir: dir, actor: "t" });
    const result = await runWorkItem({ stateDir: dir, workId: id, cron, driver: failing });
    expect(result.ok).toBe(false);
    const after = openWork(dir);
    const item = get(after, id);
    expect(item?.state).toBe("failed");
    expect(item?.reason).toMatch(/^run failed \(1\/3\): agent FAILED/);
    after.close();
  });

  test("the reconciler retries it on the NEXT pass, not the one that failed it", () => {
    const { dir, handle } = ledger();
    const id = proposeOne(handle, "slow");
    reconcileOnce({ stateDir: dir, actor: "t", handle });
    claim(handle, "slow-worker");
    const reclaim = reconcileOnce({ stateDir: dir, actor: "t", handle, now: Date.now() + 600_000, budgetMs: 1000 });
    expect(reclaim.expired).toEqual([id]);
    expect(reclaim.retried).toEqual([]);
    expect(get(handle, id)?.state).toBe("failed");
    const next = reconcileOnce({ stateDir: dir, actor: "t", handle });
    expect(next.retried).toEqual([id]);
    expect(get(handle, id)?.state).toBe("ready");
    handle.close();
  });

  test("after MAX_RUN_ATTEMPTS consecutive failures it stops and waits for a person", async () => {
    const { dir, handle } = ledger();
    const id = proposeOne(handle, "always fails");
    handle.close();
    reconcileOnce({ stateDir: dir, actor: "t" });
    for (let attempt = 1; attempt <= MAX_RUN_ATTEMPTS; attempt += 1) {
      await runWorkItem({ stateDir: dir, workId: id, cron, driver: failing });
      reconcileOnce({ stateDir: dir, actor: "t" });
    }
    const after = openWork(dir);
    expect(get(after, id)?.state).toBe("failed");
    expect(get(after, id)?.reason).toMatch(/^run failed \(3\/3\)/);
    expect(get(after, id)?.attempts).toBe(MAX_RUN_ATTEMPTS);
    const blocked = blockedWork(after);
    expect(blocked.map((b) => b.item.id)).toEqual([id]);
    expect(blocked[0]?.kind).toBe("failed");
    after.close();
  });

  test("a failure that is a DECISION (an operator's --failed) is never retried", () => {
    const { dir, handle } = ledger();
    const id = proposeOne(handle, "operator says no");
    reconcileOnce({ stateDir: dir, actor: "t", handle });
    const claimed = claimById(handle, id, "w");
    if (claimed === null) throw new Error("claim failed");
    commit(handle, id, claimed.lease_epoch, "failed", "the operator stopped this");
    expect(reconcileOnce({ stateDir: dir, actor: "t", handle }).retried).toEqual([]);
    expect(blockedWork(handle).map((b) => b.kind)).toEqual(["failed"]);
    handle.close();
  });

  test("unblocking a failed item puts it back on the queue with the operator's note", () => {
    const { dir, handle } = ledger();
    const id = proposeOne(handle, "stuck");
    reconcileOnce({ stateDir: dir, actor: "t", handle });
    const claimed = claimById(handle, id, "w");
    if (claimed === null) throw new Error("claim failed");
    commit(handle, id, claimed.lease_epoch, "failed", "the operator stopped this");
    expect(clearReview(handle, id, "provider fixed").ok).toBe(true);
    expect(get(handle, id)?.state).toBe("ready");
    expect(get(handle, id)?.reason).toContain("provider fixed");
    expect(blockedWork(handle)).toEqual([]);
    handle.close();
  });

  test("the failure counter counts CONSECUTIVE failures", () => {
    expect(runFailureReason(null, "x")).toBe("run failed (1/3): x");
    expect(runFailureReason("run failed (1/3): x", "y")).toBe("run failed (2/3): y");
    expect(runFailureReason("the last run's answer", "y")).toBe("run failed (1/3): y");
    expect(parseRunFailure("run failed (2/3): y")).toEqual({ n: 2, max: 3 });
    expect(parseRunFailure("review (attempt 1): no")).toBeNull();
    expect(isRetryableFailure({ state: "failed", reason: "run failed (2/3): y" })).toBe(true);
    expect(isRetryableFailure({ state: "failed", reason: "run failed (3/3): y" })).toBe(false);
    expect(isRetryableFailure({ state: "done", reason: "run failed (1/3): y" })).toBe(false);
  });
});

describe("refusal only applies to work that never ran", () => {
  test("a running item cannot be rewritten as refused", () => {
    const { dir, handle } = ledger();
    const id = proposeOne(handle, "in flight");
    reconcileOnce({ stateDir: dir, actor: "t", handle });
    claimById(handle, id, "w");
    const outcome = reject(handle, id, "too late");
    expect(outcome.ok).toBe(false);
    expect(get(handle, id)?.state).toBe("running");
    handle.close();
  });

  test("global work refused at dispatch is `rejected`, because it never ran", async () => {
    const { dir, handle } = ledger();
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "schema", goal: "schema", targetPaths: ["src/workspace.ts"] });
    handle.close();
    if (!made.ok || made.item === undefined) throw new Error("seed");
    const result = await runWorkItem({ stateDir: dir, workId: made.item.id, cron, driver: async () => "should not run" });
    expect(result.ok).toBe(false);
    const after = openWork(dir);
    expect(get(after, made.item.id)?.state).toBe("rejected");
    after.close();
  });
});

describe("a proposal is validated as data, not trusted", () => {
  test("target paths must be repository paths", () => {
    const { handle } = ledger();
    for (const bad of ["/etc/passwd", "../outside", "a/../../b", "a\\b", "", "a/./b", "x\u0000y"]) {
      const result = propose(handle, { from: "eng", to: "eng", kind: "task", payload: "p", goal: `g ${JSON.stringify(bad)}`, targetPaths: [bad] });
      expect(result.ok).toBe(false);
    }
    expect(propose(handle, { from: "eng", to: "eng", kind: "task", payload: "p", goal: "ok", targetPaths: ["notes/a.md", "docs/x/y.md"] }).ok).toBe(true);
    handle.close();
  });

  test("from and to must be names, and kind a word", () => {
    const { handle } = ledger();
    expect(propose(handle, { from: "Eng!", to: "eng", kind: "task", payload: "p", goal: "a" }).ok).toBe(false);
    expect(propose(handle, { from: "eng", to: "../ceo", kind: "task", payload: "p", goal: "b" }).ok).toBe(false);
    expect(propose(handle, { from: "eng", to: "eng", kind: "Task Now", payload: "p", goal: "c" }).ok).toBe(false);
    handle.close();
  });

  test("an oversized payload is refused, and a credential in one is redacted", () => {
    const { handle } = ledger();
    expect(propose(handle, { from: "eng", to: "eng", kind: "task", payload: "x".repeat(20_000), goal: "big" }).ok).toBe(false);
    const key = `ghp_${"b".repeat(36)}`;
    const made = propose(handle, { from: "eng", to: "eng", kind: "task", payload: `use ${key}`, goal: "secret" });
    expect(made.ok).toBe(true);
    expect(made.item?.payload).not.toContain(key);
    handle.close();
  });

  test("an id that git could read as an option, or that worktree.ts would refuse, is refused here too", () => {
    const { handle } = ledger();
    for (const bad of ["-rf", "UPPER", ".hidden", "a..b"]) {
      expect(() => propose(handle, { from: "eng", to: "eng", kind: "task", payload: "p", goal: `id ${bad}`, id: bad })).toThrow();
    }
    handle.close();
  });
});
