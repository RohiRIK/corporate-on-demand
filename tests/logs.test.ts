/**
 * Reading logs back.
 *
 * The ordering test here is the important one. Rotation names archives
 * `cod.jsonl.1`, `cod.jsonl.2`, ..., where a HIGHER number is OLDER. A lexical
 * sort gets that exactly backwards, and a log tool that reports events in the
 * wrong order is worse than one that reports none.
 */

import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_EVENTS, formatEvent, logFiles, readEvents } from "../src/logs";
import type { LogEvent } from "../src/log";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "cod-logs-"));
}

const event = (over: Partial<LogEvent> = {}): string =>
  `${JSON.stringify({
    ts: 1_700_000_000_000,
    level: "info",
    msg: "hello",
    ...over,
  } satisfies LogEvent)}\n`;

describe("logFiles ordering", () => {
  test("returns the active file first, then archives oldest-last", () => {
    const dir = scratch();
    try {
      for (const name of ["cod.jsonl.3", "cod.jsonl.1", "cod.jsonl.10", "cod.jsonl.2"]) {
        appendFileSync(join(dir, name), "");
      }
      appendFileSync(join(dir, "cod.jsonl"), "");
      const order = logFiles(dir).map((p) => p.slice(p.lastIndexOf("/") + 1));
      // ".10" must sort as ten, not as text before ".2".
      expect(order).toEqual(["cod.jsonl", "cod.jsonl.1", "cod.jsonl.2", "cod.jsonl.3", "cod.jsonl.10"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing log directory yields nothing rather than throwing", () => {
    expect(logFiles("/nonexistent/cod/logs")).toEqual([]);
    expect(readEvents("/nonexistent/cod/logs")).toEqual([]);
  });
});

describe("readEvents", () => {
  test("returns the newest events first", () => {
    const dir = scratch();
    try {
      appendFileSync(join(dir, "cod.jsonl"), event({ msg: "a" }) + event({ msg: "b" }) + event({ msg: "c" }));
      expect(readEvents(dir).map((e) => e.msg)).toEqual(["c", "b", "a"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("continues into rotated archives, newest archive first", () => {
    const dir = scratch();
    try {
      appendFileSync(join(dir, "cod.jsonl.1"), event({ msg: "oldest" }));
      appendFileSync(join(dir, "cod.jsonl"), event({ msg: "newer" }));
      expect(readEvents(dir).map((e) => e.msg)).toEqual(["newer", "oldest"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("filters by level", () => {
    const dir = scratch();
    try {
      appendFileSync(
        join(dir, "cod.jsonl"),
        event({ msg: "chatty", level: "debug" }) + event({ msg: "routine" }) + event({ msg: "broken", level: "error" }),
      );
      expect(readEvents(dir, { level: "warn" }).map((e) => e.msg)).toEqual(["broken"]);
      expect(readEvents(dir).map((e) => e.msg)).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("filters by runId, which is how one job is followed", () => {
    const dir = scratch();
    try {
      appendFileSync(
        join(dir, "cod.jsonl"),
        event({ msg: "job1 start", runId: "r1" }) +
          event({ msg: "job2 start", runId: "r2" }) +
          event({ msg: "job1 end", runId: "r1" }),
      );
      expect(readEvents(dir, { runId: "r1" }).map((e) => e.msg)).toEqual(["job1 end", "job1 start"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("honours the limit", () => {
    const dir = scratch();
    try {
      let body = "";
      for (let i = 0; i < 20; i += 1) body += event({ msg: `e${i}` });
      appendFileSync(join(dir, "cod.jsonl"), body);
      expect(readEvents(dir, { limit: 3 }).map((e) => e.msg)).toEqual(["e19", "e18", "e17"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a limit above the hard maximum is clamped, not honoured", () => {
    const dir = scratch();
    try {
      let body = "";
      for (let i = 0; i < 50; i += 1) body += event({ msg: `e${i}` });
      appendFileSync(join(dir, "cod.jsonl"), body);
      // A caller asking for a million events must not be able to make the
      // process read a million events.
      expect(readEvents(dir, { limit: 1_000_000 })).toHaveLength(50);
      expect(readEvents(dir, { limit: 1_000_000 }).length).toBeLessThanOrEqual(MAX_EVENTS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a truncated final line is skipped, not fatal", () => {
    const dir = scratch();
    try {
      // What a crash mid-write actually leaves behind.
      appendFileSync(join(dir, "cod.jsonl"), event({ msg: "complete" }) + '{"ts":1,"level":"inf');
      const events = readEvents(dir);
      expect(events).toHaveLength(1);
      expect(events[0]?.msg).toBe("complete");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an empty log file yields no events", () => {
    const dir = scratch();
    try {
      appendFileSync(join(dir, "cod.jsonl"), "");
      expect(readEvents(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("formatEvent", () => {
  test("renders timestamp, level, runId, message and fields on one line", () => {
    const line = formatEvent({
      ts: 1_700_000_000_000,
      level: "warn",
      msg: "output truncated",
      runId: "r9",
      fields: { bytes: 4194304 },
    });
    expect(line).toContain("WARN");
    expect(line).toContain("[r9]");
    expect(line).toContain("output truncated");
    expect(line).toContain('"bytes":4194304');
    expect(line).not.toContain("\n");
  });

  test("omits the runId when there is none", () => {
    const line = formatEvent({ ts: 1_700_000_000_000, level: "info", msg: "plain" });
    expect(line).toBe("2023-11-14T22:13:20.000Z INFO  plain");
  });
});
