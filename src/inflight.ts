/**
 * In-flight job tracking.
 *
 * A job used to write its result on COMPLETION. If the supervisor died
 * mid-job, nothing was written, so "where did it stop" had no answer beyond the
 * last log line.
 *
 * The fix is the settled vocabulary from real schedulers rather than an
 * invention:
 *
 *   Temporal detects a crashed worker with a Start-To-Close timeout and relies
 *   on it to force a retry, because "the Temporal Server doesn't detect
 *   failures when a Worker loses communication with the Server or crashes".
 *   Celery's `task_track_started` exists because reporting a `started` state is
 *   "useful for long running tasks and there's a need to report what task is
 *   currently running".
 *
 * Both rest on the same principle: **absence of a result is the signal.** So a
 * job announces itself BEFORE it runs, and anything still announced after the
 * timeout was a casualty.
 *
 * This does not re-queue anything. Re-running work is a policy decision that has
 * not been made; what this provides is the fact you need to make it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redact } from "./redact";
import type { Cron } from "./workspace";

const DIRNAME = "inflight";

/**
 * How long a job may be in flight before it counts as abandoned.
 *
 * Comfortably longer than any legitimate job. Too short and every slow job looks
 * like a casualty; too long and a real crash is not noticed for minutes. This
 * value only affects *reporting*, never whether work actually runs.
 */
export const INFLIGHT_TIMEOUT_MS = 300_000;

export interface InFlight {
  readonly cron: string;
  readonly agent: string;
  readonly task: string;
  readonly startedAt: number;
}

export interface Abandoned extends InFlight {
  readonly stuckForMs: number;
  /** The marker's file name, so it can be archived once reported. */
  readonly marker?: string;
}

function dir(stateDir: string): string {
  return join(stateDir, DIRNAME);
}

/** A name that sorts chronologically, like the result files. */
function fileName(startedAt: number, cron: string): string {
  const safe = cron.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
  return `${String(startedAt).padStart(16, "0")}-${safe}.json`;
}

/**
 * Record a job as started. Call this BEFORE doing the work.
 *
 * A failure here is swallowed: a job that cannot write its marker should still
 * run, because a full disk must not be able to stop the schedule. The cost is
 * that this one job becomes untraceable, which is strictly better than not
 * running.
 */
export function beginJob(stateDir: string, cron: Cron, now: number = Date.now()): string | null {
  try {
    const path = dir(stateDir);
    mkdirSync(path, { recursive: true });
    const record: InFlight = {
      cron: cron.name,
      agent: cron.agent,
      // Redacted: this is a file on disk like a result, and the result beside
      // it has always redacted the same task text.
      task: redact(cron.task).text,
      startedAt: now,
    };
    const name = fileName(now, cron.name);
    writeFileSync(join(path, name), `${JSON.stringify(record)}\n`, "utf8");
    return name;
  } catch {
    // See above: untraceable beats not running. Null says "there is no marker
    // to settle later", which is the same fact, carried precisely.
    return null;
  }
}

/**
 * Remove a job's marker once it has finished, successfully or not.
 *
 * Takes the exact marker name returned by `beginJob`, not the cron's name.
 *
 * The earlier version searched the directory for any filename *containing* the
 * cron name and deleted the first match. That is wrong in a way that does not
 * announce itself: given crons named `build` and `build-docs` both in flight,
 * settling `build` deleted `build-docs`'s marker and left its own behind,
 * because readdir order decided the victim. The `build` job then stayed
 * "abandoned" for ever while `build-docs` lost the evidence it was still
 * running. Measured, not theoretical.
 *
 * Passing the exact name also settles two concurrent runs of the SAME cron
 * correctly, which a name search could never do.
 */
export function settleJob(stateDir: string, marker: string | null): void {
  // Null means beginJob could not write a marker, so there is nothing to
  // remove. That is a normal outcome, not an error.
  if (marker === null) return;
  try {
    const path = dir(stateDir);
    if (!existsSync(path)) return;
    unlinkSync(join(path, marker));
  } catch {
    // A marker left behind becomes an "abandoned" report for a job that
    // actually finished - noisy, not dangerous.
  }
}

/** Every job currently announced as in flight. */
export function claimInflight(stateDir: string): (InFlight & { readonly marker: string })[] {
  const path = dir(stateDir);
  if (!existsSync(path)) return [];
  const found: (InFlight & { readonly marker: string })[] = [];
  for (const name of readdirSync(path)) {
    if (!name.endsWith(".json")) continue;
    try {
      const record = JSON.parse(readFileSync(join(path, name), "utf8")) as InFlight;
      if (typeof record.cron === "string" && typeof record.startedAt === "number") {
        found.push({ ...record, marker: name });
      }
    } catch {
      // A half-written marker from a crash mid-write. Skip it: losing one entry
      // is better than losing the whole list.
    }
  }
  return found.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Jobs announced in flight but past the timeout: the ones a crash left behind.
 *
 * Reported, never silently re-run.
 */
export function findAbandoned(
  stateDir: string,
  now: number = Date.now(),
  timeoutMs: number = INFLIGHT_TIMEOUT_MS,
): Abandoned[] {
  // `>=` rather than `>`: with a zero timeout, a job whose start is exactly
  // `now` has been in flight for 0ms, which is already past the threshold. The
  // strict comparison made a zero timeout - a perfectly reasonable way to
  // inspect the whole set - silently return nothing.
  return claimInflight(stateDir)
    .filter((job) => now - job.startedAt >= timeoutMs)
    .map((job) => ({ ...job, stuckForMs: now - job.startedAt }));
}

/**
 * Mark a reported casualty as reported.
 *
 * Renamed, not deleted - the file is the evidence - and out of the `.json`
 * namespace, so it is never reported again. Before this, an abandoned marker
 * stayed for ever and every supervisor start after one crash re-announced the
 * same casualty, until the log was mostly old news.
 */
export function archiveAbandoned(stateDir: string, job: Abandoned): void {
  if (job.marker === undefined) return;
  try {
    renameSync(join(dir(stateDir), job.marker), join(dir(stateDir), `${job.marker}.abandoned`));
  } catch {
    // Already gone: nothing left to re-report.
  }
}

/** One line for a human. */
export function formatAbandoned(job: Abandoned): string {
  const seconds = Math.round(job.stuckForMs / 1000);
  return `"${job.cron}" (${job.agent}) was in flight for ${seconds}s and never finished - the supervisor died mid-job: ${job.task}`;
}
