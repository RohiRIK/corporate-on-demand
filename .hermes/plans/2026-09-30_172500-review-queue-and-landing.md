# Persist the review outcome, and give landed work a way home

## Goal

Make a rejected piece of work stop being re-reviewed forever, make it visible as
"this needs a person", and let the CEO land work into a shared repository the
operator chooses — all without changing what a fresh workspace does by default.

## Current context / assumptions

Measured against `main` at `32fa2cd`, 526 tests, `verify.sh` PASS.

**What exists today**

- `src/land.ts` — `landWork(repo, item, options)`. Reads `git diff master...cod/<id>`,
  runs `mechanicalChecks()` then a model reviewer via `judgeReview()`, then
  `git -c core.hooksPath=/dev/null merge --no-ff -m "cod: land <branch>" <branch>`.
  Returns `{ outcome: "landed" | "changes-requested" | "rejected" | "skipped", reason }`.
- `src/review.ts` — `mechanicalChecks(diff)`, `judgeReview()`, `canMerge()`.
  Six rules, all mutation-verified.
- `src/governance.ts` — `runGovernance()`. After dispatch, it offers
  `listWork(handle).filter((item) => item.state === "done" && !landedIds.has(item.id))`
  to `options.land`. `landedIds` is declared **inside the function**, so it is
  empty on every tick.
