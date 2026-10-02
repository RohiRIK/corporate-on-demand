import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openWork, propose, get, latestReview, claimById, commit, recordReview } from "../src/work";
import { landWork, conflictsWith } from "../src/land";
import { resolveBase } from "../src/git";
import { readJobChange } from "../src/change";
import { acquireWorktree } from "../src/worktree";
import { parseVerdict, reviewPrompt } from "../src/review";
import { isGlobalPath } from "../src/boundary";

/**
 * The review loop, held to what the system needs from it unattended.
 *
 * Each block is a defect measured on this tree before it was fixed:
 *
 *   - in a job worktree the "base" resolved to the job's own branch, so every
 *     job reported zero commits and every mutating cron job was recorded as
 *     having changed nothing;
 *   - a conflicting merge left `/work` mid-merge, and every later merge failed;
 *   - a branch that committed nothing was "skipped" and re-offered every tick;
 *   - an unreachable reviewer parked the work in the blocked queue as if a
 *     reviewer had turned it down;
 *   - the "already reviewed" guard overwrote the verdict it was guarding.
 */

const NL = "\n";
const dirs: string[] = [];
function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function repo(branch = "master"): string {
  const dir = scratch("cod-rl-");
  git(dir, "init", "-q", "-b", branch, ".");
  writeFileSync(join(dir, "notes.md"), `base${NL}`);
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base");
  return dir;
}

function commitAll(dir: string, message: string): void {
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", message);
}

/** A proposed item, finished the way the worker finishes one. */
function finishedItem(state: string, goal = "write notes"): string {
  const handle = openWork(state);
  const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: goal, goal, targetPaths: ["notes.md"] });
  if (!made.ok || made.item === undefined) throw new Error("seed");
  handle.db.query("UPDATE work SET state = 'ready' WHERE id = ?").run(made.item.id);
  const claimed = claimById(handle, made.item.id, "w");
  if (claimed !== null) commit(handle, made.item.id, claimed.lease_epoch, "done", "worker finished");
  handle.close();
  return made.item.id;
}

/** Re-run: the worker's next attempt, after the item was sent back. */
function rerun(state: string, id: string): void {
  const handle = openWork(state);
  const claimed = claimById(handle, id, "w");
  if (claimed !== null) commit(handle, id, claimed.lease_epoch, "done", "worker finished again");
  handle.close();
}

async function land(dir: string, state: string, id: string, ask: () => Promise<string> | string = () => "approve - fine", maxRetries?: number) {
  const handle = openWork(state);
  const item = get(handle, id);
  handle.close();
  return landWork(dir, item!, { repo: dir, stateDir: state, ask: async () => ask(), ...(maxRetries === undefined ? {} : { maxRetries }) });
}

function onBranch(dir: string, branch: string, edit: () => void): void {
  const base = resolveBase(dir);
  git(dir, "checkout", "-q", "-b", branch);
  edit();
  commitAll(dir, `change on ${branch}`);
  git(dir, "checkout", "-q", base);
}

describe("the base is a fact about the REPOSITORY, even from a job worktree", () => {
  test("a job worktree's commits are seen - the base is not the job's own branch", () => {
    const dir = repo();
    const wt = acquireWorktree(dir, join(dir, ".cod-worktrees"), "nightly");
    writeFileSync(join(wt.path, "answer.txt"), `SEVEN${NL}`);
    commitAll(wt.path, "answer");
    expect(resolveBase(wt.path)).toBe("master");
    const change = readJobChange(wt.path);
    expect(change.commits).toBe(1);
    expect(change.changed).toEqual(["answer.txt"]);
  });

  test("a worktree on a non-job branch still answers with the MAIN checkout's branch", () => {
    // Belt and braces with the `cod/` rule below: the base is read through the
    // common git dir, so a linked worktree answers for the repository whatever
    // its own branch is called.
    const dir = repo("main");
    git(dir, "worktree", "add", "-q", "-b", "feature", join(dir, ".wt-feature"));
    expect(resolveBase(join(dir, ".wt-feature"))).toBe("main");
  });

  test("a `cod/` branch is never the base, even if the main checkout is on one", () => {
    const dir = repo("main");
    git(dir, "checkout", "-q", "-b", "cod/w-stray");
    expect(resolveBase(dir)).toBe("main");
  });
});

