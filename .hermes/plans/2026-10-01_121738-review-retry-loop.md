# Rejection must produce a fix demand that is actually acted on

**Date:** 2026-10-01
**Repo:** `/home/rohi/homelab/projects/corporate-on-demand`
**Branch:** `main`
**Style:** TDD, one commit per task, no task merged without a failing test first.

---

## Goal

Make a rejected piece of work loop back to the worker **with the reviewer's stated objection and required fix in its brief**, for a bounded number of attempts — instead of retrying once with the identical prompt and then giving up.

## Current context / assumptions

### The owner's rule this implements

> Rejection is only valid if it comes with a reason, a demand for a fix, and then the system **keeps working on it**.

### What the code actually does today

`src/land.ts` line 100:

```ts
if (changes && !alreadyRetried && (options.maxRetries ?? 1) > 0) {
```

`alreadyRetried` is a **boolean** derived from whether the previous review row said `changes-requested`:

```ts
const alreadyRetried = previous?.outcome === "changes-requested";
```

Two consequences, both verified by reading the code:

1. **Raising `maxRetries` above 1 changes nothing.** The boolean is still true after the first retry, so a second retry can never happen. Any value other than `1` is currently inert.
2. **The retry never sees the reviewer's objection.** This is the serious one.

### The serious defect — the "retry" is not briefed

`src/land.ts` writes the reviewer's words onto the row:

```ts
handle.db.query("UPDATE work SET lease_owner = NULL, lease_epoch = lease_epoch + 1, reason = ? WHERE id = ?")
  .run(`review: ${verdict.reason}`, item.id);
```

But nothing ever reads `work.reason` when building the agent's brief.

`src/supervisor.ts` line 99:

```ts
const goal = textOfItem(item);
```

and `src/runwork.ts` line 102:

```ts
export function textOfItem(item: WorkItem): string {
  try {
    const parsed: unknown = JSON.parse(item.payload);
    if (typeof parsed === "object" && parsed !== null) {
      const text = (parsed as { text?: unknown }).text;
      if (typeof text === "string" && text !== "") return text;
    }
  } catch { }
  return item.payload;
}
```

`textOfItem` reads **`payload` only**. Verified by grep: the string `reason` appears **zero** times in `src/runwork.ts`'s brief path, and `textOfItem` is the sole source of the goal handed to `writeInstructions` and the driver.

**So the retry re-runs the exact same prompt, with zero knowledge of what was objected to.**

The comment in `src/land.ts` claiming "the next attempt carries the reviewer's words rather than starting over" is **false as written**. This is the third time in this session that a comment or doc described behaviour the code did not have — treat it as the primary thing to fix.

### Why this matters more than the retry count

Without the brief carrying the objection, the retry is a coin flip. Raising the count alone would burn free model calls re-running identical work. **Task 1 and Task 2 are the fix; the retry count is the smaller half.**

### What already exists and must not regress

- `review` table, one row per `work_id`, upserted, `CREATE TABLE IF NOT EXISTS`.
- Durable guard in `landWork`: `landed`/`rejected` are never re-reviewed, survives restart.
- Mechanical checks (`mechanicalChecks` in `src/review.ts`) are deterministic and **no model may override them**. They cover: secret shapes, forbidden actions, and global paths.
- `cod work blocked` lists terminally rejected items; `cod work unblock <id> [why]` clears one (refuses `landed`).
- The governance tick skips items whose latest review is `landed` **or** `rejected`.

### The policy this plan encodes

| Verdict kind | Retry? | Why |
|---|---|---|
| `mechanicalChecks(diff).ok === false` | **Never** | A rule, not an opinion. Retrying `package.json` burns effort on something that must not happen. |
| `request-changes` from the model reviewer | **Yes, up to N** | An objection to fixable work. This is the loop the owner asked for. |
| `reject` from the model reviewer | **No** | The reviewer's final word. Recorded with its reason and queued. |

N defaults to **3**, configurable per workspace. Not unbounded: a company that argues forever never converges, and free providers are not free in wall-clock.

## Architecture / proposed approach