- `src/work.ts` — `CREATE TABLE IF NOT EXISTS work (...)`, plus a
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`.
  `WorkState = "proposed" | "ready" | "running" | "done" | "failed" | "rejected"`.
  Existing transitions: `propose`, `claim`, `reject(handle, id, reason)`,
  `commit(handle, id, leaseEpoch, "done" | "failed", reason?)`.

**Three defects, all in the same place**

1. **A rejected item is re-reviewed on every tick, forever.** `landWork` only
   writes ledger state on `changes-requested`. On `rejected` the item's row is
   untouched, so it stays `done`; and the tick's filter is
   `state === "done" && !landedIds.has(...)`, and `landedIds` never gains a
   rejected id. So every tick re-runs the model reviewer on work that will never
   land. Unattended, that is an unbounded, silent burn of model calls.

2. **Both "already done" guards are process-scoped, so a restart forgets them.**
   `landedBranches` and `retriedBranches` in `src/land.ts` are module-level
   `Set`s. They empty on every supervisor restart. A branch that was already
   merged is re-reviewed after a restart (it then self-heals to `skipped`,
   because its diff against `master` is empty) but a **rejected** item loses its
   protection entirely and is re-reviewed from scratch.

3. **Nothing surfaces "this needs a human".** `cod status`
   (`src/commands.ts:299`) reports container, liveness, timezone, workers and
   crons. It says nothing about the ledger. `cod work list --status rejected`
   works, but nothing ever *writes* that state for a review rejection — the only
   writer of `rejected` is the reconciler, for a proposal out of authority.

**And one capability that was never connected**

4. Landing only reaches the volume's `master`. `/work` is a **named volume**
   (`src/docker.ts:526`) and the workspace file is mounted **read-only**
   (`src/docker.ts:519`) precisely "so the system cannot rewrite it". So work
   that is reviewed, approved and merged still lives in a Docker volume nobody
   outside can see. Nothing about that mount may change by default — the
   read-only workspace file is a deliberate security property, not an oversight.

## Architecture / proposed approach

Three independent pieces, in increasing risk order.

1. **A `review` table** alongside `work`, written by `landWork` on every outcome
   and read by the tick's filter. `CREATE TABLE IF NOT EXISTS` makes it safe for
   existing databases — they gain the table on next open, with no migration and
   no data movement. This replaces both process-scoped `Set`s with one durable
   record, which is what makes "already reviewed" survive a restart.
2. **A human queue.** `cod work blocked` lists items whose latest review is
   `rejected`, with the reviewer's reason. The owner opens the computer and sees
   them; that is the entire interface, so the queue has to be one command.
3. **Shared-repository landing, opt-in.** A workspace names a `landing.repo`
   path; the container mounts it read-write at `/landing`, and `landWork` pushes
   the merge commit there. With no `landing.repo`, the mount is absent and
   behaviour is byte-for-byte what it is today — asserted by a test.

Nothing here changes what a fresh `cod init` produces.

## Step-by-step tasks

### Task 1 — A durable record of every review

**Test first.** Append to `tests/land.test.ts` (the file already builds real git
repositories — reuse `repo()` and `stateDir()` from it):

```ts
describe("the review record", () => {
  test("a landed review is recorded and survives being read back", async () => {
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
    // The reason is the reviewer's own words, not a status code.
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

  test("latestReview returns null for an item never reviewed", () => {
    const state = stateDir();
    const handle = openWork(state);
    expect(latestReview(handle, "w-nope")).toBeNull();
    handle.close();
  });
});
```

Add to the imports at the top of `tests/land.test.ts`:
`import { openWork, get, latestReview } from "../src/work";`

Run: `bun test ./tests/land.test.ts`
**Expected: FAIL** with `Export 'latestReview' not found in ../src/work`.

**Implement** in `src/work.ts`.

Append to the `SCHEMA` constant, directly after the `meta` table:

```sql
CREATE TABLE IF NOT EXISTS review (
  work_id     TEXT PRIMARY KEY,
  outcome     TEXT NOT NULL,
  reason      TEXT NOT NULL,
  branch      TEXT NOT NULL DEFAULT '',
  landed_sha  TEXT NOT NULL DEFAULT '',
  reviewed_at INTEGER NOT NULL
);
```

Add the export next to `reject()`:

```ts
/** One review verdict, as recorded. The durable answer to "was this looked at". */
export interface ReviewRecord {
  readonly workId: string;
  readonly outcome: "landed" | "changes-requested" | "rejected" | "skipped";
  readonly reason: string;
  readonly branch: string;
  readonly landedSha: string;
  readonly reviewedAt: number;
}

/**
 * Record a review verdict.
 *
 * Upsert on `work_id`, so the LATEST verdict is what anyone reads. A history
 * would be nice and is not needed: the branch and its commits are the history,
 * and the question being answered is "what is the current state of this item".
 */
export function recordReview(handle: WorkDb, record: Omit<ReviewRecord, "reviewedAt"> & { readonly reviewedAt?: number }): void {
  handle.db
    .query(
      `INSERT INTO review (work_id, outcome, reason, branch, landed_sha, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(work_id) DO UPDATE SET
         outcome = excluded.outcome,
         reason = excluded.reason,
         branch = excluded.branch,
         landed_sha = excluded.landed_sha,
         reviewed_at = excluded.reviewed_at`,
    )
    .run(record.workId, record.outcome, record.reason, record.branch, record.landedSha, record.reviewedAt ?? Date.now());
}

/** The latest verdict for one item, or null if it has never been reviewed. */
export function latestReview(handle: WorkDb, workId: string): ReviewRecord | null {
  const row = handle.db
    .query(
      `SELECT work_id, outcome, reason, branch, landed_sha, reviewed_at
         FROM review WHERE work_id = ?`,
    )
    .get(workId) as
    | { work_id: string; outcome: string; reason: string; branch: string; landed_sha: string; reviewed_at: number }
    | null;
  if (row === null) return null;
  return {
    workId: row.work_id,
    outcome: row.outcome as ReviewRecord["outcome"],
    reason: row.reason,
    branch: row.branch,
    landedSha: row.landed_sha,
    reviewedAt: row.reviewed_at,
  };
}

/**
 * Items whose latest review needs a PERSON.
 *
 * The queue that does not exist today. An autonomous company still has to be
 * able to say "I am stopping here, and this is why" - otherwise a rejection is
 * indistinguishable from nothing happening.
 */
export function blockedWork(handle: WorkDb): { readonly item: WorkItem; readonly review: ReviewRecord }[] {
  const rows = handle.db
    .query(
      `SELECT w.* FROM work w
         JOIN review r ON r.work_id = w.id
        WHERE r.outcome = 'rejected'
        ORDER BY r.reviewed_at ASC`,
    )
    .all() as WorkItem[];
  return rows.map((item) => ({ item, review: latestReview(handle, item.id) as ReviewRecord }));
}
```

Run: `bun test ./tests/land.test.ts`
**Expected:** the 5 new tests pass, the 7 existing land tests still pass.

Commit: `feat(work): a durable record of every review verdict`

### Task 2 — Stop re-reviewing, and prove it survives a restart

**Test first.** Append to `tests/land.test.ts`:

```ts
describe("a rejected item is reviewed ONCE", () => {
  test("a second land on a rejected item does not re-review it", async () => {
    // The defect this exists for. `landWork` returned `rejected` without
    // writing anything, so the item stayed `done` and the tick offered it again
    // on every tick, forever, burning a model call each time.
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
    expect(asked).toBe(0); // mechanical refusal short-circuits the model

    const handle2 = openWork(state);
    const again = get(handle2, id);
    handle2.close();
    const second = await landWork(dir, again!, { ...opts, repo: dir, stateDir: state, ask });
    // Skipped from the RECORD, not from a Set that a restart would empty.
    expect(second.outcome).toBe("skipped");
    expect(second.reason).toContain("already reviewed");
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

    // A "restart": brand-new handle, nothing in memory.
    const fresh = openWork(state);
    const reread = get(fresh, id);
    fresh.close();
    const second = await landWork(dir, reread!, { ...opts, repo: dir, stateDir: state });
    expect(second.outcome).toBe("skipped");
  });
});
```

Run: `bun test ./tests/land.test.ts`
**Expected: FAIL** — `second.outcome` is `"rejected"` / `"landed"`, not `"skipped"`.

**Implement** in `src/land.ts`.

Delete both module-level `Set`s and their comments (lines 42-55), and add at the
top of `landWork`, right after `const branch = ...`:

```ts
  // The durable guard. Everything that used to be a module-level Set - "already
  // landed", "already given its retry" - is one row in `review`, so a restart
  // does not hand the company a fresh set of things it has already judged.
  const ledger = openWork(options.stateDir);
  const previous = latestReview(ledger, item.id);
  ledger.close();
  if (previous !== null && (previous.outcome === "landed" || previous.outcome === "rejected")) {
    return {
      outcome: "skipped",
      reason: `${branch} was already reviewed as ${previous.outcome}: ${previous.reason}`,
    };
  }
  // A retry is counted from the record, not from `attempts`, which counts
  // dispatches and would grant a fresh retry every time.
  const alreadyRetried = previous?.outcome === "changes-requested";
```

Replace `retriedBranches.add(branch)` with a record write, and add a record
write to **every** return path. Add a small helper at the bottom of the file:

```ts
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
```

Then wrap each return: `return note(options, item, { outcome: "changes-requested", reason: verdict.reason });`,
`return note(options, item, { outcome: "rejected", reason: ... });`,
`return note(options, item, { outcome: "skipped", reason: ... });`, and for the
merge: `return note(options, item, { outcome: "landed", branch, reason: \`merged ${branch} into master\` }, sha);`

Change the imports in `src/land.ts` to
`import { openWork, recordReview, latestReview, type WorkItem } from "./work";`

Run: `bun test ./tests/land.test.ts`
**Expected: all pass**, including the two new ones.

Commit: `fix(land): a rejected item is reviewed once, and the record outlives a restart`

### Task 3 — The tick stops offering already-reviewed work

**Test first.** Append to `tests/governance.test.ts`:

```ts
  test("the tick does not re-offer work it has already reviewed", async () => {
    const dir = scratch();
    const reviewed: string[] = [];
    let landCalls = 0;
    const land = async (id: string) => {
      landCalls += 1;
      reviewed.push(id);
      return { outcome: "rejected" as const, reason: "not good enough" };
    };
    await runGovernance(workspace, dir, { ...opts, dispatch: async () => ({ ok: true, output: "x" }), land });
    await runGovernance(workspace, dir, { ...opts, dispatch: async () => ({ ok: true, output: "x" }), land });
    await runGovernance(workspace, dir, { ...opts, dispatch: async () => ({ ok: true, output: "x" }), land });
    // The lander is idempotent by contract, but the tick should not be leaning
    // on that: three ticks, and the same rejected branch is not re-reviewed.
    expect(new Set(reviewed).size).toBe(reviewed.length);
  });

  test("a rejected item appears in the tick's report, not silently", async () => {
    const dir = scratch();
    const land = async () => ({ outcome: "rejected" as const, reason: "no test" });
    await runGovernance(workspace, dir, { ...opts, dispatch: async () => ({ ok: true, output: "x" }), land });
    const report = await runGovernance(workspace, dir, { ...opts, dispatch: async () => ({ ok: true, output: "x" }), land });
    expect(report.landed.length).toBeGreaterThan(0);
    expect(report.landed.some((l) => l.outcome === "rejected")).toBe(true);
  });
```

Run: `bun test ./tests/governance.test.ts`
**Expected: the first new test FAILS** if the tick re-offers; the second passes.

**Implement** in `src/governance.ts`. Replace the landing filter:

```ts
        finished = listWork(handle).filter((item) => {
          if (item.state !== "done") return false;
          // Skip anything already judged. The lander is idempotent, but relying
          // on that alone means the tick still pays for a model call per tick
          // on work that will never land.
          const seen = latestReview(handle, item.id);
          return seen === null || seen.outcome !== "landed";
        });
```

Add `latestReview` to the existing `import { openWork, listWork, type WorkItem } from "./work";`.

Run: `bun test ./tests/governance.test.ts ./tests/land.test.ts`
**Expected: all pass.**

Commit: `fix(governance): do not re-offer work that has already been reviewed`

### Task 4 — The queue that needs a person

**Test first.** Create `tests/blocked.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWork, propose, blockedWork, latestReview, recordReview } from "../src/work";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cod-blocked-"));
  dirs.push(dir);
  return dir;
}

describe("blockedWork", () => {
  test("only REJECTED work is blocked", () => {
    // A landed item is done. A skipped one never ran. Neither is waiting on a
    // person, and listing them would bury the ones that are.
    const dir = scratch();
    const handle = openWork(dir);
    const rejected = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "a", goal: "a" });
    const landed = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "b", goal: "b" });
    if (!rejected.ok || rejected.item === undefined) throw new Error("seed");
    if (!landed.ok || landed.item === undefined) throw new Error("seed");
    recordReview(handle, { workId: rejected.item.id, outcome: "rejected", reason: "no test", branch: `cod/${rejected.item.id}`, landedSha: "" });
    recordReview(handle, { workId: landed.item.id, outcome: "landed", reason: "merged", branch: `cod/${landed.item.id}`, landedSha: "abc123" });
    const blocked = blockedWork(handle);
    handle.close();
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.item.id).toBe(rejected.item.id);
    expect(blocked[0]?.review.reason).toContain("no test");
  });

  test("a work item that was never reviewed is not blocked", () => {
    const dir = scratch();
    const handle = openWork(dir);
    propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "a", goal: "a" });
    expect(blockedWork(handle)).toEqual([]);
    handle.close();
  });

  test("the oldest rejection comes first - it has been waiting longest", () => {
    const dir = scratch();
    const handle = openWork(dir);
    for (const goal of ["first", "second"]) {
      const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: goal, goal });
      if (!made.ok || made.item === undefined) continue;
      recordReview(handle, { workId: made.item.id, outcome: "rejected", reason: goal, branch: "", landedSha: "", reviewedAt: goal === "first" ? 1000 : 2000 });
    }
    const blocked = blockedWork(handle);
    handle.close();
    expect(blocked[0]?.review.reason).toBe("first");
  });

  test("a re-review that succeeds CLEARS it from the queue", () => {
    // The queue must not be a graveyard: a fixed item leaves it.
    const dir = scratch();
    const handle = openWork(dir);
    const made = propose(handle, { from: "engineering", to: "engineering", kind: "task", payload: "a", goal: "a" });
    if (!made.ok || made.item === undefined) throw new Error("seed");
    recordReview(handle, { workId: made.item.id, outcome: "rejected", reason: "no test", branch: "", landedSha: "" });
    expect(blockedWork(handle)).toHaveLength(1);
    recordReview(handle, { workId: made.item.id, outcome: "landed", reason: "merged", branch: "", landedSha: "s" });
    expect(blockedWork(handle)).toHaveLength(0);
    handle.close();
  });
});
```

Run: `bun test ./tests/blocked.test.ts`
**Expected: FAIL** with `Export 'blockedWork' not found`.

**Implement.** `blockedWork` is already added in Task 1, so this should now pass:
`bun test ./tests/blocked.test.ts` → **Expected: 4 pass.**

Then add the command. In `src/commands.ts`, immediately after the `cycle` command:

```ts
  /**
   * Work that stopped and needs a person.
   *
   * The company is autonomous, which does not mean it never halts - it means
   * that when it halts it says so. An item the reviewer rejected has no further
   * authority to fix itself, and an operator who cannot see it has no way to
   * unblock it.
   */
  async blocked(_positionals, flags, print) {
    const config = configFrom(flags);
    const { openWork, blockedWork } = await import("./work");
    const handle = openWork(config.stateDir);
    try {
      const blocked = blockedWork(handle);
      print(
        config,
        blocked,
        () =>
          blocked.length === 0
            ? "nothing is blocked"
            : [
                `${blocked.length} item(s) waiting on a person:`,
                ...blocked.map(
                  ({ item, review }) =>
                    `  ${item.id}  ${review.branch}\n      ${review.reason}`,
                ),
              ].join("\n"),
      );
    } finally {
      handle.close();
    }
  },
```

Add to `src/meta.ts`, next to the other command lines:
`  blocked  Work the reviewer stopped that needs a person`

Run: `bun test ./tests/`
**Expected: all pass.**

Commit: `feat(work): a queue of work that stopped, waiting for a person`

### Task 5 — `cod status` counts it

**Test first.** Append to `tests/cli.test.ts`:

```ts
  test("status reports how much is blocked, not only that the container is up", async () => {
    const proc = spawnCli(["status"], { cwd: home });
    // Container state and ledger state are different claims. A healthy-looking
    // status line that omits "three items are waiting on you" is the failure
    // this exists to prevent.
    expect(proc.stdout.toLowerCase()).toContain("blocked");
  });
```

Run: `bun test ./tests/cli.test.ts`
**Expected: FAIL** — `status` says nothing about blocked work.

**Implement** in `src/commands.ts`, in the object passed to `print` inside
`status`, add:

```ts
      blocked: ((): number => {
        try {
          const { openWork, blockedWork } = require("./work") as typeof import("./work");
          const handle = openWork(config.stateDir);
          try {
            return blockedWork(handle).length;
          } finally {
            handle.close();
          }
        } catch {
          return 0;
        }
      })(),
```

Use a top-level `await import` instead of `require` if the file's style refuses
`require` — check `src/commands.ts` first, because it uses dynamic `await import`
everywhere.

And add to the human format a single line, immediately after the supervisor line:

```ts
      `${blocked === 0 ? "no work is blocked" : `${blocked} item(s) blocked - see \`cod work blocked\``}`,
```

Run: `bun test ./tests/cli.test.ts`
**Expected: all pass.**

Commit: `feat(cli): status says how much work is waiting on a person`

### Task 6 — Landing into a shared repository, opt-in

The highest-risk piece, and the reason it goes last: `/work` is a named volume
and the workspace file is mounted read-only *on purpose*.

**Test first.** Append to `tests/image.test.ts`:

```ts
  test("WITHOUT a landing repo there is no /landing mount at all", () => {
    // The default must be byte-for-byte unchanged. An extra writable mount in
    // every workspace is a change nobody asked for and nobody reviewed.
    const spec = buildSpec(config, workspace);
    expect(spec.mounts.some((m) => m.target === "/landing")).toBe(false);
  });

  test("WITH a landing repo, /landing is mounted read-write at that exact path", () => {
    const spec = buildSpec({ ...config, landing: { repo: "/srv/shared" } }, workspace);
    const mount = spec.mounts.find((m) => m.target === "/landing");
    expect(mount).toBeDefined();
    expect(mount?.readOnly).toBe(false);
    expect(mount?.source).toBe("/srv/shared");
  });
```

Those two lines reference helpers that may not exist. Read `tests/image.test.ts`
and `src/docker.ts` first and use the real construction path — if the spec is
built inline inside `up()` rather than by an exported helper, **extract it into an
exported `buildWorkspaceSpec(config, workspace): ContainerSpec`** as the first
step of this task, so it can be tested at all. Do not assert against a literal.

Run: `bun test ./tests/image.test.ts`
**Expected: FAIL** on the second test.

**Implement.**

1. In `src/workspace.ts`, inside the `Workspace` object, add next to `governance`:

```ts
    /**
     * Where landed work is pushed, if anywhere.
     *
     * Optional and ABSENT by default, which is the important part. A fresh
     * workspace gets no writable host mount beyond its own state directory, so
     * this changes nothing until an operator names a path on purpose.
     */
    landing: z.object({
      repo: z.string().min(1),
    }).optional(),
```

2. In `src/commands.ts`, the workspace built by `init` does **not** set
   `landing` — leave it absent. The test in `tests/cli.test.ts` that builds a
   `Workspace` literal will need `landing: undefined` or the field optional; if
   `tsc` complains, add `landing: undefined` to that one literal.

3. In `src/docker.ts`, inside the `mounts` array in `up()`, after the `/work`
   entry:

```ts
          // OPT-IN ONLY. A writable mount of host state is the single most
          // dangerous thing this container could be given, so it happens only
          // when an operator names a path, and it is mounted at a fixed target
          // rather than wherever the host happens to keep it.
          ...(workspace.landing === undefined
            ? []
            : [{ source: workspace.landing.repo, target: "/landing", readOnly: false }]),
```

4. In `src/land.ts`, after the merge into the volume's `master`, push it:

```ts
  // Push to the shared repository, if the workspace named one. Without a
  // landing repo this is a no-op and the merge stays in the volume - which is
  // today's behaviour, unchanged.
  const landing = options.landingRepo;
  if (landing !== undefined && landing !== "/landing") {
    const pushed = git(landing, ["push", "origin", "HEAD:refs/heads/cod-landed"]);
    if (pushed === null) {
      return note(options, item, {
        outcome: "rejected",
        reason: "merged locally but could not push to the landing repo - the operator must check it",
      });
    }
  }
```

Add `readonly landingRepo?: string;` to `LandOptions` in `src/land.ts`, and in
`src/supervisor.ts` pass `landingRepo: parsed.data.landing?.repo` inside the
`land:` call's options object.

Run: `bun test ./tests/`
**Expected: all pass**, and `tests/image.test.ts` now asserts the default is
unchanged.

**Verify the live behaviour before committing.** In the sandbox workspace, run
`kilo models`-free:

```bash
docker exec <container> sh -lc 'ls -la /landing 2>&1 | head -3'
```

**Expected without `landing.repo`:** `ls: cannot access '/landing': No such file or directory`

Commit: `feat(landing): an opt-in shared repository for landed work`

### Task 7 — Mutation checks, then docs

**Mutate each new guard and confirm the suite fails.** Write the mutations to a
temporary file, do not commit them:

| Mutation | File | Expected failures |
|---|---|---|
| `latestReview` guard removed from `landWork` | `src/land.ts` | ≥ 2 (both new land tests) |
| `alreadyRetried` forced to `false` | `src/land.ts` | ≥ 1 |
| tick filter ignores `latestReview` | `src/governance.ts` | ≥ 1 |
| `blockedWork` returns everything | `src/work.ts` | ≥ 2 |
| landing mount unconditional | `src/docker.ts` | ≥ 1 |

Then update, in this order:

- `docs/OPEN_QUESTIONS.md` — close the three items, with the measurement that
  found them
- `docs/ROADMAP.md` — Stages 4 and 5 move from NOT STARTED to DONE, and the
  `landing` option is documented as opt-in
- `CHANGELOG.md` — one entry
- `skills/cod-operations/SKILL.md` — add `cod work blocked` to the triage section
  and a short "landing repo" note
- `README.md` — the doc map and the `blocked` command

Commit: `docs: the review queue, and where landed work goes`

## Tests / validation

Full gate, in this order, before any push:

```bash
cd /home/rohi/homelab/projects/corporate-on-demand
./node_modules/.bin/tsc --noEmit     # Expected: no output
bun test ./tests/                    # Expected: N pass, 0 fail, 0 fail in any form
sh verify.sh                         # Expected: "verify.sh: PASS"
```

Then the clean room, which is the only check that exercises the new mount:

```bash
sh scripts/cleanroom.sh /tmp/cod-review-queue
```

**Expected:** `RESULT: PASS`

Then the live proof, which is the only one that counts. Start a workspace, run one
job to completion, and confirm:

```bash
docker exec <container> sh -lc 'cat /cod/logs/cod.jsonl' | grep governance
docker exec <container> sh -lc 'git -C /work log --oneline master' | head -3
```

**Expected:** the first `[governance]` line appears with no human having run
anything, and the merge commit is on `master` in the volume.

**Negative control, which must FAIL.** Make the agent write a secret-shaped line
into its file, let the reviewer run, and confirm the item lands in `cod work
blocked` and NOT in `master`. If that passes when it should fail, the mechanical
check is decorative and this change is not done.

## Risks, tradeoffs, and open questions

- **The `review` table is an upsert, so there is no review history.** The branch
  and its commits are the history; the question being answered is "what is the
  current state of this item". A history table is a second thing to keep correct
  for no current benefit, and `git log` is strictly better at it.
- **A rejected item is now permanently skipped until re-dispatched.** That is the
  intent, and it is also a behaviour change: before, it was retried forever by
  accident. `cod work blocked` plus a manual `cod work run <id>` is the way out.
  There is no CLI command to clear a rejection yet — see open questions.
- **Task 6 is the only change to a security posture in this plan.** A writable
  host mount is the most dangerous thing this container could be given. It is
  opt-in, the default is asserted by a test, and the push target is a fixed ref
  (`refs/heads/cod-landed`) rather than whatever `HEAD` points at. It should get
  a second pair of eyes before it ships, because a test cannot tell you the path
  you chose is the right path.
- **`landing.repo` is not validated to be a git repository at `cod up` time.** A
  typo means the push fails at land time, after the merge already happened in the
  volume. Cheap fix, deliberately deferred: validate the path is a repo whose
  `origin` exists, in `up()`, and refuse to start rather than fail per-merge.
- **The reviewer's model call is still advisory by design.** Mechanical refusals
  are final; scope and test judgement is a real model read that a human can
  overrule by approving manually. Making the model authoritative over the
  mechanical checks is the one change that must never happen.
- **Unverified:** whether the tick's cost per rejected item is actually material
  at this company's scale. It is O(items blocked × ticks/minute) model calls, and
  nobody has watched that run for a day. Worth watching once rather than
  assuming.
- **Open, out of scope here:** no command clears a rejection; `cod work blocked`
  shows the reason but offers no next action beyond re-dispatching by hand.