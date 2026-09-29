/**
 * Structured logging.
 *
 * Stage B is about making the infrastructure trustworthy, and that is
 * impossible without a record of what happened. Today the supervisor writes
 * ad-hoc lines to stdout and the scheduler takes a bare `report` callback;
 * neither survives the container, and neither can be correlated.
 *
 * Three decisions that the rest of the stage depends on:
 *
 * 1. **JSON Lines.** One JSON object per line. Greppable by a human, readable
 *    by `jq`, and appendable — a crash mid-write costs one line rather than
 *    the file.
 *
 * 2. **A `runId` on every event.** Four jobs firing at the same minute produce
 *    four interleaved, unattributable stories without one. With it, `cod logs
 *    --run X` reconstructs one job's whole life.
 *
 * 3. **A `Sink` interface rather than a direct file write.** The container
 *    writes to a mounted file, tests capture in memory. A logger that hardcodes
 *    its destination forces every test to write to the real state directory,
 *    or to mock the logger — and both make the test lie about what happened.
 *
 * Rotation is not decoration. A logger that fills the disk is the same failure
 * as the unbounded subprocess output this stage exists to fix, so the file sink
 * caps both the file size and the number of archives kept.
 *
 * Redaction is deliberately NOT here yet. Job output is logged verbatim. Once
 * agents do real work, that becomes a place secrets can land, and redaction
 * turns from advisable to mandatory. Recorded in docs/SECURITY_POSTURE.md.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { redact } from "./redact";

export type Level = "debug" | "info" | "warn" | "error";

/** Ordered so a level filter is a comparison, not a lookup table. */
const SEVERITY: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogEvent {
  /** Epoch milliseconds. Injected so tests are deterministic. */
  readonly ts: number;
  readonly level: Level;
  readonly msg: string;
  /** Correlates every event belonging to one job or one command. */
  readonly runId?: string;
  /** Structured detail. Kept separate from `msg` so it stays queryable. */
  readonly fields?: Record<string, unknown>;
}

export interface Sink {
  write(event: LogEvent): void;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** A logger sharing this one's sink, level and clock, with its own runId. */
  child(options: { runId?: string }): Logger;
}

export interface LoggerOptions {
  readonly sink: Sink;
  /** Events below this are dropped. Defaults to "info". */
  readonly level?: Level;
  readonly runId?: string;
  /** Epoch milliseconds. Injected for deterministic tests. */
  readonly now?: () => number;
}

/**
 * A short random id, used when a run does not supply one.
 *
 * Not a UUID: it only has to be unique enough to tell two runs apart in one
 * log file, and it is generated once per process.
 */
export function newRunId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createLogger(options: LoggerOptions): Logger {
  const { sink, level = "info", runId, now = Date.now } = options;
  const threshold = SEVERITY[level];

  const emit = (eventLevel: Level, msg: string, fields?: Record<string, unknown>): void => {
    if (SEVERITY[eventLevel] < threshold) return;
    // JSON.stringify escapes newlines, so a multi-line message cannot forge an
    // extra line in a JSONL file.
    sink.write(
      runId === undefined
        ? { ts: now(), level: eventLevel, msg, ...(fields ? { fields } : {}) }
        : { ts: now(), level: eventLevel, msg, runId, ...(fields ? { fields } : {}) },
    );
  };

  return {
    debug: (msg, fields): void => void emit("debug", msg, fields),
    info: (msg, fields): void => void emit("info", msg, fields),
    warn: (msg, fields): void => void emit("warn", msg, fields),
    error: (msg, fields): void => void emit("error", msg, fields),
    child: (childOptions): Logger =>
      createLogger({ sink, level, now, runId: childOptions.runId ?? runId }),
  };
}

/**
 * A sink that redacts before anything is written.
 *
 * Redaction belongs HERE rather than at each call site. One place means a new
 * call site cannot forget, and forgetting once is all it takes to put a
 * credential on disk permanently.
 */
export function redactingSink(inner: Sink): Sink {
  return {
    write(event: LogEvent): void {
      const { text, counts } = redact(event.msg);
      if (Object.keys(counts).length > 0) {
        // The count is reported, never silently swallowed: a log that changes
        // under you without saying so is indistinguishable from a bug.
        const summary = Object.entries(counts)
          .map(([name, n]) => `${name} x${n}`)
          .join(", ");
        inner.write({
          ...event,
          msg: text,
          fields: { ...event.fields, redacted: summary },
          level: event.level === "info" ? "warn" : event.level,
        });
        return;
      }
      inner.write(event.msg === text ? event : { ...event, msg: text });
    },
  };
}

export function memorySink(): Sink & { readonly events: LogEvent[] } {
  const events: LogEvent[] = [];
  return {
    events,
    write(event: LogEvent): void {
      events.push(event);
    },
  };
}

export interface FileSinkOptions {
  /** Rotate once the active file reaches this size. Default 5 MB. */
  readonly maxBytes?: number;
  /** How many rotated archives to keep. Default 3. */
  readonly keep?: number;
}

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_KEEP = 3;

/**
 * Append JSONL to a file, rotating by size.
 *
 * Rotation renames the active file to `<path>.1`, shifting existing archives up
 * and discarding the oldest, so the total on disk is bounded by
 * `maxBytes * (keep + 1)`. That bound is the whole point: an unbounded log is
 * a disk-full incident waiting for a busy schedule.
 */
export function fileSink(path: string, options: FileSinkOptions = {}): Sink {
  return redactingSink(rawFileSink(path, options));
}

function rawFileSink(path: string, options: FileSinkOptions): Sink {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const keep = options.keep ?? DEFAULT_KEEP;
  mkdirSync(dirname(path), { recursive: true });

  return {
    write(event: LogEvent): void {
      const line = `${JSON.stringify(event)}\n`;

      if (existsSync(path) && statSync(path).size + line.length > maxBytes) {
        // Shift archives up, dropping the oldest past `keep`.
        rmSync(`${path}.${keep}`, { force: true });
        for (let n = keep - 1; n >= 1; n -= 1) {
          if (existsSync(`${path}.${n}`)) renameSync(`${path}.${n}`, `${path}.${n + 1}`);
        }
        renameSync(path, `${path}.1`);
      }

      appendFileSync(path, line, "utf8");
    },
  };
}