One new pure function builds the brief — `briefFor(item)` in `src/runwork.ts` — which returns `textOfItem(item)` plus any accumulated review reasons carried on `work.reason`. Both `src/supervisor.ts` and `src/run-work-cli.ts` call it instead of `textOfItem`, so the cron path and the ledger path are briefed identically.

Retry counting moves from a boolean to a durable integer: an `attempts` column on the `review` table, added by an idempotent migration, so the count survives a restart exactly as the boolean does. `landWork` keeps looping while `attempts < maxRetries`, and each attempt **appends** its objection to `work.reason` so attempt 3 sees objections 1 and 2.

---

## Step-by-step tasks

### Task 0 — Confirm the premise before changing anything

Read-only. Paste the output into the commit message of Task 1.

```bash
cd /home/rohi/homelab/projects/corporate-on-demand
grep -c 'item.reason' src/runwork.ts src/supervisor.ts src/run-work-cli.ts
```

Expected: `0` for all three (or no match lines for `runwork.ts`). This is the evidence that the reviewer's words never reach the agent.

### Task 1 — RED: the brief must carry the objection

Create `tests/brief.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { briefFor } from "../src/runwork";
import type { WorkItem } from "../src/work";

function item(reason: string): WorkItem {
  return {
    id: "w-test-0001",
    state: "ready",
    from_agent: "engineering",
    to_agent: "builder",
    payload: JSON.stringify({ text: "Write notes/today.md", targetPaths: ["notes/today.md"] }),
    goal: "Write notes/today.md",
    reason,
    blast_radius: 0,
    lease_owner: null,
    lease_epoch: 0,
    attempt: 0,
    created_at: 0,
    updated_at: 0,
  } as unknown as WorkItem;
}

describe("the brief an agent is given", () => {
  test("with no review history it is the task alone", () => {
    expect(briefFor(item(""))).toBe("Write notes/today.md");
  });

  test("a plain task with no review reason is unchanged", () => {
    expect(briefFor(item("draft"))).toBe("Write notes/today.md");
  });

  test("AFTER A REVIEW the objection is IN the brief", () => {
    // THE test. Without this, a retry re-runs the identical prompt and the
    // whole retry policy is decoration.
    const brief = briefFor(item("review: the interpolated values are all blank"));
    expect(brief).toContain("Write notes/today.md");
    expect(brief).toContain("the interpolated values are all blank");
  });

  test("the objection is labelled, so the agent knows it is feedback", () => {
    expect(briefFor(item("review: add a test")).toLowerCase()).toContain("review");
  });

  test("EVERY accumulated objection is present, not just the last", () => {
    const brief = briefFor(item("review (attempt 1): no test\nreview (attempt 2): test does not run"));
    expect(brief).toContain("no test");
    expect(brief).toContain("test does not run");
  });

  test("a reason that is NOT a review is still not mistaken for one", () => {
    // Guards the label: anything that does not look like accumulated review
    // feedback must not be presented to the model as a reviewer's verdict.
    const brief = briefFor(item("could not reach the model provider"));
    expect(brief).toContain("Write notes/today.md");
  });
});
```

Run it — it must fail:

```bash
bun test ./tests/brief.test.ts
```

Expected: `error: Export named 'briefFor' not found in module "../src/runwork"` plus failing assertions. That is RED.

Commit nothing yet; a RED test alone is not a commit.

### Task 2 — GREEN: implement `briefFor`

In `src/runwork.ts`, immediately after `textOfItem` (line ~113), add:

```ts
/**
 * What the agent is actually told, including any objection it must fix.
 *
 * `textOfItem` reads the payload alone, so a retried item was handed the exact
 * same prompt as its first attempt and had no way to know what the reviewer
 * objected to. The retry existed; the fix demand did not.
 *
 * Only feedback the review loop itself wrote is treated as a review: it all
 * starts with `review:`. An unrelated `reason` - "could not reach the model" -
 * is left alone rather than dressed up as a reviewer's verdict, because telling
 * a model "the reviewer said X" when nobody said X is worse than saying nothing.
 */
export function briefFor(item: WorkItem): string {
  const task = textOfItem(item);
  const reason = (item.reason ?? "").trim();
  if (!reason.startsWith("review")) return task;
  return [
    task,
    "",
    "Your previous attempt was reviewed and returned. Fix these points:",
    reason,
  ].join("\n");
}
```

