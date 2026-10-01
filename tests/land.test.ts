import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openWork, propose, get, latestReview } from "../src/work";
import { landWork } from "../src/land";

/**
 * The only code in the project that merges.
 *
 * Proven against a REAL git repository rather than a mock, because every
 * interesting failure here is git behaviour: a branch that does not exist, a
 * diff that is empty, a hook that tries to run code during the merge.
 */

const dirs: string[] = [];
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-land-"));
  dirs.push(dir);
  const g = (...a: string[]): string =>
    execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("init", "-q", "-b", "master", ".");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  return dir;
}

function branchWith(dir: string, name: string, path: string, body: string): void {
  const g = (...a: string[]): string =>
    execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  g("checkout", "-q", "-b", name);
  // mkdirs the parent: writing notes/a.md into a repo with no notes/ is an
  // ENOENT that looks like a product failure.
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), body);
  g("add", "-A");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "change");
  g("checkout", "-q", "master");
}

function seeded(state: string, from = "engineering"): { id: string } {
  const handle = openWork(state);
  const made = propose(handle, {
    from, to: from, kind: "task", payload: "write notes", goal: "write notes", targetPaths: ["notes/a.md"],
  });
  handle.close();
  if (!made.ok || made.item === undefined) throw new Error("seed failed");
  return { id: made.item.id };
}

/**
 * State lives OUTSIDE the repository.
 *
 * Not tidiness: the ledger is a SQLite database, and `git add -A` on a repo
 * containing it stages the database - so the next `git checkout master` deletes
 * the ledger, and every item vanishes mid-test. In production they are already
 * separate (state is a volume, /work is the repo); here they had to be split for
 * the same reason.
 */
function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-land-state-"));
  dirs.push(dir);
  return dir;
}

const opts = { repo: "", stateDir: "", ask: async () => "approve - looks right" };

describe("landWork", () => {
  test("an approved change is merged into master", async () => {
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "done\n");
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    const result = await landWork(dir, item!, { ...opts, repo: dir, stateDir: dir });
    expect(result.outcome).toBe("landed");
    const master = execFileSync("git", ["-C", dir, "log", "--oneline", "master"], { encoding: "utf8" });
    expect(master).toContain("land cod/");
  });

  test("a MECHANICAL refusal never merges, whatever the reviewer says", async () => {
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    // A secret in the diff, and a reviewer that approves anyway.
    branchWith(dir, `cod/${id}`, "notes/a.md", "key = sk-live-abc123def456\n");
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    const result = await landWork(dir, item!, { ...opts, repo: dir, stateDir: state, ask: async () => "approve, fine" });
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toContain("secret");
    const master = execFileSync("git", ["-C", dir, "log", "--oneline", "master"], { encoding: "utf8" });
    expect(master).not.toContain("land cod/");
  });

  test("requesting changes retries ONCE, and the review becomes the brief", async () => {
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "v1\n");
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    const result = await landWork(dir, item!, { ...opts, repo: dir, stateDir: state, ask: async () => "request changes - no test" });
    expect(result.outcome).toBe("changes-requested");
    const after = openWork(state);
    const updated = get(after, id);
    after.close();
    // The reviewer`s words are on the item, so the retry is BRIEFED rather than
    // starting over from nothing.
    expect(updated?.reason ?? "").toContain("no test");
    expect(updated?.state).toBe("ready");
  });

  test("a second request-changes is NOT retried again", async () => {
    // One retry is the whole policy. A company that argues with a reviewer for
    // ever is a company that never converges.
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "v1\n");
    const handle = openWork(state);
    const first = get(handle, id);
    handle.close();
    await landWork(dir, first!, { ...opts, repo: dir, stateDir: state, ask: async () => "request changes - still no test" });
    const handle2 = openWork(state);
    const second = get(handle2, id);
    handle2.close();
    const result = await landWork(dir, second!, { ...opts, repo: dir, stateDir: state, ask: async () => "request changes - still no test" });
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toContain("one retry");
  });

  test("a branch that changed nothing is skipped, not merged", async () => {
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    const result = await landWork(dir, item!, { ...opts, repo: dir, stateDir: dir });
    expect(result.outcome).toBe("skipped");
  });

  test("the same branch is never merged twice", async () => {
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "done\n");
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    await landWork(dir, item!, { ...opts, repo: dir, stateDir: dir });
    // The reason now names the REVIEW verdict rather than a Set that no longer
    // exists, and it says the branch as well as the verdict.
    const again = await landWork(dir, item!, { ...opts, repo: dir, stateDir: dir });
    expect(again.outcome).toBe("skipped");
    expect(again.reason).toContain("already reviewed");
    expect(again.reason).toContain("landed");
  });

  test("an unreachable reviewer does NOT merge", async () => {
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "done\n");
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    const result = await landWork(dir, item!, { ...opts, repo: dir, stateDir: state, ask: async () => { throw new Error("provider down"); } });
    expect(result.outcome).toBe("rejected");
    const master = execFileSync("git", ["-C", dir, "log", "--oneline", "master"], { encoding: "utf8" });
    expect(master).not.toContain("land cod/");
  });
});

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });


