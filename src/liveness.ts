/**
 * Supervisor liveness.
 *
 * A `Bun.cron` schedule lives in the supervisor's memory. If the supervisor
 * dies while the container keeps running — which is the normal case, since the
 * container blocks in `tail -f` — the container is `up` and the schedule is
 * gone. Nothing about the container's state says so.
 *
 * That is the same class of failure this project has guarded against since the
 * `Bun.cron` version check: a scheduler that looks healthy while doing nothing.
 * One level up. The answer is the same — a heartbeat, and a reader that
 * distinguishes "live", "stale" and "never started" rather than collapsing them
 * into "container is up".
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Beyond this, a heartbeat is stale. Chosen to be several job intervals. */
export const STALE_AFTER_MS = 90_000;

export const HEARTBEAT_FILE = "supervisor.json";

export interface Heartbeat {
  readonly runId: string;
  readonly startedAt: number;
  /** Epoch ms of the most recent proof of life. */
  readonly seenAt: number;
  readonly jobs: readonly string[];
  readonly maxConcurrent: number;
  /** Whether agents run sandboxed, as the supervisor found it at startup. */
  readonly sandbox?: string;
}

export type Liveness =
  /** Heartbeat fresh: the supervisor is alive and these jobs are registered. */
  | { readonly state: "live"; readonly heartbeat: Heartbeat; readonly ageMs: number }
  /** Heartbeat exists but is older than the threshold: the supervisor died. */
  | { readonly state: "stale"; readonly heartbeat: Heartbeat; readonly ageMs: number }
  /** No heartbeat: the supervisor never started, or predates this feature. */
  | { readonly state: "never"; readonly heartbeat: null; readonly ageMs: null };

export function heartbeatPath(stateDir: string): string {
  return join(stateDir, HEARTBEAT_FILE);
}

export function readHeartbeat(stateDir: string): Heartbeat | null {
  const path = heartbeatPath(stateDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Heartbeat;
  } catch {
    // A half-written heartbeat from a crash mid-write. Treated as absent,
    // which is the safe direction: absent reads as "not live", never as live.
    return null;
  }
}

/**
 * Classify the supervisor.
 *
 * `never` and `stale` are deliberately distinct from anything the container
 * can say. "The container is up" and "the schedule is running" are different
 * claims, and `cod status` must not let the first imply the second.
 */
export function supervisorLiveness(stateDir: string, now: number = Date.now()): Liveness {
  const heartbeat = readHeartbeat(stateDir);
  if (heartbeat === null) return { state: "never", heartbeat: null, ageMs: null };
  const ageMs = Math.max(0, now - heartbeat.seenAt);
  if (ageMs > STALE_AFTER_MS) return { state: "stale", heartbeat, ageMs };
  return { state: "live", heartbeat, ageMs };
}

/** One line for a human. Never says healthy when it is not. */
export function formatLiveness(liveness: Liveness): string {
  if (liveness.state === "never") {
    return "supervisor: NOT RUNNING (no heartbeat - run `cod supervise`)";
  }
  const { heartbeat, ageMs } = liveness;
  const seconds = Math.round((ageMs ?? 0) / 1000);
  const jobs = heartbeat?.jobs.length ?? 0;
  const names = heartbeat?.jobs.join(", ") || "none";
  if (liveness.state === "stale") {
    return `supervisor: STALE (last seen ${seconds}s ago, ${jobs} job(s): ${names}) - the container is up but the schedule is not running`;
  }
  return `supervisor: live, ${jobs} job(s): ${names} (seen ${seconds}s ago)`;
}