Switch both callers over:

```bash
# src/supervisor.ts:99
grep -n 'const goal = textOfItem(item);' src/supervisor.ts
# src/run-work-cli.ts:79
grep -n 'const goal = textOfItem(item);' src/run-work-cli.ts
```

In **both** files change `textOfItem` → `briefFor` at those lines, and update the import
(`import { runWorkItem, textOfItem } from "./runwork"` → `briefFor`) so the unused
import is removed.

```bash
bun test ./tests/brief.test.ts
bun x tsc --noEmit
```

Expected: `6 pass`, `0 fail`; typecheck `CLEAN`.

Commit:

```
feat(brief): hand the agent the objection, not just the task again

The retry existed and was useless. landWork writes the reviewer's words onto
work.reason, and nothing read it: the brief is built by textOfItem, which reads
payload only. So attempt two received the identical prompt and could not know
what it had done wrong.

Verified before changing anything: `grep -c 'item.reason'` is 0 in runwork.ts,
supervisor.ts and run-work-cli.ts.

briefFor appends accumulated review feedback. Anything not written by the review
loop is left out rather than relabelled as a verdict.
```

### Task 3 — RED: more than one retry must be possible

Add to `tests/land.test.ts`. Read the file first (line ~110) for the existing
`requesting changes retries ONCE` test and copy its fixture setup verbatim —
the helper that builds `dir`, `branchWith`, the `ask` fake and the item.

```ts
test("requesting changes retries UP TO the configured cap, not once", async () => {
  // Raised to 3 this must loop three times and then stop. With the old boolean
  // it stops after the first, whatever the cap says.
  // ... same fixture as the existing retry test, with maxRetries: 3
  // ... call landWork three times, expect changes-requested each time
  // ... call a fourth time, expect rejected
});
```

Run `bun test ./tests/land.test.ts -t "up to the configured cap"`. Expected: **fails**, because the second call returns `rejected`.

### Task 4 — GREEN: a durable attempt counter

`src/work.ts`, inside the schema block that already contains
`CREATE TABLE IF NOT EXISTS review (...)` (near line 73 in the schema string):
add the column.

Because `IF NOT EXISTS` means an **existing** database will NOT gain a new
column, an idempotent migration is required. Find the existing schema-init
function and add, immediately after the schema is applied:

```ts
// Older databases have a review table without `attempts`. IF NOT EXISTS cannot
// add a column, so check before altering - an unconditional ALTER fails on
// every database that already has it.
const reviewColumns = new Set(
  handle.db.query("PRAGMA table_info(review)").all().map((r) => String(r.name)),
);
if (!reviewColumns.has("attempts")) {
  handle.db.query("ALTER TABLE review ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
}
```

Then extend `recordReview`'s input with an optional `attempts` and write it in
the upsert. Read `recordReview` first (in `src/work.ts`) for its exact current
shape and keep the existing `ON CONFLICT` clause; add `attempts = excluded.attempts`
to the DO UPDATE set-list.

In `src/land.ts` replace:

```ts
const alreadyRetried = previous?.outcome === "changes-requested";
```

with:

```ts
// How many times this item has already been sent back. From the RECORD, not
// from a boolean: a boolean cannot count, which is why maxRetries above 1 was
// inert no matter what it was set to.
const attemptsSoFar = previous?.outcome === "changes-requested" ? (previous.attempts ?? 1) : 0;
```

and the guard:

```ts
if (changes && attemptsSoFar < (options.maxRetries ?? DEFAULT_MAX_RETRIES)) {
```

Add at the top of `src/land.ts`:

```ts
/**
 * Three, not one.
 *
 * One retry with an unbriefed agent was a coin flip; the brief is now real, so
 * the retries are worth spending. Still bounded: an unbounded loop is a company
 * that argues forever and never converges.
 */
export const DEFAULT_MAX_RETRIES = 3;
```

Pass `attempts: attemptsSoFar + 1` into the `note(...)` call on the retry path.

