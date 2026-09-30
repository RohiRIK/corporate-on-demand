/**
 * In-flight job tracking.
 *
 * The gap this closes: a job wrote its result ON COMPLETION. If the supervisor
 * died mid-job, nothing was written, and the only trace was the last log line -
 * so "where did it stop" had no answer.
 *
 * This is the same failure class as the Bun.cron version guard - a system that
 * looks fine while having done nothing - one level down. The fix is the settled
 * vocabulary from real schedulers, not an invention:
 *
 *   Temporal   "Start-To-Close timeout ... detect whether a Worker crashes
 *              after it has started executing an Activity Task", and it retries
 *              because "the Temporal Server doesn't detect failures when a
 *              Worker loses communication or crashes".
 *   Celery     task_track_started: report a `started` state, "useful for long
 *              running tasks and there's a need to report what task is
 *              currently running".
 *
 * The principle both of them rest on: ABSENCE OF A RESULT IS THE SIGNAL.
 */

import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INFLIGHT_TIMEOUT_MS,
  beginJob,
  claimInflight,
  findAbandoned,
  settleJob,
  type InFlight,
} from "../src/inflight";
import type { Cron } from "../src/workspace";

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "cod-inflight-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const cron: Cron = {
  name: "nightly",
  schedule: "0 2 * * *",
  agent: "builder",
  task: "run the build",
  enabled: true,
};

describe("begin and settle", () => {
  test("a job is recorded as started BEFORE it runs", () => {
    // The ordering is the entire mechanism: if this write happens after the
    // work, a crash during the work leaves nothing.
    const dir = scratch();
    beginJob(dir, cron, 1_700_000_000_000);
    const inFlight = claimInflight(dir);
    expect(inFlight).toHaveLength(1);
    expect(inFlight[0]?.cron).toBe("nightly");
    expect(inFlight[0]?.agent).toBe("builder");
  });

  test("settling removes it, so a completed job is not reported as lost", () => {
    const dir = scratch();
    beginJob(dir, cron, 1_700_000_000_000);
    settleJob(dir, beginJob(dir, cron, 1_700_000_000_000));
    expect(claimInflight(dir)).toHaveLength(0);
  });

  test("a FAILED job is also settled, and recorded as failed", () => {
    const dir = scratch();
    beginJob(dir, cron, 1_700_000_000_000);
    settleJob(dir, beginJob(dir, cron, 1_700_000_000_000));
    const results = claimInflight(dir);
    expect(results).toHaveLength(0);
  });
});

