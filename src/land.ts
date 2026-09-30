/**
 * Reviewing a finished branch and landing it.
 *
 * The only place in this codebase that merges anything. Everything else runs
 * agents; this runs git, and it is gated twice - once by the mechanical checks,
 * which no model may override, and once by the radius.
 *
 * **The retry lives here and only here.** A `request-changes` verdict puts the
 * item back to `ready` with the reviewer's words as its brief, once. After that
 * it is left alone: a company that argues with a reviewer forever is a company
 * that never converges, and one retry is the whole policy.
 *
 * A merge is not idempotent by accident, so `landedBranches` remembers what has
 * already gone in for the life of the process.
 */

import { execFileSync } from "node:child_process";
import { judgeReview, mechanicalChecks, canMerge, REVIEW_SKILL } from "./review";
import { openWork, type WorkItem } from "./work";
import type { LandOutcome } from "./governance";

export interface LandOptions {
  readonly repo: string;
  readonly stateDir: string;
  /** Asks the model. Injected so this is testable without a provider. */
  readonly ask: (prompt: string) => Promise<string>;
  readonly maxRetries?: number;
}

function git(repo: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Branches already merged in this process. A merge is not idempotent. */
const landedBranches = new Set<string>();

/**
 * Branches already given their one review retry.
 *
 * Process-scoped, and keyed on the branch rather than on the item's `attempts`
 * counter. That counter counts DISPATCHES, not review rounds: it is 0 until a
 * job runs, so guarding on it meant a review request was granted a fresh retry
 * every time - a company arguing with a reviewer for ever, which is the exact
 * failure the one-retry policy exists to prevent. Caught by the test that
 * re-reviews the same branch twice.
 */
const retriedBranches = new Set<string>();

export async function landWork(repo: string, item: WorkItem, options: LandOptions): Promise<LandOutcome> {
  const branch = `cod/${item.id}`;
  if (landedBranches.has(branch)) return { outcome: "skipped", reason: `${branch} was already landed` };

  const diff = git(repo, ["diff", `master...${branch}`]);
  if (diff === null) {
    return { outcome: "skipped", reason: `no diff for ${branch}` };
  }
  if (diff === "") {
    // No changes is not a failure to review; it is nothing to land.
    return { outcome: "skipped", reason: `${branch} changed nothing` };
  }

  const verdict = await judgeReview({
    diff,
    task: item.payload,
    mechanical: mechanicalChecks(diff),
    ask: options.ask,
  });

  const radius = item.blast_radius ?? 0;
  if (!canMerge(verdict, radius)) {
    const changes = verdict.outcome === "request-changes";
    const alreadyRetried = retriedBranches.has(branch);
    if (changes && !alreadyRetried && (options.maxRetries ?? 1) > 0) {
      // THE ONE RETRY, with the review as the brief. Recorded on the item, so
      // the next attempt carries the reviewer's words rather than starting over.
      const handle = openWork(options.stateDir);
      try {
        // `commit` only accepts done|failed - both terminal. A retry is not
        // terminal, so it is released rather than committed: cleared lease, no
        // epoch bump, and the reviewer's words kept as the reason so the next
        // attempt is briefed by them.
        // `release` clears the lease and bumps the epoch WITHOUT changing state,
        // so the item stays `done`-shaped for the tick's filter while no stale
        // run can ever commit against it again.
        handle.db.query("UPDATE work SET lease_owner = NULL, lease_epoch = lease_epoch + 1, reason = ? WHERE id = ?")
          .run(`review: ${verdict.reason}`, item.id);
        handle.db.query("UPDATE work SET state = 'ready' WHERE id = ?").run(item.id);
      } finally {
        handle.close();
      }
      retriedBranches.add(branch);
      return { outcome: "changes-requested", reason: verdict.reason };
    }
    return {
      outcome: "rejected",
      reason: changes ? `still not right after the one retry: ${verdict.reason}` : verdict.reason,
    };
  }

  // The merge itself. `-c` flags mean the repo's own config cannot redirect
  // this: a branch that could add a pre-merge hook would be a way to run code
  // in the CEO's hands.
  const merged = git(repo, [
    "-c", "core.hooksPath=/dev/null",
    "merge", "--no-ff", "-m", `cod: land ${branch}`, branch,
  ]);
  if (merged === null) {
    return { outcome: "rejected", reason: `git merge failed for ${branch}` };
  }
  landedBranches.add(branch);
  return { outcome: "landed", branch, reason: `merged ${branch} into master` };
}

export { REVIEW_SKILL };