```bash
bun test ./tests/land.test.ts ./tests/brief.test.ts
bun x tsc --noEmit
```

Expected: all pass. Commit:

```
feat(land): count retries durably, so maxRetries above 1 stops being inert

`alreadyRetried` was a boolean, so the second retry could never happen whatever
maxRetries said - every value except 1 was decoration. The count now comes from
the review row, which is durable, so it survives the restart that used to reset
every Set in this file.

Default is 3 and configurable per workspace. Still bounded on purpose.
```

### Task 5 — RED: a mechanical refusal must never loop

Add to `tests/land.test.ts`:

```ts
test("a MECHANICAL refusal never retries, at any cap", async () => {
  // A global path is a rule, not an opinion. Retrying it burns effort on
  // something that must never happen.
  // fixture with maxRetries: 5 and a diff touching package.json
  // expect the FIRST outcome to be rejected, and work.reason unchanged
});
```

Run it. Expected: **fails** — today a mechanical failure is reported as a
`request-changes` by some paths and can be retried.

### Task 6 — GREEN: structural refusals are terminal

In `src/land.ts`, `mechanicalChecks(diff)` is already computed for
`judgeReview`. Bind it:

```ts
const mechanical = mechanicalChecks(diff);
const verdict = await judgeReview({ diff, task: item.payload, mechanical, ask: options.ask });
```

Then, **before** the retry branch:

```ts
// A mechanical finding is a RULE, not an opinion. Sending it back to the
// worker would be asking it to try again at something that must never happen,
// so it is terminal regardless of the retry cap - and the worker never sees it
// as review feedback, because a retry brief would invite it to argue.
if (!mechanical.ok) {
  return note(options, item, {
    outcome: "rejected",
    reason: `refused before review: ${mechanical.findings.join("; ")}`,
  });
}
```

Because this returns before the retry path is reached, `work.reason` is left as
it was and `briefFor` will not present it as a review.

```bash
bun test ./tests/land.test.ts
```

Expected: all pass. Commit:

```
fix(land): a mechanical refusal is terminal, whatever the retry cap

A global path, a secret shape or a forbidden action is a rule, not an opinion.
Under the new loop it would have been retried, inviting the worker to argue with
a deterministic check and burning a free model call to do it.

Refused before review, with every finding named, and not recorded as review
feedback - so briefFor will not hand it back as something to fix.
```

### Task 7 — reasons accumulate across attempts

`src/land.ts`, on the retry path, replace the single overwrite:

```ts
.run(`review: ${verdict.reason}`, item.id);
```

with an append that keeps prior objections:

```ts
// Every objection so far, not only the newest. Attempt three that only sees
// attempt two's objection may fix that one and regress the first, and the
// reviewer will then say so for a fourth time.
const prior = handle.db.query("SELECT reason FROM work WHERE id = ?").get(item.id) as
  | { reason: string | null }
  | undefined;
const priorReview = (prior?.reason ?? "").startsWith("review") ? `${prior?.reason}\n` : "";
.run(`${priorReview}review (attempt ${attemptsSoFar + 1}): ${verdict.reason}`, item.id);
```

Add a test asserting attempt 3's brief contains attempt 1's objection verbatim.

```bash
bun test ./tests/land.test.ts ./tests/brief.test.ts
```

Commit: `feat(land): every objection is carried forward, not just the last`.

### Task 8 — configure the cap per workspace

`src/workspace.ts`: add to the governance object, optional with a default:

```ts
maxReviewRetries: z.number().int().min(0).max(10).optional(),
```

`.strict()` is in use, so without this an operator adding the key gets a schema error.
`src/supervisor.ts`: pass `maxRetries: workspace.governance.maxReviewRetries` into
the `landWork` options. Undefined falls through to `DEFAULT_MAX_RETRIES`.

Test in `tests/readonly.test.ts`'s existing schema-style block, or add
`tests/governance.test.ts` case: omitted → default 3; `0` → mechanical refusals
still terminal, `request-changes` rejected immediately.

Commit: `feat(config): maxReviewRetries, default 3`.

### Task 9 — mutation-verify every guard

These must each FAIL the suite when broken. Restore the file after each.

