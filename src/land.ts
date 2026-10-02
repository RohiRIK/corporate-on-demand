/**
 * Reviewing a finished branch and landing it.
 *
 * The only place in this codebase that merges anything. Everything else runs
 * agents; this runs git, and it is gated twice - once by the mechanical checks,
 * which no model may override, and once by the radius.
 *
 * **The retry lives here and only here.** A `request-changes` verdict puts the
 * item back on the queue, up to DEFAULT_MAX_RETRIES times, and every objection
 * so far is kept ON THE REVIEW ROW, where `briefFor` reads it for the next
 * attempt. It used to be kept on `work.reason` - which the worker's own commit
 * overwrites with its output - so in production a retry only ever saw the
 * newest objection, and the "objections accumulate" property held only in tests
 * that never ran a worker between two reviews.
 *
 * Three things are requests for changes WITHOUT asking a model, because they are
 * facts rather than opinions, and they count toward the same cap:
 *   - the branch committed nothing;
 *   - the branch conflicts with the base;
 * and a MECHANICAL finding (a secret, a forbidden action, a global path, a
 * symlink, a submodule, a binary) is terminal at any cap: judgeReview returns
 * before it asks the model, because a rule is not an opinion.
 */

import { gitOut, runGit, resolveBase, SAFE_DIFF_FLAGS, SAFE_DIFF_OPTIONS } from "./git";
import { judgeReview, mechanicalChecks, canMerge, REVIEW_SKILL, type MechanicalResult } from "./review";
import { openWork, recordReview, latestReview, requeue, ledgerText, type ReviewRecord, type WorkItem } from "./work";
import { isGlobalPath } from "./boundary";
import { radiusForWork, targetPathsOfItem, textOfItem } from "./runwork";
import { assertSafeName } from "./worktree";
import type { LandOutcome } from "./governance";

export { resolveBase };

export interface LandOptions {
  readonly repo: string;
  readonly stateDir: string;
  /** Asks the model. Injected so this is testable without a provider. */
  readonly ask: (prompt: string) => Promise<string>;
  readonly maxRetries?: number;
  /**
   * Called after a successful merge, with the base branch. The supervisor uses
   * it to export landed work (see src/export.ts). Never allowed to undo or fail
   * a merge that already happened.
   */
  readonly afterLanding?: (base: string) => void;
}

/**
 * Three, not one.
 *
 * One retry with an UNBRIEFED agent was a coin flip, so it was never worth more
 * than one. The brief is real now - the agent is handed every objection so far -
 * so the retries are worth spending.
 *
 * Still bounded on purpose. An unbounded loop is a company that argues for ever
 * and never converges, and it spends a free model call on each pass. An operator
 * who wants fewer sets `governance.maxReviewRetries`; zero means the first
 * objection is final.
 */
export const DEFAULT_MAX_RETRIES = 3;

/** How many characters of accumulated objections a retry is briefed with. */
export const MAX_OBJECTIONS = 3_000;

/*
 * Everything that used to be a module-level Set - "already landed", "already
 * given its retry" - is ONE ROW in the review table. A Set is empty after every
 * supervisor restart, so a rejected item lost its protection on the next boot.
 */

/**
 * Every path a branch touched, from GIT rather than from diff text.
 *
 * A deletion emits `--- a/verify.sh` and `+++ /dev/null`; a rename emits no
 * `+++` line at all. Any check that reads the diff TEXT therefore cannot see
 * either - which is how `git rm verify.sh` landed and removed a global file.
 *
 * `--name-status -z` names every path regardless of what happened to it, and a
 * rename's or copy's entry carries BOTH sides. NUL-separated, so a path with a
 * tab or a newline in it is one path rather than three. A malformed tail is
 * INCLUDED, so it refuses rather than passes.
 */
