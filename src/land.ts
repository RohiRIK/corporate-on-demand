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
import { openWork, recordReview, latestReview, type WorkItem } from "./work";
import type { LandOutcome } from "./governance";

export interface LandOptions {
  readonly repo: string;
  readonly stateDir: string;
  /**
   * The shared repository to push landed work into, if the workspace named one.
   *
   * Undefined is the default and the common case: the merge stays in the
   * volume, exactly as it always has.
   */
  readonly landingRepo?: string;
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

/*
 * Everything that used to be a module-level Set - "already landed", "already
 * given its retry" - is now ONE ROW in the review table.
 *
 * They were Sets because they were convenient, and that was exactly the bug:
 * a Set is empty after every supervisor restart, so a rejected item lost its
 * protection on the next boot and was re-reviewed from scratch. A verdict
 * nothing recorded is a verdict nobody keeps.
 */



export async function landWork(repo: string, item: WorkItem, options: LandOptions): Promise<LandOutcome> {
  const branch = `cod/${item.id}`;

  // The durable guard. A landed or rejected item is not looked at again: the
  // old guard was a Set, and a Set is empty after a restart, which is how a
  // rejected item came back to life on every boot.
  const ledger = openWork(options.stateDir);
  const previous = latestReview(ledger, item.id);
  ledger.close();
  if (previous !== null && (previous.outcome === "landed" || previous.outcome === "rejected")) {
    return note(options, item, {
      outcome: "skipped",
      reason: `${branch} was already reviewed as ${previous.outcome}: ${previous.reason}`,
    });
  }

  // A retry is counted from the RECORD, not from `attempts`, which counts
  // dispatches and would grant a fresh retry every time.
  const alreadyRetried = previous?.outcome === "changes-requested";

  const diff = git(repo, ["diff", `master...${branch}`]);
  if (diff === null) {
    return note(options, item, { outcome: "skipped", reason: `no diff for ${branch}` });
  }
  if (diff === "") {
    // No changes is not a failure to review; it is nothing to land.
    return note(options, item, { outcome: "skipped", reason: `${branch} changed nothing` });
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
      return note(options, item, { outcome: "changes-requested", reason: verdict.reason });
    }
    return note(options, item, {
      outcome: "rejected",
      reason: changes ? `still not right after the one retry: ${verdict.reason}` : verdict.reason,
    });
  }

  // The merge itself. `-c` flags mean the repo's own config cannot redirect
  // this: a branch that could add a pre-merge hook would be a way to run code
  // in the CEO's hands.
  // Identity passed EXPLICITLY, alongside the hooks guard.
  //
  // The merge relied on whatever identity happened to be configured. That works
  // in the container, where the image sets one globally, and fails anywhere that
  // does not - which is exactly where CI runs, and the four failures there were
  // all `git merge failed` for this reason. Ambient identity is not a thing a
  // merge should depend on.
  const merged = git(repo, [
    "-c", "core.hooksPath=/dev/null",
    "-c", "user.name=cod",
    "-c", "user.email=cod@localhost",
    "merge", "--no-ff", "-m", `cod: land ${branch}`, branch,
  ]);
  if (merged === null) {
    return note(options, item, { outcome: "rejected", reason: `git merge failed for ${branch}` });
  }
  const sha = git(repo, ["rev-parse", "HEAD"]);

  // Push it somewhere it can be seen from outside, if the operator named a
  // place. A fixed ref rather than whatever HEAD points at, so a bad day in the
  // volume cannot redirect the push onto a branch nobody chose.
  if (options.landingRepo !== undefined) {
    const pushed = git(options.landingRepo, ["push", "origin", "HEAD:refs/heads/cod-landed"]);
    if (pushed === null) {
      // The merge already happened locally, so this is NOT rolled back and NOT
      // reported as a lost merge. The operator has to check the landing repo.
      return note(options, item, {
        outcome: "landed",
        branch,
        reason: `merged ${branch} into master, but could NOT push to ${options.landingRepo} - check that repository`,
      }, sha ?? "");
    }
  }

  return note(options, item, { outcome: "landed", branch, reason: `merged ${branch} into master` }, sha ?? "");
}

/**
 * Record a verdict before returning it.
 *
 * Every return path goes through here, which is the point: the bug was a path
 * that returned without recording, and a rejected item nobody records is an
 * item nobody skips.
 */
function note(options: LandOptions, item: WorkItem, outcome: LandOutcome, landedSha = ""): LandOutcome {
  const handle = openWork(options.stateDir);
  try {
    recordReview(handle, {
      workId: item.id,
      outcome: outcome.outcome,
      reason: outcome.reason,
      branch: `cod/${item.id}`,
      landedSha,
    });
  } finally {
    handle.close();
  }
  return outcome;
}

export { REVIEW_SKILL };