| Mutation | Expected |
|---|---|
| `briefFor` ignores `item.reason` | brief tests fail |
| `attemptsSoFar` → `const attemptsSoFar = 0` | cap test fails |
| `maxRetries ?? DEFAULT_MAX_RETRIES` → `?? 1` | cap test fails |
| mechanical early-return deleted | mechanical test fails |
| prior-reason append → overwrite | accumulate test fails |

```bash
bun test ./tests          # expect 0 fail after restoring
bun x tsc --noEmit
sh verify.sh
```

Commit: `test: mutation-verify the review loop`.

### Task 10 — make the docs true

- `src/land.ts` header comment: replace "**The retry lives here and only here.**"
  paragraph — it currently claims a policy that was not implemented. State the
  real one: capped loop, mechanical terminal, brief carries the objection.
- `docs/OPEN_QUESTIONS.md`: add a **Closed** entry for "a rejection stops the
  work", naming `briefFor` and `DEFAULT_MAX_RETRIES`.
- `CHANGELOG.md`: Unreleased entry.
- `skills/cod-operations/SKILL.md`: `blocked` now means *structural* refusal or
  exhausted retries, not "reviewed once". Say which.

Then extend `tests/docs.test.ts` if needed so a `Closed` entry naming
`briefFor` finds it in `src/` — that test already exists and will enforce this.

```bash
bun test ./tests && bun x tsc --noEmit && sh verify.sh
```

Commit: `docs: the retry policy, as implemented rather than as claimed`.

### Task 11 — final gates

```bash
cd /home/rohi/homelab/projects/corporate-on-demand
bun test ./tests
bun x tsc --noEmit
sh verify.sh
sh scripts/cleanroom.sh /tmp/cod-review-loop
git status --porcelain          # expect empty
docker ps -aq --filter name=cod-   # expect none
```

Expected: `0 fail`, typecheck clean, `verify.sh: PASS`, `RESULT: PASS`, clean tree,
no leftover containers.

Push only after all of the above are green.

---

## Risks, tradeoffs, and open questions

**Free-provider wall-clock.** Three attempts × a slow provider is real waiting. The
outer timeout in `src/agent.ts` already bounds each attempt; the loop does not
remove it. If a deployment shows retries dominating tick time, lower the cap — it
is configurable per workspace for exactly this.

**A reviewer that is simply wrong.** With a real brief, a fixable objection
usually converges. A mistaken reviewer could now burn all three retries before
the item is queued. That is the intended trade: bounded effort, then a human
sees it in `cod work blocked` with the accumulated reasons. If this proves too
noisy in practice, the lever is the cap, not removing the reason.

**`briefFor` changes every dispatch's prompt, not only retries.** It is a no-op
when `reason` is empty or does not start with `review`, which is the case for all
cron work — verified by the second test in `tests/brief.test.ts`. The
`startsWith("review")` guard is the thing keeping that true; if a future
non-review reason ever begins with the word "review", it will be mislabelled.
That is a known sharp edge, documented at the function.

**The `attempts` migration.** `CREATE TABLE IF NOT EXISTS` cannot add a column, so
the migration is mandatory, not optional. It is guarded by a `PRAGMA table_info`
check so it is idempotent. If it is skipped, existing workspaces throw on the
first review after upgrade.

**Interaction with the governance tick.** The tick skips items whose latest review
is `landed` or `rejected`. A `changes-requested` item is put back to `ready`, so
the tick will pick it up again — that is the loop, and it means a retried item
consumes a dispatch slot on the next tick. `maxDispatch` already bounds a tick;
confirm the two bounds compose sanely if you raise the cap above 3.

**Open question — what the worker should do with a `reject`.** This plan treats
the reviewer's `reject` as final and queues it. An alternative reading of the
owner's rule is that a `reject` should also loop once with its reason. The plan
takes the narrower reading because `request-changes` already covers "fixable",
and a `reject` that is not fixable would burn the whole cap each time. **If the
owner wants `reject` to loop too, that is a two-line change to the guard in Task
4 and one more test.**

**Not in scope.** Whether the company should run for days, whether `landing.repo`
should push to a real remote, and systemd boot enablement are separate decisions
and are not touched here.