export function changedPaths(repo: string, branch: string, base?: string): string[] {
  const from = base ?? resolveBase(repo);
  const raw = gitOut(repo, [...SAFE_DIFF_FLAGS, "diff", ...SAFE_DIFF_OPTIONS, "--name-status", "-z", "--find-renames", `${from}...${branch}`]);
  if (raw === null || raw === "") return [];
  const tokens = raw.split("\u0000").filter((t) => t !== "");
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i] ?? "";
    const sides = /^[RC]/.test(status) ? 2 : 1;
    for (let k = 1; k <= sides; k += 1) {
      const path = tokens[i + k];
      if (path !== undefined && path !== "") paths.push(path);
    }
    i += sides + 1;
  }
  return paths;
}

/**
 * Findings that need git to see: what the TEXT diff hides or cannot show.
 *
 * - A SYMLINK is one line of text naming a target, and the target can be
 *   anywhere - `/cod`, another worktree, the host path of a bind mount. A reader
 *   that follows it leaves the repository.
 * - A SUBMODULE is a pointer to a commit in someone else's repository, which a
 *   later checkout would fetch from a URL of the branch's choosing.
 * - A BINARY file has no reviewable lines, so neither the scan nor the reviewer
 *   ever saw its content. An unreviewable change is not an approved change.
 */
export function structuralFindings(repo: string, branch: string, base: string): string[] {
  const findings: string[] = [];
  const raw = gitOut(repo, [...SAFE_DIFF_FLAGS, "diff", ...SAFE_DIFF_OPTIONS, "--raw", "-z", "--no-renames", `${base}...${branch}`]) ?? "";
  const tokens = raw.split("\u0000").filter((t) => t !== "");
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const meta = tokens[i] ?? "";
    const path = tokens[i + 1] ?? "";
    const newMode = meta.replace(/^:/, "").split(" ")[1] ?? "";
    if (newMode === "120000") findings.push(`structure: ${path} is a symlink; a link can point anywhere, so it is not landed`);
    if (newMode === "160000") findings.push(`structure: ${path} is a submodule; it would fetch code nobody reviewed`);
  }
  const numstat = gitOut(repo, [...SAFE_DIFF_FLAGS, "diff", ...SAFE_DIFF_OPTIONS, "--numstat", "-z", "--no-renames", `${base}...${branch}`]) ?? "";
  for (const entry of numstat.split("\u0000")) {
    const m = /^-\t-\t(.+)$/.exec(entry);
    if (m?.[1] !== undefined) findings.push(`structure: ${m[1]} is a binary file and cannot be reviewed`);
  }
  return findings;
}

/**
 * The paths this branch would conflict on, or null when it merges cleanly.
 *
 * `git merge-tree --write-tree` computes the merge without touching the working
 * tree, so a conflict is found BEFORE anything is merged. The merge used to be
 * attempted directly, and a conflict left `/work` mid-merge - `UU` paths,
 * `MERGE_HEAD` - after which every later merge failed too. Measured.
 *
 * Returns null as well when this git is too old to answer; the merge below
 * still aborts cleanly if it fails.
 */
export function conflictsWith(repo: string, base: string, branch: string): string[] | null {
  const result = runGit(repo, ["merge-tree", "--write-tree", "--name-only", "--no-messages", base, branch]);
  if (result.ok || result.code !== 1) return null;
  const lines = result.out.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  // The first line is the tree id; the conflicted paths follow.
  const paths = [...new Set(lines.slice(1))];
  return paths.length === 0 ? ["(unnamed)"] : paths;
}

/** Keep the newest objections within the bound, oldest dropped first. */
function boundObjections(text: string): string {
  if (text.length <= MAX_OBJECTIONS) return text;
  const lines = text.split("\n");
  while (lines.length > 1 && lines.join("\n").length > MAX_OBJECTIONS) lines.shift();
  const kept = lines.join("\n");
  return kept.length <= MAX_OBJECTIONS ? kept : kept.slice(kept.length - MAX_OBJECTIONS);
}

