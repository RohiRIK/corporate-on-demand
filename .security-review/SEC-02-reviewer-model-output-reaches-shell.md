# SEC-02 — Model output reaches the shell: the reviewer's own words are re-executed

**Severity: SEVERE (blocking)**
**Locations: `src/land.ts:156` (model text stored) → `src/runwork.ts:131-141` (`briefFor`) → `src/run-work-cli.ts:79-91` (`cron.task`) → `src/agent.ts:132` (`buildPrompt`) → `src/agent.ts:71` (`sh -lc`)**
**Class: CWE-78 OS command injection / CWE-74 injection into a downstream interpreter**

This file resolves the open question left open in SEC-01. **The answer: yes, and the reachable source is the model itself, not the operator.**

## The chain

**1. The reviewer's verdict is model output, stored verbatim.**
`src/land.ts:131` calls `judgeReview`, which asks a model. `src/land.ts:155-157`:

```ts
handle.db.query("UPDATE work SET reason = ? WHERE id = ?")
  .run(`${priorReview}review (attempt ${attemptsSoFar + 1}): ${verdict.reason}`, item.id);
```

`verdict.reason` is `answer.trim().slice(0, 300)` (`src/review.ts:155-157`) — free text produced by the `reviewer` agent, i.e. by whatever the model decided to emit. There is no sanitisation, no allowlist, no rejection of shell metacharacters. It is written into the work item's `reason` column.

**2. `briefFor` splices that text into the task.**
`src/runwork.ts:131-141`:

```ts
const reason = (item.reason ?? "").trim();
if (!reason.startsWith("review")) return task;
return [task, "", "Your previous attempt was reviewed and returned. Fix these points:", reason].join("\n");
```

The returned string becomes the next attempt's task text.

**3. That text becomes `cron.task`.**
`src/run-work-cli.ts:79-91`: `const goal = briefFor(item)` → `task: goal`.

**4. `buildPrompt` embeds it.** `src/agent.ts:132`: `` `Your job: ${cron.task}` ``.

**5. `localRunner` hands it to a shell.** `src/agent.ts:71`: `Bun.spawn(["sh", "-lc", args.join(" ")])`, with the prompt emitted by `JSON.stringify` at `src/backend.ts:149`.

## Why this is remote, not operator error

The trigger requires no attacker-controlled `cod.json`. It requires only that the *reviewer model* emit `` ` ` `` or `$(...)` in its one-sentence reason — which is entirely plausible output for a model asked to "Answer with exactly one of: approve, request changes, reject - then one sentence why" (`src/review.ts:101`). Reasons like "the diff still `npm install`s rather than checking" or "run `git status` first" contain backticks as ordinary prose punctuation. The reviewer is describing code to the worker, and its sentence lands in a shell.

So the loop the system is built around converts the reviewer's prose into command execution on the next attempt. A `request-changes` verdict is the trigger. Every retry is another execution.

The severity is also raised by *when* it fires: `backend.extra` includes `--auto` on both engines (`src/backend.ts:63`, `:81`), so tool-use permission is already granted at the moment of execution, and `agent.ts:81` sets `cwd` to the worktree — the injection is confined to the worktree only by that one field.

Note this makes the SEC-01 fix *more* urgent, not less, and it constrains the fix: removing the `join` closes the injection, but the underlying design defect is that a model-authored string is used as command text at all.

## Concrete correction

Primary (defence in depth, both required):

1. **Remove the shell** — SEC-01's fix. `Bun.spawn(args, {...})` with the raw prompt as its own argv element.
2. **Do not build the task from model text.** `briefFor` should not concatenate a model-authored string into anything downstream treats as an instruction carrier without at minimum a strict character policy (reject `` ` ``, `$(`, `;`, `|`, `&`, `>`, `<`, newline-leading whitespace). Better: keep the reviewer's words in a *file* in the worktree that the agent reads (`AGENTS.md` is already written there by `run-work-cli.ts:98-106`), and keep `cron.task` free of untrusted text.

Do not rely on `startsWith("review")` at `runwork.ts:134` as a trust boundary — it is a *shape* test on a prefix, and it is what decides to treat the string as reviewer text and splice it in.

## Verification performed

Read-only, by reading the code path end to end as instructed. No probe executed. Each hop above was read at the cited lines.