describe("the review record", () => {
  test("a landed review is recorded and reads back", async () => {
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "done\n");
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    await landWork(dir, item!, { ...opts, repo: dir, stateDir: state });

    const after = openWork(state);
    const record = latestReview(after, id);
    after.close();
    expect(record?.outcome).toBe("landed");
    expect(record?.branch).toBe(`cod/${id}`);
    expect(record?.reviewedAt ?? 0).toBeGreaterThan(0);
  });

  test("a REJECTED review is recorded too - this is the whole point", async () => {
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", 'key = "sk-live-abc123def456"\n');
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    const outcome = await landWork(dir, item!, { ...opts, repo: dir, stateDir: state });

    const after = openWork(state);
    const record = latestReview(after, id);
    after.close();
    expect(outcome.outcome).toBe("rejected");
    expect(record?.outcome).toBe("rejected");
    expect(record?.reason).toContain("secret");
  });

  test("a skipped review is recorded as skipped, not as nothing", async () => {
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    await landWork(dir, item!, { ...opts, repo: dir, stateDir: state });
    const after = openWork(state);
    expect(latestReview(after, id)?.outcome).toBe("skipped");
    after.close();
  });

  test("a SECOND review overwrites the first, so the latest is authoritative", async () => {
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "v1\n");
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    await landWork(dir, item!, { ...opts, repo: dir, stateDir: state, ask: async () => "request changes - no test" });
    await landWork(dir, item!, { ...opts, repo: dir, stateDir: state, ask: async () => "approve - fine now" });
    const after = openWork(state);
    expect(latestReview(after, id)?.outcome).toBe("landed");
    after.close();
  });

  test("latestReview is null for an item never reviewed", () => {
    const state = stateDir();
    const handle = openWork(state);
    expect(latestReview(handle, "w-nope")).toBeNull();
    handle.close();
  });
});


describe("a rejected item is reviewed ONCE", () => {
  test("a second land on a rejected item does not re-review it", async () => {
    // The defect this exists for. landWork returned `rejected` without writing
    // anything, so the item stayed `done` and the tick offered it again on every
    // tick, burning a model call each time, for ever.
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", 'key = "sk-live-abc123def456"\n');
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();

    let asked = 0;
    const ask = async (): Promise<string> => { asked += 1; return "approve, fine"; };
    const first = await landWork(dir, item!, { ...opts, repo: dir, stateDir: state, ask });
    expect(first.outcome).toBe("rejected");

    const handle2 = openWork(state);
    const again = get(handle2, id);
    handle2.close();
    const second = await landWork(dir, again!, { ...opts, repo: dir, stateDir: state, ask });
    expect(second.outcome).toBe("skipped");
    expect(second.reason).toContain("already reviewed");
    expect(asked).toBe(0);
  });

  test("the guard survives a RESTART, because it is in the database", async () => {
    // The process-scoped Sets emptied on every supervisor restart. This is the
    // regression that proves they were the wrong home for it.
    const dir = repo();
    const state = stateDir();
    const { id } = seeded(state);
    branchWith(dir, `cod/${id}`, "notes/a.md", "done\n");
    const handle = openWork(state);
    const item = get(handle, id);
    handle.close();
    await landWork(dir, item!, { ...opts, repo: dir, stateDir: state });

    const fresh = openWork(state);          // a "restart": nothing in memory
    const reread = get(fresh, id);
    fresh.close();
    const second = await landWork(dir, reread!, { ...opts, repo: dir, stateDir: state });
    expect(second.outcome).toBe("skipped");
  });
});
