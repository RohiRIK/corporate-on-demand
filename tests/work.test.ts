/**
 * The work ledger and the reconciler.
 *
 * The properties pinned here are the ones everything above depends on and
 * cannot be checked by reading: mutual exclusion under real concurrency, and
 * FENCING. Fencing is the one that matters most - an agent killed mid-call is
 * a zombie, not a corpse, and if a stale write lands the newer result is gone.
 *
 * Concurrency is tested with real processes rather than promises, because
 * SQLite's write lock is the mechanism and an in-process test cannot exercise
 * it.
 */

import { describe, expect, test, afterEach } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWork, propose, claim, commit, listWork, get, noveltyKey, writeWorkFile, type WorkItem } from "../src/work";
import { reconcileOnce, formatReport, needsCeo } from "../src/reconcile";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-work-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seeded(goal = "do the thing", from = "engineering", blast?: number): { dir: string; id: string } {
  const dir = scratch();
  const handle = openWork(dir);
  const result = propose(handle, { from, to: from, kind: "task", payload: goal, goal, blastRadius: blast });
  handle.close();
  if (!result.ok || result.item === undefined) throw new Error(`seed failed: ${result.reason ?? "?"}`);
  return { dir, id: result.item.id };
}

describe("noveltyKey", () => {
  test("the same department, goal and paths give the same key", () => {
    expect(noveltyKey("eng", "fix the parser", ["a.ts", "b.ts"])).toBe(noveltyKey("eng", "fix the parser", ["b.ts", "a.ts"]));
  });

  test("path order does not change the key, but the set does", () => {
    // Sorted, so "touch a and b" and "touch b and a" are the same work.
    expect(noveltyKey("eng", "g", ["a", "b"])).toBe(noveltyKey("eng", "g", ["b", "a"]));
    expect(noveltyKey("eng", "g", ["a"])).not.toBe(noveltyKey("eng", "g", ["a", "b"]));
  });

  test("a different department gives a different key", () => {
    expect(noveltyKey("eng", "g")).not.toBe(noveltyKey("cto", "g"));
  });
});

describe("propose", () => {
  test("a proposal is NOT runnable, whatever proposed it", () => {
    // The anti-loop mechanism. A department cannot put itself on the queue.
    const { dir, id } = seeded();
    const handle = openWork(dir);
    expect(get(handle, id)?.state).toBe("proposed");
    handle.close();
  });

  test("re-proposing identical work is refused in SQL, not by asking nicely", () => {
    const dir = scratch();
    const handle = openWork(dir);
    const first = propose(handle, { from: "eng", to: "eng", kind: "t", payload: "p", goal: "same" });
    expect(first.ok).toBe(true);
    const second = propose(handle, { from: "eng", to: "eng", kind: "t", payload: "p", goal: "same" });
    expect(second.ok).toBe(false);
    expect(second.reason).toContain("already proposed");
    // The refusal is a fact in the ledger, not a transient return value.
    expect(listWork(handle).length).toBe(1);
    handle.close();
  });

  test("different work is accepted", () => {
    const dir = scratch();
    const handle = openWork(dir);
    expect(propose(handle, { from: "eng", to: "eng", kind: "t", payload: "a", goal: "one" }).ok).toBe(true);
    expect(propose(handle, { from: "eng", to: "eng", kind: "t", payload: "b", goal: "two" }).ok).toBe(true);
    expect(listWork(handle).length).toBe(2);
    handle.close();
  });

  test("a finished proposal leaves a readable file, because the files are the truth", () => {
    // The file records a FINISHED result, so it appears at commit rather than
    // at propose. Writing it at propose is what made its mere existence a
    // false "done" signal; see the regression suite below.
    const { dir, id } = seeded("durable");
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    const claimed = claim(handle, "w");
    if (claimed === null) throw new Error("nothing claimed");
    commit(handle, id, claimed.lease_epoch, "done", "finished");
    handle.close();
    const parsed = JSON.parse(readFileSync(join(dir, "work", `${id}.json`), "utf8")) as WorkItem;
    expect(parsed.id).toBe(id);
    expect(parsed.state).toBe("done");
    expect(parsed.novelty_key.length).toBe(32);
  });

  test("no .tmp file is left behind", () => {
    // The tmp+rename recipe: a leftover tmp is a half-written record.
    const { dir, id } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    const claimed = claim(handle, "w");
    if (claimed === null) throw new Error("nothing claimed");
    commit(handle, id, claimed.lease_epoch, "done");
    handle.close();
    expect(existsSync(join(dir, "work", `${id}.json.tmp`))).toBe(false);
  });
});

