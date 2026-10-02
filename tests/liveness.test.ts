/**
 * Liveness: telling a running schedule from a dead one.
 *
 * The property under test is that a dead supervisor can NEVER read as healthy.
 * Everything else is in service of that, which is why "never started" and
 * "started then died" are separate states rather than both being "not live" —
 * they need different fixes, and collapsing them costs an hour of guessing.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STALE_AFTER_MS, formatLiveness, heartbeatPath, readHeartbeat, supervisorLiveness, type Heartbeat, liveSince, type Liveness } from "../src/liveness";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "cod-live-"));
}

const beat = (over: Partial<Heartbeat> = {}): Heartbeat => ({
  runId: "abc123",
  startedAt: 1_700_000_000_000,
  seenAt: 1_700_000_000_000,
  jobs: ["nightly", "hourly"],
  maxConcurrent: 2,
  ...over,
});

function write(dir: string, heartbeat: Heartbeat): void {
  writeFileSync(heartbeatPath(dir), JSON.stringify(heartbeat), "utf8");
}

describe("readHeartbeat", () => {
  test("reads back what was written", () => {
    const dir = scratch();
    try {
      write(dir, beat());
      expect(readHeartbeat(dir)).toEqual(beat());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no heartbeat file means null", () => {
    const dir = scratch();
    try {
      expect(readHeartbeat(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a corrupt heartbeat reads as absent, never as live", () => {
    const dir = scratch();
    try {
      // A crash mid-write leaves a half-file. The safe direction is "absent":
      // absent reads as not-live, whereas a partial parse could read as live.
      writeFileSync(heartbeatPath(dir), '{"runId":"x","seenA', "utf8");
      expect(readHeartbeat(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("supervisorLiveness", () => {
  test("a fresh heartbeat is live", () => {
    const dir = scratch();
    try {
      const now = 1_700_000_000_000;
      write(dir, beat({ seenAt: now - 1000 }));
      const liveness = supervisorLiveness(dir, now);
      expect(liveness.state).toBe("live");
      expect(liveness.heartbeat?.jobs).toEqual(["nightly", "hourly"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no heartbeat is `never`, which is NOT the same as healthy", () => {
    const dir = scratch();
    try {
      expect(supervisorLiveness(dir, 1_700_000_000_000).state).toBe("never");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a heartbeat older than the threshold is stale", () => {
    const dir = scratch();
    try {
      const now = 1_700_000_000_000;
      write(dir, beat({ seenAt: now - STALE_AFTER_MS - 1000 }));
      expect(supervisorLiveness(dir, now).state).toBe("stale");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a heartbeat just inside the threshold is still live", () => {
    const dir = scratch();
    try {
      const now = 1_700_000_000_000;
      write(dir, beat({ seenAt: now - STALE_AFTER_MS + 5000 }));
      expect(supervisorLiveness(dir, now).state).toBe("live");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a heartbeat from the FUTURE reads as live rather than going negative", () => {
    const dir = scratch();
    try {
      // Clock skew between the container and the host must not produce a
      // negative age, and must not make a live supervisor look broken.
      const now = 1_700_000_000_000;
      write(dir, beat({ seenAt: now + 60_000 }));
      const liveness = supervisorLiveness(dir, now);
      expect(liveness.state).toBe("live");
      expect(liveness.ageMs).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("formatLiveness", () => {
  test("never reads as NOT RUNNING with the command to fix it", () => {
    const line = formatLiveness({ state: "never", heartbeat: null, ageMs: null });
    expect(line).toContain("NOT RUNNING");
    expect(line).toContain("cod up");
    // The single most important property: no wording here could be read as
    // "everything is fine".
    expect(line).not.toMatch(/live/i);
  });

  test("stale says the container is up but the schedule is not", () => {
    const line = formatLiveness({ state: "stale", heartbeat: beat(), ageMs: 200_000 });
    expect(line).toContain("STALE");
    expect(line).toContain("the container is up but the schedule is not running");
    expect(line).not.toMatch(/^supervisor: live/);
  });

  test("live names the jobs and the age", () => {
    const line = formatLiveness({ state: "live", heartbeat: beat(), ageMs: 5_000 });
    expect(line).toContain("live");
    expect(line).toContain("2 job(s)");
    expect(line).toContain("nightly, hourly");
    expect(line).toContain("5s ago");
  });

  test("a live supervisor with no jobs says none, not blank", () => {
    const line = formatLiveness({ state: "live", heartbeat: beat({ jobs: [] }), ageMs: 0 });
    expect(line).toContain("0 job(s)");
    expect(line).toContain("none");
  });
});

describe("live means live IN THIS container", () => {
  // Found by the dogfood run: `cod up` replaced a container and reported
  // "live (seen 15s ago)" - the OLD supervisor's heartbeat, still fresh on the
  // host, read before the new supervisor had written anything.
  const beat = (startedAt: number, seenAt: number): Liveness => ({
    state: "live",
    heartbeat: { runId: "r", startedAt, seenAt, jobs: [], maxConcurrent: 2 },
    ageMs: 0,
  });
  const containerStart = 1_000_000;

  test("a heartbeat from a supervisor that started after the container is live", () => {
    expect(liveSince(beat(containerStart + 500, containerStart + 900), containerStart)).toBe(true);
  });

  test("a fresh heartbeat from BEFORE the container started is not this container's", () => {
    expect(liveSince(beat(containerStart - 60_000, containerStart + 100), containerStart)).toBe(false);
  });

  test("a little clock disagreement is tolerated", () => {
    expect(liveSince(beat(containerStart - 1_000, containerStart), containerStart)).toBe(true);
  });

  test("with no known container start, it is the plain liveness check", () => {
    expect(liveSince(beat(0, 0), null)).toBe(true);
    expect(liveSince({ state: "never", heartbeat: null, ageMs: null }, null)).toBe(false);
  });

  test("the container's start time is read from docker, and the zero time is no time", async () => {
    const { makeDocker } = await import("../src/docker");
    const docker = (stdout: string) =>
      makeDocker({ runner: async () => ({ code: 0, stdout, stderr: "", truncated: false }) as never, timeoutMs: 1000 });
    const config = { workspaceFile: "/srv/one/cod.json" } as never;
    expect(await docker("2026-10-02T07:36:00.123456789Z\n").startedAt(config)).toBe(Date.parse("2026-10-02T07:36:00.123Z"));
    expect(await docker("0001-01-01T00:00:00Z\n").startedAt(config)).toBeNull();
  });
});
