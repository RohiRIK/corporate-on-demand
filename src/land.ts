/**
 * Reviewing a finished branch and landing it.
 *
 * The only place in this codebase that merges anything. Everything else runs
 * agents; this runs git, and it is gated twice - once by the mechanical checks,
 * which no model may override, and once by the radius.
 *
 * **The retry lives here and only here.** A `request-changes` verdict puts the
 * item back to `ready` with the reviewer's words as its brief, up to
 * DEFAULT_MAX_RETRIES times; every objection accumulates so a later attempt sees
 * the earlier ones too. The count is durable, so a restart cannot reset the cap
 * into an endless loop.
 *
 * The earlier version of this comment claimed the retry was "briefed by the
 * reviewer's words". It was not - nothing read `work.reason`, and the brief came
 * from the payload alone, so a retry re-ran the identical prompt. The comment
 * was true for about one commit. `briefFor` in src/runwork.ts is what makes it
 * true.
 *
 * A MECHANICAL finding is never retried at any cap: judgeReview returns before
 * it asks the model, because a global path is a rule rather than an opinion.
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

/**
 * Three, not one.
 *
 * One retry with an UNBRIEFED agent was a coin flip, so it was never worth more
 * than one. The brief is real now - the agent is handed the reviewer's actual
 * objection - so the retries are worth spending.
 *
 * Still bounded on purpose. An unbounded loop is a company that argues for ever
 * and never converges, and it spends a free model call on each pass. An operator
 * who wants fewer sets `governance.maxReviewRetries`; zero means the first
 * objection is final.
 */
export const DEFAULT_MAX_RETRIES = 3;

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
  // How many times this has already been sent back, from the RECORD.
  //
  // This was a boolean, and a boolean cannot count - so maxRetries above 1 was
  // inert no matter what it was set to. Every value except 1 was decoration.
  // Durable for the same reason the landed/rejected guard is: a module-level
  // counter is zero after every restart.
  const attemptsSoFar = previous?.outcome === "changes-requested" ? (previous.attempts ?? 1) : 0;

  const diff = git(repo, ["diff", `master...${branch}`]);
  if (diff === null) {
    return note(options, item, { outcome: "skipped", reason: `no diff for ${branch}` });
  }
  if (diff === "") {
    // No changes is not a failure to review; it is nothing to land.
    return note(options, item, { outcome: "skipped", reason: `${branch} changed nothing` });
  }

  const mechanical = mechanicalChecks(diff);

  // A mechanical finding is terminal BEFORE the model is asked, whatever the
  // retry cap is - a global path is a rule, not an opinion, and looping it
  // invites the worker to argue with a deterministic check.
  //
  // That guarantee lives in judgeReview, which returns `reject` without ever
  // calling `ask`. It was duplicated here first, and mutation testing is what
  // proved the copy was dead: deleting this early return changed no test, while
  // deleting the one inside judgeReview broke three. One implementation of a
  // rule, in the place that owns it.
  const verdict = await judgeReview({ diff, task: item.payload, mechanical, ask: options.ask });

  const radius = item.blast_radius ?? 0;
  if (!canMerge(verdict, radius)) {
    const changes = verdict.outcome === "request-changes";
    if (changes && attemptsSoFar < (options.maxRetries ?? DEFAULT_MAX_RETRIES)) {
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
        // EVERY objection so far, not only the newest. Attempt three that sees
        // only attempt two's objection may fix that one and regress the first,
        // and the reviewer will then say so for a fourth time.
        const priorRow = handle.db.query("SELECT reason FROM work WHERE id = ?").get(item.id) as
          | { reason: string | null }
          | undefined;
        const priorReview = (priorRow?.reason ?? "").startsWith("review") ? `${priorRow?.reason}${""}` + String.fromCharCode(10) : "";
        handle.db.query("UPDATE work SET lease_owner = NULL, lease_epoch = lease_epoch + 1, reason = ? WHERE id = ?")
          .run(`${priorReview}review (attempt ${attemptsSoFar + 1}): ${verdict.reason}`, item.id);
        handle.db.query("UPDATE work SET state = 'ready' WHERE id = ?").run(item.id);
      } finally {
        handle.close();
      }
      return note(options, item, { outcome: "changes-requested", reason: verdict.reason }, "", attemptsSoFar + 1);
    }
    return note(options, item, {
      outcome: "rejected",
      // Says what it was told to fix and how many chances it had, because an
      // item sitting in the blocked queue with "rejected" and nothing else has
      // told the operator nothing.
      reason: changes
        ? `still not right after ${attemptsSoFar} retr${attemptsSoFar === 1 ? "y" : "ies"}: ${verdict.reason}`
        : verdict.reason,
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
function note(
  options: LandOptions,
  item: WorkItem,
  outcome: LandOutcome,
  landedSha = "",
  attempts = 0,
): LandOutcome {
  const handle = openWork(options.stateDir);
  try {
    recordReview(handle, {
      workId: item.id,
      outcome: outcome.outcome,
      reason: outcome.reason,
      branch: `cod/${item.id}`,
      landedSha,
      attempts,
    });
  } finally {
    handle.close();
  }
  return outcome;
}

export { REVIEW_SKILL };