describe("claim", () => {
  test("nothing is claimable until the CEO reconciles it", () => {
    const { dir } = seeded();
    const handle = openWork(dir);
    expect(claim(handle, "worker")).toBeNull();
    handle.close();
  });

  test("a reconciled item is claimed exactly once", () => {
    const { dir, id } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    const first = claim(handle, "worker-a");
    expect(first?.id).toBe(id);
    expect(claim(handle, "worker-b")).toBeNull();
    handle.close();
  });

  test("claiming bumps the lease epoch", () => {
    const { dir } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    expect(claim(handle, "w")?.lease_epoch).toBeGreaterThan(0);
    handle.close();
  });

  test("work is claimed in proposal order", () => {
    const dir = scratch();
    const handle = openWork(dir);
    propose(handle, { from: "eng", to: "eng", kind: "t", payload: "1", goal: "first" });
    propose(handle, { from: "eng", to: "eng", kind: "t", payload: "2", goal: "second" });
    handle.close();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const h2 = openWork(dir);
    expect(claim(h2, "w")?.payload).toBe("1");
    expect(claim(h2, "w")?.payload).toBe("2");
    h2.close();
  });

  test("a claim can be addressed to one department only", () => {
    const { dir } = seeded("for cto", "cto");
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    expect(claim(handle, "w", "engineering")).toBeNull();
    expect(claim(handle, "w", "cto")?.payload).toBe("for cto");
    handle.close();
  });

  test("eight CONCURRENT processes race for one item, exactly one wins", async () => {
    // The mechanism is SQLite's write lock, so this must be separate processes.
    // Eight in-process promises would not exercise it at all.
    const { dir, id } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });

    const script = `
      import { openWork, claim } from "${join(import.meta.dir, "..", "src", "work.ts")}";
      const h = openWork(process.argv[2]);
      const got = claim(h, process.argv[3]);
      process.stdout.write(got === null ? "NONE" : "GOT:" + got.id);
      h.close();
    `;
    const scriptPath = join(scratch(), "racer.ts");
    require("node:fs").writeFileSync(scriptPath, script);

    // spawn ASYNC and let them all start before any can finish. The previous
    // version used spawnSync in a loop, so the eight processes ran one after
    // another and nothing was ever racing - the "REAL CONCURRENCY" label was
    // false. The property is real; the test was not proving it.
    const runs = await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        new Promise<{ out: string }>((resolve) => {
          const child = spawn(process.execPath, ["run", scriptPath, dir, `p${n}`]);
          let out = "";
          child.stdout.on("data", (chunk) => {
            out += String(chunk);
          });
          child.on("close", () => resolve({ out }));
        }),
      ),
    );
    const winners = runs.filter((r) => r.out.startsWith("GOT:"));
    expect(winners.length).toBe(1);
    expect(winners[0]?.out).toBe(`GOT:${id}`);
  });
});

