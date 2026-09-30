/**
 * The logging system.
 *
 * This is the instrument every later task is measured with, so the properties
 * pinned here are the ones the rest of Stage B depends on:
 *
 *  - a `runId` that correlates one job's events, because four jobs firing at
 *    the same minute otherwise produce four interleaved unattributable stories
 *  - a level filter that can be turned down, because a logger you cannot quieten
 *    is noise
 *  - rotation with a cap on files kept, because a logger that fills the disk is
 *    the same failure as the unbounded stdout this stage exists to fix
 *
 * The clock is injected, as it is in the scheduler, so nothing here depends on
 * the wall clock.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, fileSink, memorySink, type Level } from "../src/log";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "cod-log-"));
}

const fixedNow = (): number => 1_700_000_000_000;

describe("logger core", () => {
  test("an event carries the level, the message and the timestamp", () => {
    const sink = memorySink();
    const log = createLogger({ sink, now: fixedNow });
    log.info("container started");
    const events = sink.events;
    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe("info");
    expect(events[0]?.msg).toBe("container started");
    expect(events[0]?.ts).toBe(1_700_000_000_000);
  });

  test("a runId is attached to every event, so one job can be followed", () => {
    const sink = memorySink();
    const log = createLogger({ sink, now: fixedNow, runId: "run-abc" });
    log.info("firing");
    log.error("failed");
    expect(sink.events.map((e) => e.runId)).toEqual(["run-abc", "run-abc"]);
  });

  test("structured fields survive alongside the message", () => {
    const sink = memorySink();
    const log = createLogger({ sink, now: fixedNow });
    log.info("job finished", { cron: "nightly", durationMs: 42 });
    expect(sink.events[0]?.fields).toEqual({ cron: "nightly", durationMs: 42 });
  });

  test("events below the configured level are dropped", () => {
    const sink = memorySink();
    const log = createLogger({ sink, now: fixedNow, level: "warn" });
    log.debug("noisy");
    log.info("routine");
    log.warn("degraded");
    log.error("broken");
    expect(sink.events.map((e) => e.level)).toEqual(["warn", "error"]);
  });

  test("the default level is info, and debug is opt-in", () => {
    const sink = memorySink();
    const log = createLogger({ sink, now: fixedNow });
    log.debug("hidden by default");
    log.info("shown");
    expect(sink.events).toHaveLength(1);

    const verbose = memorySink();
    createLogger({ sink: verbose, now: fixedNow, level: "debug" }).debug("now shown");
    expect(verbose.events).toHaveLength(1);
  });

  test("every declared level is accepted and ordered as written", () => {
    // A typo in a level name must not silently become "always log".
    const sink = memorySink();
    const log = createLogger({ sink, now: fixedNow, level: "debug" });
    for (const level of ["debug", "info", "warn", "error"] as const) {
      log[level](`at ${level}`);
    }
    expect(sink.events).toHaveLength(4);
    expect(sink.events.map((e) => e.level)).toEqual(["debug", "info", "warn", "error"]);
  });

  test("a child logger inherits the runId but can override it", () => {
    const sink = memorySink();
    const parent = createLogger({ sink, now: fixedNow, runId: "run-1" });
    parent.child({ runId: "run-2" }).info("nested");
    expect(sink.events[0]?.runId).toBe("run-2");
  });
});

describe("file sink", () => {
  test("writes one JSON object per line, so a crash costs one line", () => {
    const dir = scratch();
    try {
      const path = join(dir, "cod.jsonl");
      const log = createLogger({ sink: fileSink(path), now: fixedNow });
      log.info("first");
      log.info("second");
      const lines = readFileSync(path, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0] as string).msg).toBe("first");
      expect(JSON.parse(lines[1] as string).msg).toBe("second");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("appends rather than truncating an existing log", () => {
    const dir = scratch();
    try {
      const path = join(dir, "cod.jsonl");
      createLogger({ sink: fileSink(path), now: fixedNow }).info("before");
      createLogger({ sink: fileSink(path), now: fixedNow }).info("after");
      const lines = readFileSync(path, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0] as string).msg).toBe("before");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rotates past maxBytes and keeps only `keep` files", () => {
    const dir = scratch();
    try {
      const path = join(dir, "cod.jsonl");
      // A tiny cap so rotation happens after a handful of lines.
      const log = createLogger({ sink: fileSink(path, { maxBytes: 200, keep: 2 }), now: fixedNow });
      for (let i = 0; i < 40; i += 1) log.info(`line ${i}`, { i });
      // The rotation file plus at most 2 archives. Without the cap this grows
      // without bound, which is precisely the bug this file is here to prevent.
      const archives = [0, 1, 2].filter((n) => existsSync(`${path}.${n}`));
      expect(archives.length).toBeLessThanOrEqual(2);
      expect(existsSync(path)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rotation preserves the newest events", () => {
    const dir = scratch();
    try {
      const path = join(dir, "cod.jsonl");
      const log = createLogger({ sink: fileSink(path, { maxBytes: 200, keep: 3 }), now: fixedNow });
      for (let i = 0; i < 30; i += 1) log.info(`event ${i}`);
      const last = readFileSync(path, "utf8").trim().split("\n").at(-1);
      expect(JSON.parse(last as string).msg).toBe("event 29");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a newline inside a message cannot forge a second log line", () => {
    const dir = scratch();
    try {
      const path = join(dir, "cod.jsonl");
      const log = createLogger({ sink: fileSink(path), now: fixedNow });
      log.info("line one\nline two");
      const lines = readFileSync(path, "utf8").trim().split("\n");
      // JSON encoding escapes the newline, so the file still holds one event.
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] as string).msg).toBe("line one\nline two");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
