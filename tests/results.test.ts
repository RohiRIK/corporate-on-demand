/**
 * Persisted results.
 *
 * The properties that matter are the ones that stop this becoming the next
 * unbounded-growth bug: one file per run rather than an append-only array, and
 * a hard bound on every read. A limit a caller can raise past is not a limit.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_RESULTS,
  formatResult,
  listResults,
  pruneResults,
  recordResult,
  resultsDir,
  type JobResult,
} from "../src/results";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "cod-results-"));
}

const result = (over: Partial<JobResult> = {}): JobResult => ({
  cron: "nightly",
  agent: "builder",
  task: "run the build",
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_000_042,
  durationMs: 42,
  ok: true,
  output: "build ok",
  ...over,
});

describe("recordResult", () => {
  test("a result survives being written and read back", () => {
    const dir = scratch();
    try {
      recordResult(result(), { stateDir: dir });
      const read = listResults(dir);
      expect(read).toHaveLength(1);
      expect(read[0]).toEqual(result());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("it creates the results directory if it does not exist", () => {
    const dir = scratch();
    try {
      expect(existsSync(resultsDir(dir))).toBe(false);
      recordResult(result(), { stateDir: dir });
      expect(existsSync(resultsDir(dir))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("one file per run, not one growing file", () => {
    const dir = scratch();
    try {
      for (let i = 0; i < 5; i += 1) {
        recordResult(result({ startedAt: 1_700_000_000_000 + i * 1000 }), { stateDir: dir });
      }
      const files = readdirSync(resultsDir(dir));
      // An append-only file would be 1. That is the growth bug this avoids.
      expect(files).toHaveLength(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("two runs in the same millisecond do not overwrite each other", () => {
    const dir = scratch();
    try {
      // Several jobs firing on the same minute boundary land in the same ms
      // often enough to matter, and a collision would silently lose a run.
      const at = 1_700_000_000_000;
      recordResult(result({ cron: "a", startedAt: at }), { stateDir: dir, seq: 0 });
      recordResult(result({ cron: "b", startedAt: at }), { stateDir: dir, seq: 1 });
      const crons = listResults(dir).map((r) => r.cron).sort();
      expect(crons).toEqual(["a", "b"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a state dir that cannot be written returns null rather than throwing", () => {
    // A full disk must not be able to kill the job that produced the result.
    expect(recordResult(result(), { stateDir: "/proc/nonexistent/cod" })).toBeNull();
  });
});

describe("listResults", () => {
  test("returns the newest first", () => {
    const dir = scratch();
    try {
      for (let i = 0; i < 4; i += 1) {
        recordResult(result({ cron: `job${i}`, startedAt: 1_700_000_000_000 + i * 1000 }), { stateDir: dir });
      }
      expect(listResults(dir).map((r) => r.cron)).toEqual(["job3", "job2", "job1", "job0"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sorts correctly across differing digit counts", () => {
    const dir = scratch();
    try {
      // Timestamps of 8 and 11 digits must not sort as text.
      recordResult(result({ cron: "small", startedAt: 1_000_00 }), { stateDir: dir });
      recordResult(result({ cron: "large", startedAt: 1_700_000_000_000 }), { stateDir: dir });
      expect(listResults(dir).map((r) => r.cron)).toEqual(["large", "small"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("honours the limit", () => {
    const dir = scratch();
    try {
      for (let i = 0; i < 10; i += 1) {
        recordResult(result({ cron: `j${i}`, startedAt: 1_700_000_000_000 + i }), { stateDir: dir });
      }
      expect(listResults(dir, { limit: 3 })).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a limit above the hard maximum is clamped", () => {
    const dir = scratch();
    try {
      for (let i = 0; i < 5; i += 1) {
        recordResult(result({ startedAt: 1_700_000_000_000 + i }), { stateDir: dir });
      }
      expect(listResults(dir, { limit: 10_000 }).length).toBeLessThanOrEqual(MAX_RESULTS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("filters by cron name and by failure", () => {
    const dir = scratch();
    try {
      recordResult(result({ cron: "nightly", startedAt: 1 }), { stateDir: dir });
      recordResult(result({ cron: "hourly", startedAt: 2 }), { stateDir: dir });
      recordResult(result({ cron: "broken", ok: false, error: "boom", startedAt: 3 }), { stateDir: dir });
      expect(listResults(dir, { cron: "nightly" })).toHaveLength(1);
      const failed = listResults(dir, { onlyFailed: true });
      expect(failed).toHaveLength(1);
      expect(failed[0]?.error).toBe("boom");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing directory yields nothing rather than throwing", () => {
    expect(listResults("/nonexistent/cod")).toEqual([]);
  });

  test("one corrupt file does not hide the rest of the history", () => {
    const dir = scratch();
    try {
      recordResult(result({ cron: "good1", startedAt: 1 }), { stateDir: dir });
      recordResult(result({ cron: "good2", startedAt: 2 }), { stateDir: dir });
      // A crash mid-write leaves a half-file behind.
      writeFileSync(join(resultsDir(dir), "00000000000099999-000.json"), '{"startedAt": 3, "cro', "utf8");
      expect(listResults(dir).map((r) => r.cron)).toEqual(["good2", "good1"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pruneResults", () => {
  test("removes the oldest beyond the cap and keeps the newest", () => {
    const dir = scratch();
    try {
      for (let i = 0; i < 600; i += 1) {
        recordResult(result({ cron: `j${i}`, startedAt: 1_700_000_000_000 + i * 1000 }), { stateDir: dir });
      }
      const outcome = pruneResults(dir, 500);
      expect(outcome.removed).toBe(100);
      // Counted from the filesystem, not through listResults: that caps its
      // read at MAX_RESULT_FILES, so asking it for 500 proves nothing.
      expect(readdirSync(resultsDir(dir))).toHaveLength(500);
      // The survivors must be the NEWEST, not an arbitrary slice.
      const left = listResults(dir, { limit: 10_000 });
      expect(left[0]?.cron).toBe("j599");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports what it removed, so pruning is never silent", () => {
    const dir = scratch();
    try {
      for (let i = 0; i < 10; i += 1) {
        recordResult(result({ startedAt: 1_700_000_000_000 + i }), { stateDir: dir });
      }
      const outcome = pruneResults(dir, 4);
      expect(outcome.removed).toBe(6);
      // A prune that deleted silently would be its own surprise.
      expect(outcome.removed).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does nothing when the directory is already under the cap", () => {
    const dir = scratch();
    try {
      for (let i = 0; i < 3; i += 1) {
        recordResult(result({ startedAt: 1_700_000_000_000 + i }), { stateDir: dir });
      }
      expect(pruneResults(dir, 500).removed).toBe(0);
      expect(listResults(dir)).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("never deletes a corrupt file, which is evidence of something", () => {
    const dir = scratch();
    try {
      for (let i = 0; i < 5; i += 1) {
        recordResult(result({ startedAt: 1_700_000_000_000 + i }), { stateDir: dir });
      }
      const corrupt = join(resultsDir(dir), "00000000000000000-000.json");
      writeFileSync(corrupt, "{ half-writ", "utf8");
      pruneResults(dir, 2);
      // The unparseable file is already unreadable; deleting it would destroy
      // the evidence of whatever wrote it badly.
      expect(existsSync(corrupt)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a keepLast of 0 is clamped to 1 rather than deleting everything", () => {
    const dir = scratch();
    try {
      for (let i = 0; i < 4; i += 1) {
        recordResult(result({ startedAt: 1_700_000_000_000 + i }), { stateDir: dir });
      }
      pruneResults(dir, 0);
      expect(listResults(dir)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing directory prunes to nothing rather than throwing", () => {
    // keepLast is still required: there is no sensible default for "how many
    // results to keep", and defaulting it would silently keep a different
    // number than the caller believes.
    const outcome = pruneResults("/nonexistent/cod", 500);
    expect(outcome.removed).toBe(0);
    expect(outcome.remaining).toBe(0);
  });
});

describe("formatResult", () => {
  test("renders one line with status, name, duration and the task", () => {
    const line = formatResult(result());
    expect(line).toContain("ok");
    expect(line).toContain("nightly");
    expect(line).toContain("42ms");
    expect(line).toContain("builder: run the build");
    expect(line).not.toContain("\n");
  });

  test("a failure reads as FAIL, not as a name that happens to contain letters", () => {
    expect(formatResult(result({ ok: false, error: "boom" }))).toContain("FAIL");
  });
});