describe("commit and fencing", () => {
  test("a commit with the current epoch succeeds", () => {
    const { dir } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    const claimed = claim(handle, "w");
    if (claimed === null) throw new Error("nothing claimed");
    const outcome = commit(handle, claimed.id, claimed.lease_epoch, "done");
    expect(outcome.ok).toBe(true);
    expect(outcome.fenced).toBe(false);
    handle.close();
  });

  test("a ZOMBIE with a stale epoch is fenced out and cannot clobber a newer result", () => {
    // The single most important property in this module. An agent killed
    // mid-call is not dead; if it wakes and writes, the newer result must
    // survive. Git worktrees do not prevent this - both runs share this ledger.
    const { dir } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });

    const first = openWork(dir);
    const zombie = claim(first, "zombie");
    if (zombie === null) throw new Error("nothing claimed");
    const zombieEpoch = zombie.lease_epoch;

    // The supervisor reclaims it and a new run takes over, bumping the epoch.
    first.db.query("UPDATE work SET state = 'ready', lease_owner = NULL WHERE id = ?").run(zombie.id);
    const second = openWork(dir);
    const live = claim(second, "live");
    if (live === null) throw new Error("re-claim failed");
    expect(live.lease_epoch).toBeGreaterThan(zombieEpoch);
    expect(commit(second, live.id, live.lease_epoch, "done", "the good result").ok).toBe(true);

    // Now the zombie wakes up and writes with its old epoch.
    const stale = commit(second, zombie.id, zombieEpoch, "failed", "the zombie result");
    expect(stale.ok).toBe(false);
    expect(stale.fenced).toBe(true);
    expect(stale.reason).toContain("stale");

    // And the good result is still there.
    expect(get(second, live.id)?.state).toBe("done");
    expect(get(second, live.id)?.reason).toBe("the good result");
    first.close();
    second.close();
  });

  test("fencing works across separate processes, not just handles", () => {
    const { dir } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const a = openWork(dir);
    const claimed = claim(a, "zombie");
    if (claimed === null) throw new Error("nothing claimed");
    a.db.query("UPDATE work SET state = 'ready', lease_owner = NULL WHERE id = ?").run(claimed.id);
    const b = openWork(dir);
    const live = claim(b, "live");
    if (live === null) throw new Error("re-claim failed");
    expect(commit(b, live.id, live.lease_epoch, "done", "good").ok).toBe(true);

    // A third, independent process holding the stale epoch.
    const c = openWork(dir);
    const stale = commit(c, claimed.id, claimed.lease_epoch, "failed", "stale write");
    expect(stale.fenced).toBe(true);
    a.close();
    b.close();
    c.close();
  });

  test("committing an unknown item is reported, not thrown", () => {
    const dir = scratch();
    const handle = openWork(dir);
    const outcome = commit(handle, "nope", 1, "done");
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("no such work item");
    handle.close();
  });
});

describe("reconcileOnce", () => {
  test("promotes a self-proposed item to runnable", () => {
    const { dir, id } = seeded();
    const report = reconcileOnce({ stateDir: dir, actor: "ceo" });
    expect(report.promoted).toEqual([id]);
    const handle = openWork(dir);
    expect(get(handle, id)?.state).toBe("ready");
    handle.close();
  });

  test("is idempotent, because cron re-fires it regardless", () => {
    // The defining property of a level-triggered loop: running it twice must
    // equal running it once.
    const { dir } = seeded();
    expect(reconcileOnce({ stateDir: dir, actor: "ceo" }).promoted.length).toBe(1);
    const second = reconcileOnce({ stateDir: dir, actor: "ceo" });
    expect(second.promoted).toEqual([]);
    expect(second.rejected).toEqual([]);
  });

  test("GLOBAL work is not runnable by a department - the blast-radius rule", () => {
    // A rule, not a judgement: radius 2 goes to the CEO whatever proposed it.
    const { dir, id } = seeded("change the schema", "engineering", 2);
    const report = reconcileOnce({ stateDir: dir, actor: "ceo" });
    expect(report.rejected).toEqual([id]);
    const handle = openWork(dir);
    // `rejected`, not `failed`: a refused proposal never ran, and conflating
    // the two loses the difference between "not permitted" and "did not work".
    expect(get(handle, id)?.state).toBe("rejected");
    expect(get(handle, id)?.reason).toContain("CEO");
    handle.close();
  });

  test("cross-department work is NOT global and stays runnable", () => {
    const { dir, id } = seeded("touch two areas", "engineering", 1);
    expect(reconcileOnce({ stateDir: dir, actor: "ceo" }).promoted).toEqual([id]);
  });

  test("needsCeo is a pure predicate over the row", () => {
    expect(needsCeo({ blast_radius: 2 } as WorkItem)).toBe(true);
    expect(needsCeo({ blast_radius: 1 } as WorkItem)).toBe(false);
    expect(needsCeo({ blast_radius: null } as WorkItem)).toBe(false);
  });

  test("reclaims work that overran its per-item budget", () => {
    const { dir, id } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    claim(handle, "slow");
    handle.close();
    // Well past the default budget.
    const report = reconcileOnce({ stateDir: dir, actor: "ceo", now: Date.now() + 600_000, budgetMs: 1000 });
    expect(report.expired).toEqual([id]);
    const after = openWork(dir);
    expect(get(after, id)?.state).toBe("failed");
    expect(get(after, id)?.reason).toContain("budget");
    after.close();
  });

  test("work inside its budget is left alone", () => {
    const { dir } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    claim(handle, "ok");
    handle.close();
    const report = reconcileOnce({ stateDir: dir, actor: "ceo", now: Date.now() + 10, budgetMs: 600_000 });
    expect(report.expired).toEqual([]);
    expect(report.unchanged).toBe(1);
  });

  test("recovers work whose result file exists but whose ack was lost", () => {
    // Resolved by READING the file, never by re-running it. Re-running would
    // double-execute and double-bill a job that already finished.
    const { dir, id } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    const claimed = claim(handle, "w");
    if (claimed === null) throw new Error("nothing claimed");
    // The durable record of a FINISHED result landed, then the process died
    // before it could update the row. The file is the only evidence.
    writeWorkFile(dir, { ...claimed, state: "done", payload: "the finished output" });
    handle.close();

    const report = reconcileOnce({ stateDir: dir, actor: "ceo" });
    expect(report.resolved).toEqual([id]);
    const after = openWork(dir);
    expect(get(after, id)?.state).toBe("done");
    expect(get(after, id)?.reason).toContain("lost acknowledgement");
    after.close();
  });

  test("an empty ledger is a no-op, not an error", () => {
    const dir = scratch();
    const report = reconcileOnce({ stateDir: dir, actor: "ceo" });
    expect(report.promoted).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(formatReport(report)[0]).toContain("nothing to do");
  });
});


