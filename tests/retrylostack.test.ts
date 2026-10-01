import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { openWork, propose, get, claim, commit } from "../src/work";
import { reconcileOnce } from "../src/reconcile";

/**
 * A review RETRY must not be swallowed by the reconciler.
 *
 * Found by Max, and it defeats the entire review loop:
 *
 *   landWork sends an item back with state='ready'. The result file written by
 *   the PREVIOUS attempt is never removed. On the retry the item is claimed
 *   again, the 30s reconciler fires, sees `running`, reads that stale file, sees
 *   `done`, and COMMITS it - reporting "recovered from a durable result file
 *   after a lost acknowledgement".
 *
 *   That is a fabricated acknowledgement. Attempt two is fenced out before it
 *   can act, and the item is reviewed carrying attempt one's diff. The loop's
 *   whole purpose is defeated on the first tick after every retry.
 *
 * The discriminator is already in the data: the file is written by spreading
 * the WorkItem, so it carries the lease_epoch of the run that produced it. A
 * result is an acknowledgement OF AN EPOCH, and an epoch cannot acknowledge a
 * later run.
 */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-retry-ack-"));
  dirs.push(dir);
  return dir;
}

/**
 * Propose, then PROMOTE to ready - only the reconciler may do that in
 * production, and `claim` only ever selects `ready` rows. The first version of
 * this helper left the item at `proposed`, so every claim returned null and all
 * three tests failed for a reason that had nothing to do with the reconciler.
 */
function seed(): { handle: ReturnType<typeof openWork>; id: string; dir: string } {
  const dir = scratch();
  const handle = openWork(dir);
  const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "do it", goal: "do it" });
  if (!made.ok || made.item === undefined) throw new Error("seed");
  handle.db.query("UPDATE work SET state = 'ready' WHERE id = ?").run(made.item.id);
  return { handle, id: made.item.id, dir };
}

describe("a stale result file is not an acknowledgement", () => {
  test("a result file from a PREVIOUS epoch does not resolve a retried item", () => {
    const { handle, id, dir } = seed();

    // Attempt one runs and produces a result file under epoch 1.
    const first = claim(handle, "worker-1", "engineering");
    expect(first?.lease_epoch).toBe(1);
    commit(handle, id, first!.lease_epoch, "failed", "the reviewer asked for changes");
    expect(get(handle, id)?.state).toBe("failed");

    // landWork sends it back: ready, and the epoch is bumped.
    handle.db.query("UPDATE work SET state = 'ready', lease_epoch = lease_epoch + 1 WHERE id = ?").run(id);

    // Attempt two is claimed - epoch 2 - and is now genuinely running.
    const second = claim(handle, "worker-2", "engineering");
    // The RELATIONSHIP is what matters, not the literal: commit() deliberately
    // consumes an epoch of its own, so asserting "2" here would be asserting an
    // accident of the sequence rather than the property under test.
    expect(second!.lease_epoch).toBeGreaterThan(first!.lease_epoch);
    expect(get(handle, id)?.state).toBe("running");

    // The file from attempt one is STILL ON DISK. That is the bug's precondition,
    // and it is asserted rather than assumed - otherwise this test would pass
    // for the wrong reason if commit ever stopped writing it.
    expect(existsSync(join(dir, "work", `${id}.json`))).toBe(true);

    const report = reconcileOnce({ stateDir: dir, actor: "test" });

    expect(report.resolved).not.toContain(id);
    // And crucially the item is still RUNNING - attempt two was not fenced out.
    expect(get(handle, id)?.state).toBe("running");
    handle.close();
  });

  test("a result file from the CURRENT epoch DOES resolve it - recovery still works", () => {
    // The guard must not disable the recovery it was protecting. "Work was paid
    // for but the ack was lost" is a real case and still has to be honoured.
    const { handle, id, dir } = seed();
    const claimed = claim(handle, "worker-1", "engineering");
    commit(handle, id, claimed!.lease_epoch, "done", "real work");

    // Re-stage the item as running with the SAME epoch the file was written under.
    handle.db.query("UPDATE work SET state = 'running', lease_epoch = ? WHERE id = ?").run(claimed!.lease_epoch, id);

    const report = reconcileOnce({ stateDir: dir, actor: "test" });
    expect(report.resolved).toContain(id);
    expect(get(handle, id)?.state).toBe("done");
    handle.close();
  });

  test("the result file records the epoch it was produced under", () => {
    // Premise for both tests above. If the file did not carry the epoch, the
    // guard could not be written - and the test would pass for the wrong reason.
    const { handle, id, dir } = seed();
    const claimed = claim(handle, "worker-1", "engineering");
    commit(handle, id, claimed!.lease_epoch, "done", "x");
    const file = JSON.parse(readFileSync(join(dir, "work", `${id}.json`), "utf8")) as { lease_epoch: number };
    expect(file.lease_epoch).toBe(claimed!.lease_epoch);
    handle.close();
  });
});

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