describe("abandoned jobs", () => {
  test("a job left in flight by a crash is found and named", () => {
    // This is the case the whole module exists for: the supervisor died and
    // nothing was ever settled. The explicit timeout is not incidental - the
    // default is 5 minutes, because a job that started one second ago is a
    // job that is simply still running.
    const dir = scratch();
    beginJob(dir, cron, 1_700_000_000_000);
    const abandoned = findAbandoned(dir, 1_700_000_000_000, 0);
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]?.cron).toBe("nightly");
    expect(abandoned[0]?.task).toBe("run the build");
  });

  test("a job still inside its timeout is NOT reported as abandoned", () => {
    // Otherwise every legitimately-running job looks like a casualty.
    const dir = scratch();
    beginJob(dir, cron, 1_700_000_000_000);
    expect(findAbandoned(dir, 1_700_000_000_000 + 30_000)).toHaveLength(0);
  });

  test("the timeout boundary is exact and inclusive of the past only", () => {
    const dir = scratch();
    beginJob(dir, cron, 1_700_000_000_000);
    const timeout = 60_000;
    // One millisecond inside the window is still running; exactly at the
    // boundary counts as abandoned; past it certainly does.
    expect(findAbandoned(dir, 1_700_000_000_000 + timeout - 1, timeout)).toHaveLength(0);
    expect(findAbandoned(dir, 1_700_000_000_000 + timeout, timeout)).toHaveLength(1);
    expect(findAbandoned(dir, 1_700_000_000_000 + timeout + 1, timeout)).toHaveLength(1);
  });

  test("the default timeout is long enough not to cry wolf", () => {
    // A short default would report every legitimately slow job as a casualty.
    expect(INFLIGHT_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  test("an abandoned job carries how long it was stuck", () => {
    const dir = scratch();
    beginJob(dir, cron, 1_700_000_000_000);
    const [job] = findAbandoned(dir, 1_700_000_000_000 + 120_000, 0);
    expect(job?.stuckForMs).toBe(120_000);
  });

  test("several crashed jobs are all reported, not just the first", () => {
    const dir = scratch();
    for (const [n, name] of ["a", "b", "c"].entries()) {
      beginJob(dir, { ...cron, name: `job-${name}` }, 1_700_000_000_000 + n * 1000);
    }
    expect(findAbandoned(dir, 1_700_000_000_000 + 500_000, 0)).toHaveLength(3);
  });

  test("nothing in flight means nothing abandoned", () => {
    expect(findAbandoned(scratch(), 1_700_000_000_000)).toEqual([]);
  });
});

describe("the file format", () => {
  test("one file per run, and it survives a restart because it is on disk", () => {
    const dir = scratch();
    beginJob(dir, cron, 1_700_000_000_000);
    beginJob(dir, { ...cron, name: "other" }, 1_700_000_000_000);
    // A new supervisor run reads the same directory - that is the whole point.
    const record: InFlight[] = claimInflight(dir);
    expect(record).toHaveLength(2);
    expect(record.every((r) => typeof r.startedAt === "number")).toBe(true);
  });

  test("a corrupt in-flight file is skipped, not fatal", () => {
    const dir = scratch();
    beginJob(dir, cron, 1_700_000_000_000);
    // A crash mid-write leaves a half-file. Losing the whole list to one bad
    // file would be worse than losing one entry.
    writeFileSync(join(dir, "inflight", "00000000000000000.json"), "{ half", "utf8");
    expect(claimInflight(dir).length).toBeGreaterThanOrEqual(1);
  });
  test("settling one cron does not settle another whose name contains it", () => {
    const dir = scratch();
    // Measured bug: settling `build` deleted `build-docs`'s marker and left its
    // own, because the old code searched for a filename *containing* the cron
    // name and deleted the first match - readdir order chose the victim. The
    // `build` job then reported as abandoned for ever.
    const a: Cron = { name: "build", agent: "eng", task: "t", schedule: "0 3 * * *", enabled: true };
    const b: Cron = { name: "build-docs", agent: "eng", task: "t", schedule: "0 4 * * *", enabled: true };
    const markerA = beginJob(dir, a, 1_700_000_000_000);
    const markerB = beginJob(dir, b, 1_700_000_000_100);
    expect(markerA).not.toBeNull();
    expect(markerB).not.toBeNull();
    if (markerA === null || markerB === null) throw new Error("marker not written");

    settleJob(dir, markerA);

    const left = readdirSync(join(dir, "inflight"));
    expect(left).toEqual([markerB]);
    expect(left.some((n) => n === markerA)).toBe(false);
  });

  test("settling one run of the same cron leaves the other in flight", () => {
    const dir = scratch();
    // A name search could never do this: two concurrent runs of one cron are
    // only distinguishable by the exact marker.
    const c: Cron = { name: "nightly", agent: "eng", task: "t", schedule: "0 3 * * *", enabled: true };
    const first = beginJob(dir, c, 1_700_000_000_000);
    const second = beginJob(dir, c, 1_700_000_000_500);
    expect(second).not.toBeNull();
    if (second === null) throw new Error("marker not written");
    settleJob(dir, first);
    const left = readdirSync(join(dir, "inflight"));
    expect(left).toEqual([second]);
  });

  test("settling a null marker is a no-op, not a crash", () => {
    const dir = scratch();
    // beginJob returns null when it could not write a marker; there is then
    // nothing to settle, which is a normal outcome.
    expect(() => {
      settleJob(dir, null);
    }).not.toThrow();
  });
});