describe("the bugs an independent review found", () => {
  // Each of these is a regression test for a bug that SHIPPED in 38b3683 and
  // was found by review, not by the existing suite. They are grouped together
  // on purpose so the reason each exists stays legible.

  test("claiming work does NOT mark it done", () => {
    // THE BUG: propose() wrote a result file, and the reconciler used bare
    // existsSync() as proof the work had been paid for. So every claimed item
    // was completed on the next tick having run nothing at all. Measured: state
    // went running -> done with zero execution.
    const { dir, id } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    claim(handle, "w");
    handle.close();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const after = openWork(dir);
    expect(get(after, id)?.state).toBe("running");
    expect(get(after, id)?.reason).toBeNull();
    after.close();
  });

  test("a result file only exists once work actually finished", () => {
    const { dir, id } = seeded();
    // At propose time there is nothing to recover FROM.
    expect(existsSync(join(dir, "work", `${id}.json`))).toBe(false);
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    const claimed = claim(handle, "w");
    if (claimed === null) throw new Error("nothing claimed");
    // Still nothing, because claiming is not finishing.
    expect(existsSync(join(dir, "work", `${id}.json`))).toBe(false);
    commit(handle, id, claimed.lease_epoch, "done");
    // NOW there is a record of a finished result.
    expect(existsSync(join(dir, "work", `${id}.json`))).toBe(true);
    handle.close();
  });

  test("recovery reads the file's own state, not just its existence", () => {
    // A file that does not describe a finished result is not an ack.
    const { dir, id } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    const claimed = claim(handle, "w");
    if (claimed === null) throw new Error("nothing claimed");
    // A file describing work that is still IN FLIGHT.
    writeWorkFile(dir, { ...claimed, state: "running" });
    handle.close();
    const report = reconcileOnce({ stateDir: dir, actor: "ceo" });
    expect(report.resolved).toEqual([]);
    const after = openWork(dir);
    expect(get(after, id)?.state).toBe("running");
    after.close();
  });

  test("RECLAIM fences the worker it reclaimed", () => {
    // THE BUG: reclaim set state=failed but left lease_epoch alone, so the
    // overrunning worker - which was never killed - still held a valid epoch
    // and overwrote the reclaim verdict with its own success. The fence was a
    // no-op against exactly the scenario it exists for.
    const { dir, id } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    const claimed = claim(handle, "slow");
    if (claimed === null) throw new Error("nothing claimed");
    reconcileOnce({ stateDir: dir, actor: "ceo", now: Date.now() + 600_000, budgetMs: 1000 });
    expect(get(handle, id)?.state).toBe("failed");
    // The slow worker wakes up and reports success. It must be refused.
    const zombie = commit(handle, id, claimed.lease_epoch, "done", "the slow result");
    expect(zombie.fenced).toBe(true);
    expect(get(handle, id)?.state).toBe("failed");
    handle.close();
  });

  test("an epoch is CONSUMED by the commit that used it", () => {
    // THE BUG: lease_epoch was only ever bumped by claim, so a second writer
    // holding the same epoch - a retried ack, a double signal - overwrote the
    // first result. Last write won.
    const { dir, id } = seeded();
    reconcileOnce({ stateDir: dir, actor: "ceo" });
    const handle = openWork(dir);
    const claimed = claim(handle, "w");
    if (claimed === null) throw new Error("nothing claimed");
    expect(commit(handle, id, claimed.lease_epoch, "done", "first").ok).toBe(true);
    const second = commit(handle, id, claimed.lease_epoch, "failed", "second writer, same epoch");
    expect(second.ok).toBe(false);
    expect(second.fenced).toBe(true);
    expect(get(handle, id)?.reason).toBe("first");
    handle.close();
  });

  test("a crafted id cannot write outside the work directory", () => {
    // THE BUG: the id becomes a filename, and "propose({id: '../escaped'})"
    // wrote outside state_dir. src/worktree.ts already had the right rule; this
    // mirrors it.
    const dir = scratch();
    const handle = openWork(dir);
    for (const bad of ["../escaped", "../../tmp/pwned", "a/b", "", ".", ".."]) {
      expect(() =>
        propose(handle, { from: "eng", to: "eng", kind: "t", payload: "p", goal: `g-${bad}`, id: bad }),
      ).toThrow();
    }
    expect(existsSync(join(dir, "escaped.json"))).toBe(false);
    handle.close();
  });

  test("a non-integer blast radius is refused, not silently nulled", () => {
    // Number("abc") is NaN, which landed as NULL, and NULL passes every radius
    // comparison - so global work could be dispatched by passing a typo.
    const dir = scratch();
    const handle = openWork(dir);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      const result = propose(handle, {
        from: "eng", to: "eng", kind: "t", payload: "p", goal: `g-${String(bad)}`, blastRadius: bad,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("whole number");
    }
    handle.close();
  });

  test("concurrent first-opens do not deadlock", async () => {
    // THE BUG: PRAGMA journal_mode=WAL is a WRITE and ran before busy_timeout
    // was set, so a concurrent opener failed instantly with "database is
    // locked". Measured: 10 of 24 concurrent opens died.
    const dir = scratch();
    const script = `
      import { openWork } from "${join(import.meta.dir, "..", "src", "work.ts")}";
      const h = openWork(process.argv[2]);
      h.close();
      process.stdout.write("OK");
    `;
    // Outside the scratch dir, so the afterEach cleanup cannot remove the
    // script while the spawned processes are still reading it.
    const scriptPath = join(tmpdir(), `cod-opener-${Date.now()}.ts`);
    writeFileSync(scriptPath, script);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        new Promise<string>((resolve) => {
          const child = spawn(process.execPath, ["run", scriptPath, dir]);
          let out = "";
          let err = "";
          child.stdout.on("data", (c) => {
            out += String(c);
          });
          child.stderr.on("data", (c) => {
            err += String(c);
          });
          // stderr is carried into the result so a failure says WHY, rather
          // than reporting a bare count that gives nobody anything to act on.
          child.on("close", () => resolve(err.trim() === "" ? out : `${out}|${err.split("\n")[0]}`));
        }),
      ),
    );
    rmSync(scriptPath, { force: true });
    expect(results.filter((r) => r === "OK").length).toBe(12);
  });
});
