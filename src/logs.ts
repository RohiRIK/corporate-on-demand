/**
 * Reading logs back.
 *
 * The other half of `src/log.ts`: writing events is only useful if something
 * can ask questions of them afterwards. Kept separate so the read path can be
 * tested without a logger and vice versa.
 *
 * Every read is bounded. A log directory that has been rotating for a month
 * holds far more than a terminal or a human wants, and an unbounded read is
 * how a debugging tool becomes the thing that exhausts memory.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { LogEvent, Level } from "./log";
import { join } from "node:path";

const SEVERITY: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Refuse to read more than this many files, whatever the caller asks for. */
export const MAX_LOG_FILES = 50;
/** Refuse to return more than this many events, whatever the caller asks for. */
export const MAX_EVENTS = 10_000;

export interface ReadOptions {
  /** Minimum level to return. Defaults to "debug" - return everything. */
  readonly level?: Level;
  /** Return only events carrying this runId. */
  readonly runId?: string;
  /** Return at most this many of the newest events. */
  readonly limit?: number;
}

/**
 * Every log file in a directory, newest first.
 *
 * Rotation names archives `cod.jsonl.1`, `cod.jsonl.2` and so on, where a
 * HIGHER number is OLDER. So newest-first is the active file, then `.1`, then
 * `.2`. A plain lexical sort would give exactly the wrong order.
 */
export function logFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "cod.jsonl" || /^cod\.jsonl\.\d+$/.test(entry)) names.push(entry);
  }
  // Numeric suffix, not lexical: ".10" sorts before ".2" as text.
  names.sort((a, b) => {
    const rank = (n: string): number => (n === "cod.jsonl" ? 0 : Number(n.split(".")[2]));
    return rank(a) - rank(b);
  });
  return names.slice(0, MAX_LOG_FILES).map((name) => join(dir, name));
}

/** Read events, newest first, filtered and bounded. */
export function readEvents(dir: string, options: ReadOptions = {}): LogEvent[] {
  const threshold = SEVERITY[options.level ?? "debug"];
  const limit = Math.min(options.limit ?? MAX_EVENTS, MAX_EVENTS);
  const events: LogEvent[] = [];

  // Newest file first, and within a file the last line is newest, so walk both
  // backwards and stop once the limit is met.
  for (const path of logFiles(dir)) {
    const lines = readFileSync(path, "utf8").split("\n").filter((line: string) => line !== "");
    for (let i = lines.length - 1; i >= 0 && events.length < limit; i -= 1) {
      const line = lines[i];
      if (line === undefined) continue;
      let event: LogEvent;
      try {
        event = JSON.parse(line) as LogEvent;
      } catch {
        // A truncated final line after a crash is expected, not worth failing a
        // read over. Skip it and keep everything else.
        continue;
      }
      if (SEVERITY[event.level] < threshold) continue;
      if (options.runId !== undefined && event.runId !== options.runId) continue;
      events.push(event);
    }
    if (events.length >= limit) break;
  }
  return events;
}

/** A one-line human rendering of an event. */
export function formatEvent(event: LogEvent): string {
  const time = new Date(event.ts).toISOString();
  const run = event.runId === undefined ? "" : ` [${event.runId}]`;
  const detail = event.fields === undefined ? "" : ` ${JSON.stringify(event.fields)}`;
  return `${time} ${event.level.toUpperCase().padEnd(5)}${run} ${event.msg}${detail}`;
}
