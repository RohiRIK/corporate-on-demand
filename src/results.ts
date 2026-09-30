/**
 * Persisted job results.
 *
 * The log answers "what did the supervisor say". This answers "what ran, when,
 * and did it work" — as data you can query, count and script against, after the
 * container that produced it is gone.
 *
 * One file per run, never an appended array. An append-only file grows without
 * bound, and the unbounded-growth failure is exactly what Stage B exists to
 * remove from the subprocess path; it has no business being reintroduced here.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redact } from "./redact";
import type { Cron } from "./workspace";

export interface JobResult {
  readonly cron: string;
  readonly agent: string;
  readonly task: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly output: string;
  /** Present when `ok` is false. */
  readonly error?: string;
  /** The branch the job worked on. */
  readonly branch?: string;
  /** The files it changed, so the owner need not open a diff to learn that. */
  readonly changedFiles?: readonly string[];
  /** How many commits it made. */
  readonly commitCount?: number;
  /** The blast radius the job ran under. */
  readonly blastRadius?: number;
  /** Why a change was refused, when one was. */
  readonly refused?: string;
}

/** Never read more than this many result files, whatever the caller asks for. */
export const MAX_RESULT_FILES = 200;
/** Never return more than this many results, whatever the caller asks for. */
export const MAX_RESULTS = 200;

const RESULTS_DIRNAME = "results";

export function resultsDir(stateDir: string): string {
  return join(stateDir, RESULTS_DIRNAME);
}

/**
 * A filename that sorts chronologically.
 *
 * The timestamp is zero-padded and the run counter disambiguates two runs
 * inside the same millisecond, which happens when several jobs fire on the same
 * minute boundary. Without it, one run would overwrite another.
 */
function fileNameFor(startedAt: number, seq: number): string {
  return `${String(startedAt).padStart(16, "0")}-${String(seq).padStart(3, "0")}.json`;
}

export interface RecordOptions {
  /** The state directory. Results go under `<stateDir>/results`. */
  readonly stateDir: string;
  /** Disambiguates runs within the same millisecond. */
  readonly seq?: number;
}

/**
 * Write one result and return its path.
 *
 * A failure here is reported by the caller rather than thrown: a result that
 * cannot be persisted must not be able to kill the job that produced it, or a
 * full disk would silently stop the schedule.
 */
export function recordResult(result: JobResult, options: RecordOptions): string | null {
  try {
    const dir = resultsDir(options.stateDir);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, fileNameFor(result.startedAt, options.seq ?? 0));
    // Every free-text field is redacted, not just `output`. An earlier version
    // redacted output only, and a secret in the TASK text was written verbatim
    // to the result file while the log right next to it said [REDACTED] - two
    // files telling opposite stories about the same run.
    //
    // `cod.json` itself is NOT rewritten: it is the operator's own input file,
    // and silently editing what someone wrote is worse than leaving it alone.
    // That is why the clean-room check greps the state directory, not the
    // workspace file.
    const safe: JobResult = {
      ...result,
      task: redact(result.task).text,
      output: redact(result.output).text,
      ...(result.error === undefined ? {} : { error: redact(result.error).text }),
    };
    writeFileSync(path, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
    return path;
  } catch {
    return null;
  }
}

export interface ListOptions {
  readonly limit?: number;
  readonly cron?: string;
  readonly onlyFailed?: boolean;
}

/** Read results, newest first. Bounded on every axis. */
export function listResults(stateDir: string, options: ListOptions = {}): JobResult[] {
  const dir = resultsDir(stateDir);
  if (!existsSync(dir)) return [];
  const limit = Math.min(options.limit ?? MAX_RESULTS, MAX_RESULTS);

  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    // The padded timestamp prefix means lexical order IS chronological order.
    .sort()
    .reverse()
    .slice(0, Math.min(MAX_RESULT_FILES, Math.max(limit * 4, limit)));

  const results: JobResult[] = [];
  for (const name of names) {
    if (results.length >= limit) break;
    let parsed: JobResult;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as JobResult;
    } catch {
      // A half-written file from a crash mid-write. Skip it; the run it
      // describes is already lost and one unreadable file must not hide the
      // rest of the history.
      continue;
    }
    if (options.cron !== undefined && parsed.cron !== options.cron) continue;
    if (options.onlyFailed === true && parsed.ok) continue;
    results.push(parsed);
  }
  return results;
}

/**
 * Delete the oldest results beyond `keepLast`, and report what went.
 *
 * One file per run means an unbounded directory: a job every minute is 525,600
 * files a year. Pruning is REPORTED rather than silent — silent deletion of
 * data is its own surprise, and "why did my result disappear" needs an answer
 * in the log rather than a guess.
 *
 * Unparseable files are never pruned. They are already unreadable, and
 * deleting them would destroy the evidence of whatever wrote them badly.
 */
export function pruneResults(
  stateDir: string,
  keepLast: number,
): { readonly removed: number; readonly remaining: number } {
  const dir = resultsDir(stateDir);
  if (!existsSync(dir)) return { removed: 0, remaining: 0 };
  const keep = Math.max(1, Math.floor(keepLast));
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();
  if (names.length <= keep) return { removed: 0, remaining: names.length };

  let removed = 0;
  for (const name of names.slice(keep)) {
    const path = join(dir, name);
    // Only remove a file that is actually a result, so a hand-placed note or a
    // half-written file is never the thing that disappears.
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<JobResult>;
      if (typeof parsed.cron !== "string" || typeof parsed.startedAt !== "number") continue;
    } catch {
      continue;
    }
    try {
      unlinkSync(path);
      removed += 1;
    } catch {
      // A file we cannot delete is not a reason to stop pruning the rest.
    }
  }
  return { removed, remaining: names.length - removed };
}

/** A one-line human rendering. */
export function formatResult(result: JobResult): string {
  const when = new Date(result.startedAt).toISOString();
  const status = result.ok ? "ok  " : "FAIL";
  // What CHANGED, on the same line as what ran.
  //
  // Not decoration. Looking at the computer is the owner's ONLY interface with
  // this system, so "which files did they touch" has to be visible without
  // opening a diff or piping through jq. A refusal is called out here rather
  // than only in the log, because a refusal the owner cannot see is a refusal
  // that looks like success.
  const changed = result.changedFiles ?? [];
  const change =
    changed.length === 0
      ? ""
      : `  [${changed.length} file${changed.length === 1 ? "" : "s"}: ${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ", …" : ""}]`;
  const radius = result.blastRadius === undefined ? "" : ` r${result.blastRadius}`;
  const refused = result.refused === undefined ? "" : `  REFUSED: ${result.refused}`;
  return `${when} ${status} ${result.cron.padEnd(16)} ${result.durationMs}ms${radius}${change}${refused}  ${result.agent}: ${result.task}`;
}