describe("a branch that committed nothing is work that was not done", () => {
  test("it is sent back with a demand, not skipped for ever", async () => {
    const dir = repo();
    const state = scratch("cod-rl-state-");
    const id = finishedItem(state);
    git(dir, "branch", `cod/${id}`);
    let asked = 0;
    const result = await land(dir, state, id, () => { asked += 1; return "approve"; });
    expect(result.outcome).toBe("changes-requested");
    expect(result.reason).toContain("committed nothing");
    expect(asked).toBe(0); // a fact, not an opinion: no model was asked
    const handle = openWork(state);
    expect(get(handle, id)?.state).toBe("ready");
    handle.close();
  });

  test("and past the cap it stops, saying so", async () => {
    const dir = repo();
    const state = scratch("cod-rl-state-");
    const id = finishedItem(state);
    git(dir, "branch", `cod/${id}`);
    expect((await land(dir, state, id, () => "approve", 1)).outcome).toBe("changes-requested");
    rerun(state, id);
    const final = await land(dir, state, id, () => "approve", 1);
    expect(final.outcome).toBe("rejected");
    expect(final.reason).toContain("committed nothing");
  });
});

describe("a conflict is found before anything is merged", () => {
  function conflicted(): { dir: string; state: string; id: string } {
    const dir = repo();
    const state = scratch("cod-rl-state-");
    const id = finishedItem(state);
    onBranch(dir, `cod/${id}`, () => writeFileSync(join(dir, "notes.md"), `from the branch${NL}`));
    writeFileSync(join(dir, "notes.md"), `from master meanwhile${NL}`);
    commitAll(dir, "master moved");
    return { dir, state, id };
  }

  test("it is sent back naming the file, and /work is NOT left mid-merge", async () => {
    const { dir, state, id } = conflicted();
    const result = await land(dir, state, id);
    expect(result.outcome).toBe("changes-requested");
    expect(result.reason).toContain("notes.md");
    expect(result.reason).toContain("conflicts with master");
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(existsSync(join(dir, ".git", "MERGE_HEAD"))).toBe(false);
  });

  test("once the worker merges the base and resolves it, it lands", async () => {
    const { dir, state, id } = conflicted();
    await land(dir, state, id);
    git(dir, "checkout", "-q", `cod/${id}`);
    try {
      git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "merge", "-q", "master");
    } catch {
      // The conflict, as the worker would see it.
    }
    writeFileSync(join(dir, "notes.md"), `resolved${NL}`);
    commitAll(dir, "resolve");
    git(dir, "checkout", "-q", "master");
    rerun(state, id);
    expect((await land(dir, state, id)).outcome).toBe("landed");
  });

  test("if the pre-check cannot run, a failed merge is ABORTED, never left half-done", async () => {
    // An older git has no `merge-tree --write-tree`. Simulated with a git on
    // PATH that refuses only that subcommand, so the conflict reaches the real
    // merge - which must then be aborted, or every later merge fails on it.
    const { dir, state, id } = conflicted();
    const shim = scratch("cod-rl-shim-");
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    writeFileSync(join(shim, "git"), `#!/bin/sh\nfor a in "$@"; do [ "$a" = merge-tree ] && exit 129; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const path = process.env["PATH"];
    process.env["PATH"] = `${shim}:${path ?? ""}`;
    try {
      const result = await land(dir, state, id);
      expect(result.outcome).toBe("deferred");
      expect(result.reason).toContain("aborted");
    } finally {
      process.env["PATH"] = path;
    }
    expect(existsSync(join(dir, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  test("conflictsWith is null for a clean merge", () => {
    const dir = repo();
    onBranch(dir, "cod/clean", () => writeFileSync(join(dir, "other.md"), `x${NL}`));
    expect(conflictsWith(dir, "master", "cod/clean")).toBeNull();
  });
});

describe("nobody judged it, so it is not a verdict", () => {
  test("a reviewer that throws DEFERS the item - it is offered again, not blocked", async () => {
    const dir = repo();
    const state = scratch("cod-rl-state-");
    const id = finishedItem(state);
    onBranch(dir, `cod/${id}`, () => writeFileSync(join(dir, "notes.md"), `v1${NL}`));
    const result = await land(dir, state, id, () => { throw new Error("provider down"); });
    expect(result.outcome).toBe("deferred");
    const handle = openWork(state);
    expect(latestReview(handle, id)?.outcome).toBe("deferred");
    expect(get(handle, id)?.state).toBe("done");
    handle.close();
  });

  test("a reviewer RUN that failed is the provider, not an opinion", async () => {
    const dir = repo();
    const state = scratch("cod-rl-state-");
    const id = finishedItem(state);
    onBranch(dir, `cod/${id}`, () => writeFileSync(join(dir, "notes.md"), `v1${NL}`));
    const result = await land(dir, state, id, () => "agent FAILED: agent reported an error: 503");
    expect(result.outcome).toBe("deferred");
  });
});

describe("looking at a judged item does not change its verdict", () => {
  test("a second land on a REJECTED item leaves it rejected", async () => {
    const dir = repo();
    const state = scratch("cod-rl-state-");
    const id = finishedItem(state);
    onBranch(dir, `cod/${id}`, () => writeFileSync(join(dir, "notes.md"), `v1${NL}`));
    expect((await land(dir, state, id, () => "reject - out of scope")).outcome).toBe("rejected");
    const again = await land(dir, state, id, () => "approve - changed my mind");
    expect(again.outcome).toBe("skipped");
    const handle = openWork(state);
    expect(latestReview(handle, id)?.outcome).toBe("rejected");
    handle.close();
    expect(git(dir, "log", "--oneline", "master")).not.toContain("land cod/");
  });

  test("an item that is not DONE is not reviewed, and nothing is recorded", async () => {
    const dir = repo();
    const state = scratch("cod-rl-state-");
    const handle = openWork(state);
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "x", goal: "x" });
    handle.close();
    if (!made.ok || made.item === undefined) throw new Error("seed");
    onBranch(dir, `cod/${made.item.id}`, () => writeFileSync(join(dir, "notes.md"), `v1${NL}`));
    const result = await land(dir, state, made.item.id);
    expect(result.outcome).toBe("skipped");
    const after = openWork(state);
    expect(latestReview(after, made.item.id)).toBeNull();
    after.close();
  });

  test("the main checkout on the wrong branch defers the merge instead of landing there", async () => {
    const dir = repo();
    const state = scratch("cod-rl-state-");
    const id = finishedItem(state);
    onBranch(dir, `cod/${id}`, () => writeFileSync(join(dir, "notes.md"), `v1${NL}`));
    git(dir, "checkout", "-q", "-b", "somewhere-else");
    // origin/HEAD tells resolveBase where the base really is.
    git(dir, "update-ref", "refs/remotes/origin/master", "master");
    git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master");
    const result = await land(dir, state, id);
    expect(result.outcome).toBe("deferred");
    expect(git(dir, "log", "--oneline", "somewhere-else")).not.toContain("land cod/");
  });
});

describe("what the text diff cannot show is refused by git's own account", () => {
  async function refused(edit: (dir: string) => void): Promise<{ outcome: string; reason: string }> {
    const dir = repo();
    const state = scratch("cod-rl-state-");
    const id = finishedItem(state);
    onBranch(dir, `cod/${id}`, () => edit(dir));
    let asked = 0;
    const result = await land(dir, state, id, () => { asked += 1; return "approve"; });
    expect(asked).toBe(0);
    return result;
  }

  test("a symlink is refused - it can point out of the repository", async () => {
    const result = await refused((dir) => symlinkSync("/cod/work/ledger.sqlite", join(dir, "ledger-link")));
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toContain("symlink");
  });

  test("a binary file is refused - nobody could review it", async () => {
    const result = await refused((dir) => writeFileSync(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 0, 255, 0, 7])));
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toContain("binary");
  });

  test("a .gitattributes anywhere is global - it names drivers git will run", async () => {
    expect(isGlobalPath(".gitattributes")).toBe(true);
    expect(isGlobalPath("docs/deep/.gitattributes")).toBe(true);
    expect(isGlobalPath("notes/.gitmodules")).toBe(true);
    expect(isGlobalPath("notes/gitattributes.md")).toBe(false);
    const result = await refused((dir) => {
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, "docs", ".gitattributes"), `*.md diff=evil${NL}`);
    });
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toContain("global");
  });
});

describe("the verdict parser is tolerant of wrapping and strict about meaning", () => {
  test("verdicts in emphasis, headings and labels are read", () => {
    expect(parseVerdict("**Approve** - fine")).toBe("approve");
    expect(parseVerdict("> **Decision:** Approved")).toBe("approve");
    expect(parseVerdict("Verdict: request changes - no test")).toBe("request-changes");
    expect(parseVerdict("REQUEST-CHANGES: add a test")).toBe("request-changes");
    expect(parseVerdict("I read the diff.\nReject - out of scope")).toBe("reject");
  });

  test("every doubt is a refusal", () => {
    expect(parseVerdict("")).toBeNull();
    expect(parseVerdict("This looks quite good to me, maybe ship it?")).toBeNull();
    expect(parseVerdict("Approve? Not quite.\nReject - no test.")).toBe("reject");
    expect(parseVerdict("approve - yes\nreject - no")).toBeNull();
    expect(parseVerdict("I would approve this")).toBeNull();
  });
});

describe("what the reviewer is sent", () => {
  test("the diff and the task are redacted before they leave for a provider", () => {
    const key = `sk-${"z".repeat(40)}`;
    const prompt = reviewPrompt({ diff: `+const k = "${key}";`, task: `use ${key}` });
    expect(prompt).not.toContain(key);
    expect(prompt).toContain("[REDACTED]");
  });

  test("scope is judged against the paths the task NAMED and the paths it TOUCHED", () => {
    const prompt = reviewPrompt({ diff: "+x", task: "t", declaredPaths: ["notes/a.md"], changedPaths: ["notes/a.md", "notes/b.md"] });
    expect(prompt).toContain("Paths the task named: notes/a.md");
    expect(prompt).toContain("Paths the change touched: notes/a.md, notes/b.md");
  });

  test("an enormous diff is cut, and the reviewer is TOLD it was cut", () => {
    const prompt = reviewPrompt({ diff: `+${"y".repeat(150_000)}`, task: "t" });
    expect(prompt.length).toBeLessThan(110_000);
    expect(prompt).toContain("diff truncated");
  });
});

describe("objections live on the review row", () => {
  test("they accumulate, bounded, across real worker runs", async () => {
    const dir = repo();
    const state = scratch("cod-rl-state-");
    const id = finishedItem(state);
    onBranch(dir, `cod/${id}`, () => writeFileSync(join(dir, "notes.md"), `v1${NL}`));
    await land(dir, state, id, () => "request changes - first objection");
    rerun(state, id);
    await land(dir, state, id, () => "request changes - second objection");
    const handle = openWork(state);
    const review = latestReview(handle, id);
    handle.close();
    expect(review?.reason).toContain("first objection");
    expect(review?.reason).toContain("second objection");
    expect(review?.attempts).toBe(2);
  });

  test("a recorded verdict cannot be smuggled in by a bare skipped row", () => {
    // `skipped` is not terminal, by design; this pins that recordReview stores
    // exactly what it is given, so the guard above is the thing that decides.
    const state = scratch("cod-rl-state-");
    const handle = openWork(state);
    recordReview(handle, { workId: "w-x", outcome: "deferred", reason: "r", branch: "cod/w-x", landedSha: "" });
    expect(latestReview(handle, "w-x")?.outcome).toBe("deferred");
    handle.close();
  });
});