export async function landWork(repo: string, item: WorkItem, options: LandOptions): Promise<LandOutcome> {
  // The id becomes a branch name in every git command below. Validated here,
  // not trusted from the caller: this is exported, and it is the one
  // irreversible operation in the system.
  try {
    assertSafeName(item.id, "work id");
  } catch (error) {
    return { outcome: "skipped", reason: (error as Error).message };
  }
  const branch = `cod/${item.id}`;

  // The durable guard. A landed or rejected item is not looked at again - and
  // looking is NOT recorded. This path used to write its "skipped" through the
  // same upsert as a verdict, so a second call OVERWROTE `landed` or
  // `rejected` with `skipped`; the next tick then saw a non-terminal row and
  // reviewed the item again. A rejected item could land that way.
  const ledger = openWork(options.stateDir);
  let previous: ReviewRecord | null;
  let current: WorkItem | null;
  try {
    previous = latestReview(ledger, item.id);
    current = ledger.db.query("SELECT * FROM work WHERE id = ?").get(item.id) as WorkItem | null;
  } finally {
    ledger.close();
  }
  if (previous !== null && (previous.outcome === "landed" || previous.outcome === "rejected")) {
    return { outcome: "skipped", reason: `${branch} was already reviewed as ${previous.outcome}: ${previous.reason}` };
  }
  // Only FINISHED work is reviewed. An item that went back on the queue and is
  // running again has a branch that is half of an attempt.
  if (current === null || current.state !== "done") {
    return { outcome: "skipped", reason: `${item.id} is ${current?.state ?? "missing"}, not done; only finished work is reviewed` };
  }

  // A retry is counted from the RECORD, not from `attempts`, which counts
  // dispatches and would grant a fresh retry every time. Durable for the same
  // reason the landed/rejected guard is: a module-level counter is zero after
  // every restart.
  const attemptsSoFar = previous?.outcome === "changes-requested" ? (previous.attempts ?? 1) : 0;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const base = resolveBase(repo);

  const branchExists = gitOut(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (branchExists === null || branchExists === "") {
    // Nothing to review for THIS run. Not a verdict, so the item is not offered
    // again until it runs again.
    return note(options, item, { outcome: "skipped", reason: `nothing to land: ${branch} does not exist` });
  }

  const diff = gitOut(repo, [...SAFE_DIFF_FLAGS, "diff", ...SAFE_DIFF_OPTIONS, `${base}...${branch}`]);
  if (diff === null) {
    // git itself failed. Not the branch's fault, so not a verdict: try again.
    return note(options, item, { outcome: "deferred", reason: `could not diff ${branch} against ${base}; will retry` });
  }

  /** A request for changes, inside the cap; past it, a rejection that says why. */
  const askForChanges = (objection: string): LandOutcome => {
    if (attemptsSoFar >= maxRetries) {
      return note(options, item, {
        outcome: "rejected",
        // Says what it was told to fix and how many chances it had, because an
        // item in the blocked queue reading only "rejected" has told the
        // operator nothing.
        reason: `still not right after ${attemptsSoFar} retr${attemptsSoFar === 1 ? "y" : "ies"}: ${objection}`,
      });
    }
    const handle = openWork(options.stateDir);
    try {
      // `requeue` consumes the epoch, so no run still holding the old one can
      // ever commit against the retry.
      requeue(handle, item.id);
    } finally {
      handle.close();
    }
    const line = `review (attempt ${attemptsSoFar + 1}): ${objection}`;
    const prior = previous?.outcome === "changes-requested" ? previous.reason : "";
    const objections = boundObjections(prior === "" ? line : `${prior}\n${line}`);
    note(options, item, { outcome: "changes-requested", reason: objections }, "", attemptsSoFar + 1);
    return { outcome: "changes-requested", reason: objection };
  };

  if (diff === "") {
    // The most common real outcome of a free model: it talked and shipped
    // nothing. That is not "nothing to review" - it is work that was not done,
    // and it gets the same demand for a fix as any other objection.
    return askForChanges(`${branch} committed nothing. Do the task and commit the result on your branch.`);
  }

  // The PATHS come from git; the text scan still covers secrets and forbidden
  // actions, which have no path equivalent.
  const touched = changedPaths(repo, branch, base);
  const scanned = mechanicalChecks(diff);
  const globalTouched = touched.filter(isGlobalPath);
  const findings = [
    ...scanned.findings,
    ...globalTouched
      .filter((p) => !scanned.findings.some((f) => f.includes(`global: ${p} `)))
      .map((p) => `global: ${p} is a global path; only the CEO lands changes there`),
    ...structuralFindings(repo, branch, base),
  ];
  const mechanical: MechanicalResult = { ok: findings.length === 0, findings };

  // A conflict is a fact about the branch and the base, not an opinion, and the
  // worker can fix it: merge the base into its branch and resolve. Checked only
  // once nothing mechanical is wrong, since a refusal outranks a rebase.
  if (mechanical.ok) {
    const conflicts = conflictsWith(repo, base, branch);
    if (conflicts !== null) {
      return askForChanges(
        `${branch} conflicts with ${base} on: ${conflicts.join(", ")}. Merge ${base} into your branch, resolve the conflicts, and commit.`,
      );
    }
  }

  const declared = targetPathsOfItem(item);
  const verdict = await judgeReview({
    diff,
    task: textOfItem(item),
    mechanical,
    ask: options.ask,
    declaredPaths: declared,
    changedPaths: touched,
  });

  if (verdict.unavailable === true) {
    // No reviewer judged it. Recording a rejection here put work in the blocked
    // queue whenever the free provider had a bad minute.
    return note(options, item, { outcome: "deferred", reason: verdict.reason });
  }

  // The radius is DERIVED from the paths, never read from the row the proposer
  // filled in. (The global paths it actually touched are already refused above.)
  const radius = radiusForWork(item.payload, declared, item.blast_radius);
  if (!canMerge(verdict, radius)) {
    if (verdict.outcome === "request-changes") return askForChanges(verdict.reason);
    return note(options, item, { outcome: "rejected", reason: verdict.reason });
  }

  // The merge itself, into the base and nowhere else. If the main checkout is
  // not on the base branch, merging there would land the work on whatever
  // branch it happens to be on.
  const head = gitOut(repo, ["symbolic-ref", "--short", "HEAD"]);
  if (head !== base) {
    return note(options, item, {
      outcome: "deferred",
      reason: `the work repository is on ${head ?? "a detached HEAD"}, not ${base}; refusing to merge anywhere else`,
    });
  }
  // Identity passed EXPLICITLY: src/git.ts runs with no global config, and a
  // merge that relied on an ambient identity failed on CI. Hooks, fsmonitor and
  // global config are off for every command there.
  const merged = runGit(repo, [
    "-c", "user.name=cod",
    "-c", "user.email=cod@localhost",
    "merge", "--no-ff", "--no-edit", "-m", `cod: land ${branch}`, branch,
  ]);
  if (!merged.ok) {
    // Never leave the repository mid-merge: every later merge would fail on it.
    runGit(repo, ["merge", "--abort"]);
    return note(options, item, {
      outcome: "deferred",
      reason: `git merge failed for ${branch}: ${(merged.err || merged.out).split("\n")[0] ?? "no detail"}; the merge was aborted`,
    });
  }
  const sha = gitOut(repo, ["rev-parse", "HEAD"]) ?? "";
  try {
    options.afterLanding?.(base);
  } catch {
    // An export that fails is reported by the exporter; it cannot unmerge.
  }
  return note(options, item, { outcome: "landed", branch, reason: `merged ${branch} into ${base}` }, sha);
}

/**
 * Record a verdict before returning it.
 *
 * Every return path that DECIDES something goes through here, which is the
 * point: the bug was a path that returned without recording, and a rejected
 * item nobody records is an item nobody skips. The guard path above is the one
 * deliberate exception - it decides nothing, so it records nothing.
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
      reason: ledgerText(outcome.reason, MAX_OBJECTIONS + 200),
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
