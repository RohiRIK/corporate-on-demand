# Dual-backend agent runtime (opencode + Kilo Code)

## Goal

Make the agent runtime use **two** independent backends — opencode (OpenCode Zen)
and Kilo Code (`@kilocode/cli`) — selected per job by measured reliability, with
a mechanical success assertion that makes a *silently wrong* run impossible.

## Current context / assumptions

- Repo: `/home/rohi/homelab/projects/corporate-on-demand`, branch `main`, currently clean at `a6c3f5a`. 373 tests pass, `verify.sh` PASS.
- Agent execution is `src/agent.ts` → `buildArgs()` → `opencode run --pure --auto --format json -m <model> <prompt>`, run via `Bun.spawn` with `cwd` set to the job's git worktree.
- `--dir` is **not** used: measured to fail on a git worktree with an opaque "Unexpected server error".
- `src/events.ts` parses the JSONL stream into `ParsedStream { steps, answer, tokens, unparsed }`. It does **not** currently expose `step_finish`, tool-use events, or error events — those must be added.
- `src/drivers.ts` `driverFor(worker, company, options)` is the single seam between workspace and agent.
- `Worker.model` is a free-form non-empty string (`src/workspace.ts:24`).
- The container image is built by `docker/Dockerfile.sandbox`, which bundles three CLI entrypoints with `bun build --target=bun` (lines 56–58). It vendors `opencode` via `scripts/vendor-opencode.sh`.

### Measured evidence (this is the justification)

| | opencode / Zen | Kilo `:free` |
|---|---|---|
| Reliability, 12 trivial calls | ~25% (3 of 4 failed) | **12/12 = 100%** |
| Tool-calling | works | works — `read` then `write`, file created |
| Error text on failure | `agent exited 1: no detail` | `qwen/qwen3.8-27b:free is temporarily rate-limited upstream.` |
| Free models available | ~10, all via one gateway | **15 `:free` + `kilo/kilo-auto/free` + `kilo/openrouter/free`** |

Verified keyless and credential-free on this host, 2026-09-30:
- `kilo/kilo-auto/free`, `kilo/stepfun/step-3.7-flash:free`, `kilo/poolside/laguna-s-2.1:free`, `kilo/openrouter/free` → all returned `43` for `17+26`, and all performed `read`+`write` tool calls.
- `kilo/qwen/qwen3.8-27b:free` → `temporarily rate-limited upstream` (per-model rot exists here too).
- `kilo/anthropic/*`, `kilo/~google/*` → `401 PAID_MODEL_AUTH_REQUIRED`. The `:free` suffix is what matters, **not** the `~` prefix.

### The one thing that argues *against* a full replacement

`@kilocode/cli` is an **opencode fork** — its `package.json` keywords include `opencode`, and its own startup log line prints `opencode`. Its CLI surface is identical (`--pure`, `--format json`, `-m provider/model`).

So switching to Kilo alone would diversify the *model pool* but **not the engine** — the JSONL truncation bug documented upstream (`anomalyco/opencode#31435`, `#29866`, `#26855`, fixed-direction PR `#44933`) may be present in the fork too, and it is **unverified whether `@kilocode/cli@7.8.1` contains those fixes**.

Running **both** engines is therefore the point: it is the only way to get a real per-engine health signal instead of guessing, and it means a truncation bug in one does not silently disable the other.

## Architecture / approach

Introduce a `Backend` abstraction (`src/backend.ts`) that owns *how to build a command* and *how to judge a run*, with two implementations. `src/agent.ts` stops hardcoding `opencode` and delegates to a selected backend. A `src/registry.ts` keeps a rolling success/failure score per model and picks per job, with a circuit breaker. The success assertion in `src/assert.ts` is applied to **every** run regardless of backend — it is the correctness win and is backend-agnostic.

Order matters: **the assertion contract lands first**, on the existing opencode path alone, so the wrong-reason class dies before any new backend is introduced. Backend swap is then additive.

## Step-by-step tasks

### Task 1 — `ParsedStream` learns about completion, tools and errors (TDD)

The assertion needs three facts the parser currently throws away.

**Test first** — append to `tests/events.test.ts`:

```ts
describe("the fields the success assertion needs", () => {
  const good = [
    JSON.stringify({ type: "step_start", timestamp: 1, part: { type: "step-start" } }),
    JSON.stringify({ type: "tool_use", timestamp: 2, part: { type: "tool", tool: "write", state: { status: "completed" } } }),
    JSON.stringify({ type: "text", timestamp: 3, part: { type: "text", text: "done" } }),
    JSON.stringify({ type: "step_finish", timestamp: 4, part: { type: "step-finish", reason: "stop" } }),
  ].join("\n");

  test("a finished run reports stop, a completed tool and no errors", () => {
    const p = parseEventStream(good);
    expect(p.finished).toBe(true);
    expect(p.finishReason).toBe("stop");
    expect(p.completedTools).toEqual(["write"]);
    expect(p.errors).toEqual([]);
  });

  test("a TRUNCATED stream is not finished - this is the upstream bug", () => {
    // step_start with no step_finish: opencode broke out early and the run
    // looks successful unless we check. See anomalyco/opencode#31435.
    const truncated = good.split("\n").slice(0, 3).join("\n");
    expect(parseEventStream(truncated).finished).toBe(false);
  });

  test("a finish reason of 'unknown' is NOT a stop", () => {
    const odd = good.replace('"reason":"stop"', '"reason":"unknown"');
    expect(parseEventStream(odd).finished).toBe(true);
    expect(parseEventStream(odd).finishReason).toBe("unknown");
  });

  test("an error event is captured, not swallowed into unparsed", () => {
    const boom = JSON.stringify({ type: "error", error: { name: "APIError", data: { message: "rate limited", statusCode: 429 } } });
    const p = parseEventStream(`${good}\n${boom}`);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]?.message).toContain("rate limited");
  });

  test("only COMPLETED tool calls count", () => {
    const failed = good.replace('"status":"completed"', '"status":"error"');
    expect(parseEventStream(failed).completedTools).toEqual([]);
  });

  test("a shell tool that exited non-zero is recorded as not completed", () => {
    // supabase/evals' opencode parser checks state.metadata.exit for shell.
    const line = JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "bash", state: { status: "completed", metadata: { exit: 1 } } } });
    expect(parseEventStream(line).completedTools).toEqual([]);
  });
});
```

Run: `bun test ./tests/events.test.ts`
**Expected: 6 fail** with `Property 'finished' does not exist`.

**Implement** — in `src/events.ts`, extend the interface and the parser:

```ts
export interface AgentError {
  readonly name: string;
  readonly message: string;
  readonly statusCode?: number;
  /** The provider's correlation id, e.g. "err_a7a9b326". The join key to the log file. */
  readonly ref?: string;
}

export interface ParsedStream {
  readonly steps: readonly number[];
  readonly answer: string;
  readonly tokens: AgentTokens | null;
  readonly unparsed: readonly string[];
  /** A terminal step_finish with reason "stop" was seen. */
  readonly finished: boolean;
  /** The reason on the terminal step_finish, or null when there was none. */
  readonly finishReason: string | null;
  /** Tools that actually completed. A failed or non-zero tool is not here. */
  readonly completedTools: readonly string[];
  readonly errors: readonly AgentError[];
}
```

Inside the existing `for` loop in `parseEventStream`, add:

```ts
if (d.type === "step_finish") {
  const reason = str(d.part?.reason);
  if (reason !== "") { finished = true; finishReason = reason; }
}
if (d.type === "tool_use") {
  const part = isRecord(d.part) ? d.part : {};
  const tool = str(part.tool);
  const state = isRecord(part.state) ? part.state : {};
  const status = str(state.status);
  const meta = isRecord(state.metadata) ? state.metadata : {};
  const exit = typeof meta.exit === "number" ? meta.exit : 0;
  // A tool that reported `completed` but exited non-zero did not complete.
  // Believing the status field is how a failed build looks like a passing one.
  if (status === "completed" && exit === 0 && tool !== "") completedTools.push(tool);
}
if (d.type === "error") {
  const err = isRecord(d.error) ? d.error : {};
  const data = isRecord(err.data) ? err.data : {};
  const message = str(data.message);
  errors.push({
    name: str(err.name),
    message,
    ...(typeof data.statusCode === "number" ? { statusCode: data.statusCode } : {}),
    ...(/err_[a-z0-9]+/i.test(message) ? { ref: (/err_[a-z0-9]+/i.exec(message)?.[0] ?? "") } : {}),
  });
}
```

Add a `str()` helper if absent: `const str = (v: unknown): string => (typeof v === "string" ? v : "");`

Run: `bun test ./tests/events.test.ts` → **Expected: 6 pass, 0 fail**.

Commit: `feat(events): parse completion, completed tools and errors`

---

### Task 2 — the success assertion (TDD)

This is the deliverable that matters. A run that exits 0 is not a run that worked.

**Test first** — create `tests/assert.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseEventStream } from "../src/events";
import { judgeRun } from "../src/assert";

const line = (o: unknown) => JSON.stringify(o);

const GOOD = [
  line({ type: "step_start", part: { type: "step-start" } }),
  line({ type: "tool_use", part: { type: "tool", tool: "write", state: { status: "completed" } } }),
  line({ type: "text", part: { type: "text", text: "wrote the file" } }),
  line({ type: "step_finish", part: { type: "step-finish", reason: "stop" } }),
].join("\n");

describe("judgeRun", () => {
  test("a complete run with a completed tool PASSES", () => {
    const v = judgeRun({ raw: GOOD, code: 0, timedOut: false, elapsedMs: 9000, promptLength: 120 });
    expect(v.ok).toBe(true);
  });

  test("a TRUNCATED stream FAILS even though the exit code is 0", () => {
    // The exact upstream bug: opencode exits 0 having dropped the tail.
    const v = judgeRun({ raw: GOOD.split("\n").slice(0, 3).join("\n"), code: 0, timedOut: false, elapsedMs: 9000, promptLength: 120 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("no terminal step_finish");
  });

  test("exit 0 with NO text FAILS", () => {
    const v = judgeRun({ raw: line({ type: "step_finish", part: { reason: "stop" } }), code: 0, timedOut: false, elapsedMs: 100, promptLength: 10 });
    expect(v.ok).toBe(false);
  });

  test("exit 0 with NO completed tool FAILS - this is the wrong-reason case", () => {
    // An agent that changed nothing and said it was done. It exits 0 and
    // produces text, and it is still a failed job.
    const noTools = [line({ type: "text", part: { type: "text", text: "All done!" } }), line({ type: "step_finish", part: { reason: "stop" } })].join("\n");
    const v = judgeRun({ raw: noTools, code: 0, timedOut: false, elapsedMs: 100, promptLength: 10 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("no completed tool");
  });

  test("an error event FAILS even when a step_finish says stop", () => {
    const bad = [line({ type: "text", part: { type: "text", text: "ok" } }), line({ type: "step_finish", part: { reason: "stop" } }), line({ type: "error", error: { name: "APIError", data: { message: "boom" } } })].join("\n");
    const v = judgeRun({ raw: bad, code: 0, timedOut: false, elapsedMs: 100, promptLength: 10 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("boom");
  });

  test("an EMPTY PROMPT is refused BEFORE dispatch - the AGENTS.md guard", () => {
    // We shipped a bug where an agent was given no instructions and still
    // completed the task. A prompt shorter than this is refused outright.
    const v = judgeRun({ raw: GOOD, code: 0, timedOut: false, elapsedMs: 100, promptLength: 0 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("prompt");
  });

  test("a TIMEOUT FAILS and says so", () => {
    const v = judgeRun({ raw: GOOD, code: 0, timedOut: true, elapsedMs: 180000, promptLength: 50 });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("timed out");
  });

  test("a non-zero exit FAILS and carries the provider's ref id", () => {
    const err = line({ type: "error", error: { name: "UnknownError", data: { message: "Unexpected server error (ref err_a7a9b326)" } } });
    const v = judgeRun({ raw: err, code: 1, timedOut: false, elapsedMs: 500, promptLength: 50 });
    expect(v.ok).toBe(false);
    expect(v.ref).toBe("err_a7a9b326");
  });

  test("a run slower than the budget FAILS - a 280s 'success' is a failure", () => {
    const v = judgeRun({ raw: GOOD, code: 0, timedOut: false, elapsedMs: 280000, promptLength: 50, budgetMs: 60000 });
    expect(v.ok).toBe(false);
  });

  test("an ok verdict explains itself for the operator", () => {
    const v = judgeRun({ raw: GOOD, code: 0, timedOut: false, elapsedMs: 9000, promptLength: 120 });
    expect(v.detail).toContain("write");
  });
});
```

Run: `bun test ./tests/assert.test.ts` → **Expected: cannot find module `../src/assert`**.

**Implement** — create `src/assert.ts`:

```ts
/**
 * Deciding whether a run actually worked.
 *
 * Exit code 0 is not evidence. We shipped a real bug where an agent was given
 * no instructions at all, produced a confident answer, exited 0, and the job
 * looked fine. Judging the STREAM is what makes that class of failure
 * impossible: a real run has a terminal step_finish, a completed tool, no
 * error events, and was given a prompt at all.
 *
 * The upstream truncation bug (anomalyco/opencode#31435) makes this load
 * bearing rather than belt-and-braces: opencode can exit 0 having dropped the
 * tail of the stream.
 */

import { parseEventStream, type AgentTokens } from "./events";

/** Below this, the agent was not really told what to do. */
export const MIN_PROMPT_LENGTH = 20;

export interface JudgeInput {
  readonly raw: string;
  readonly code: number;
  readonly timedOut: boolean;
  readonly elapsedMs: number;
  readonly promptLength: number;
  readonly budgetMs?: number;
}

export interface Verdict {
  readonly ok: boolean;
  /** One line, operator-readable. */
  readonly reason: string;
  readonly detail?: string;
  /** The provider's correlation id, when the stream carried one. */
  readonly ref?: string;
  readonly tokens: AgentTokens | null;
  readonly completedTools: readonly string[];
}

export function judgeRun(input: JudgeInput): Verdict {
  const parsed = parseEventStream(input.raw);
  const base = { tokens: parsed.tokens, completedTools: parsed.completedTools };
  const ref = parsed.errors.find((e) => e.ref !== undefined)?.ref;
  const withRef = (ok: boolean, reason: string, detail?: string): Verdict =>
    ({ ok, reason, tokens: parsed.tokens, completedTools: parsed.completedTools, ...(ref === undefined ? {} : { ref }), ...(detail === undefined ? {} : { detail }) });

  // Checked FIRST, before anything is dispatched, in the caller too. Here it
  // is a second line of defence so a bad call can never be recorded as good.
  if (input.promptLength < MIN_PROMPT_LENGTH) {
    return withRef(false, `prompt too short (${input.promptLength} chars); the agent was not given a task`);
  }
  if (input.timedOut) {
    return withRef(false, `agent timed out after ${input.elapsedMs}ms`);
  }
  if (input.budgetMs !== undefined && input.elapsedMs > input.budgetMs) {
    return withRef(false, `run took ${input.elapsedMs}ms, over the ${input.budgetMs}ms budget`);
  }
  if (parsed.errors.length > 0) {
    return withRef(false, `agent reported an error: ${parsed.errors[0]?.message ?? "unknown"}`);
  }
  if (input.code !== 0) {
    return withRef(false, `agent exited ${input.code}`);
  }
  if (!parsed.finished) {
    return withRef(false, "no terminal step_finish: the run was truncated, not completed");
  }
  if (parsed.answer === "") {
    return withRef(false, "agent produced no text");
  }
  if (parsed.completedTools.length === 0) {
    // The wrong-reason case, stated plainly: text and exit 0 with no tool
    // having completed means the agent claimed to do something it did not do.
    return withRef(false, "no completed tool: the agent produced text without doing anything");
  }
  return withRef(true, "ok", `${parsed.completedTools.length} tool(s): ${parsed.completedTools.join(", ")}`);
}
```

Run: `bun test ./tests/assert.test.ts` → **Expected: 10 pass**.

Commit: `feat(assert): a run is successful only if the stream proves it`

---

### Task 3 — wire the assertion into `runAgent` (TDD)

**Test first** — append to `tests/agent.test.ts`:

```ts
describe("runAgent judges the run, not the exit code", () => {
  const good = [
    JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
    JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "write", state: { status: "completed" } } }),
    JSON.stringify({ type: "text", part: { type: "text", text: "wrote it" } }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish", reason: "stop" } }),
  ].join("\n");

  const runner = (stdout: string, code = 0) => async () => ({ stdout, stderr: "", code, timedOut: false });

  test("a complete run returns the model's text", async () => {
    const out = await runAgent(cron, worker, async () => {}, { runner: runner(good), workdir: "/work/x" });
    expect(out).toContain("wrote it");
  });

  test("exit 0 with a TRUNCATED stream is reported as a failure", async () => {
    const out = await runAgent(cron, worker, async () => {}, { runner: runner(good.split("\n").slice(0, 2).join("\n")), workdir: "/work/x" });
    expect(out).toContain("truncated");
  });

  test("exit 0 with text but no completed tool is a FAILURE, not a success", async () => {
    const noTools = [JSON.stringify({ type: "text", part: { type: "text", text: "All done!" } }), JSON.stringify({ type: "step_finish", part: { type: "step-finish", reason: "stop" } })].join("\n");
    const out = await runAgent(cron, worker, async () => {}, { runner: runner(noTools), workdir: "/work/x" });
    expect(out).toContain("no completed tool");
  });

  test("the provider's ref id reaches the operator", async () => {
    const err = JSON.stringify({ type: "error", error: { name: "UnknownError", data: { message: "Unexpected server error (ref err_a7a9b326)" } } });
    const out = await runAgent(cron, worker, async () => {}, { runner: runner(err, 1), workdir: "/work/x" });
    expect(out).toContain("err_a7a9b326");
  });
});
```

Run: `bun test ./tests/agent.test.ts` → **Expected: the truncation and no-tool tests fail** (current code returns `parsed.answer` happily).

**Implement** — in `src/agent.ts`, at the end of `runAgent`, replace the block from `if (result.timedOut)` down to `return parsed.answer;` with a single judgement:

```ts
  const verdict = judgeRun({
    raw: `${result.stdout}\n${result.stderr}`,
    code: result.code,
    timedOut: result.timedOut,
    elapsedMs: Date.now() - startedAt,
    promptLength: prompt.length,
    budgetMs: timeoutMs,
  });
  if (!verdict.ok) return `agent FAILED: ${verdict.reason}`;
  return parsed.answer;
```

Record `const startedAt = Date.now();` at the top of the function body, and import `judgeRun` from `./assert`.

Run: `bun test ./tests/agent.test.ts` and `bun test ./tests/` → **Expected: all pass**.

Commit: `feat(agent): judge every run against the stream, not the exit code`

---

### Task 4 — the backend abstraction (TDD)

`opencode` is currently hardcoded at `src/agent.ts:25`. Make it pluggable.

**Test first** — create `tests/backend.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { BACKENDS, buildFor, modelIds } from "../src/backend";

const cron = { name: "author", agent: "builder", task: "write the answer", schedule: "0 3 * * *", enabled: true };

describe("the two backends", () => {
  test("both engines are available", () => {
    expect(BACKENDS.map((b) => b.id).sort()).toEqual(["kilo", "opencode"]);
  });

  test("opencode keeps its exact current command shape", () => {
    // A regression guard: changing this silently is how a job stops running.
    expect(buildFor("opencode", "opencode/space-bunny-free", "hi", "/work/x"))
      .toEqual(["opencode", "run", "--pure", "--auto", "--format", "json", "-m", "opencode/space-bunny-free", "--title", "cod-author", '"hi"']);
  });

  test("kilo uses the same flags - it is an opencode fork", () => {
    const args = buildFor("kilo", "kilo/kilo-auto/free", "hi", "/work/x");
    expect(args.slice(0, 6)).toEqual(["kilo", "run", "--pure", "--format", "json"]);
    expect(args).not.toContain("--auto"); // kilo rejects it; verified
    expect(args[args.indexOf("-m") + 1]).toBe("kilo/kilo-auto/free");
  });

  test("an unknown backend is a named error, not a silent default", () => {
    expect(() => buildFor("nope", "m", "hi", "/work/x")).toThrow(/unknown backend/);
  });

  test("modelIds lists the free models each backend offers", () => {
    expect(modelIds("kilo")).toContain("kilo/kilo-auto/free");
    expect(modelIds("opencode")).toContain("opencode/space-bunny-free");
  });

  test("every advertised kilo model really is a :free model or a free router", () => {
    // `kilo/anthropic/*` returns 401 PAID_MODEL_AUTH_REQUIRED. Advertising a
    // paid model in a $0 system is a budget bug waiting to happen.
    for (const id of modelIds("kilo")) {
      expect(id.endsWith(":free") || id.endsWith("/free")).toBe(true);
    }
  });
});
```

Run: `bun test ./tests/backend.test.ts` → **Expected: cannot find module `../src/backend`**.

**Implement** — create `src/backend.ts`:

```ts
/**
 * The two agent engines, and the command each one needs.
 *
 * Both speak the same JSONL contract because one IS the other: @kilocode/cli
 * is an opencode fork (its package keywords include "opencode" and its own log
 * line prints "opencode"). So the difference is the BINARY and the MODEL POOL,
 * not the wire format - and that is what makes running both cheap.
 *
 * Running both is deliberate. Because they share an engine, switching to one
 * would diversify the model pool but not the failure modes: the upstream
 * truncation bug would follow us either way. Two engines give a real per-engine
 * health signal, and a bug in one does not silently disable the other.
 */

export interface Backend {
  readonly id: string;
  readonly bin: string;
  /** Free, credential-free model ids, verified keyless on 2026-09-30. */
  readonly models: readonly string[];
}

export const BACKENDS: readonly Backend[] = [
  {
    id: "opencode",
    bin: "opencode",
    models: ["opencode/space-bunny-free", "opencode/big-pickle", "opencode/nemotron-3.5-lightning-free"],
  },
  {
    id: "kilo",
    bin: "kilo",
    models: [
      "kilo/kilo-auto/free",
      "kilo/openrouter/free",
      "kilo/stepfun/step-3.7-flash:free",
      "kilo/poolside/laguna-s-2.1:free",
      "kilo/nvidia/nemotron-3.5-lightning:free",
      "kilo/cohere/north-mini-code:free",
    ],
  },
];

export function modelIds(backendId: string): readonly string[] {
  const found = BACKENDS.find((b) => b.id === backendId);
  if (found === undefined) throw new Error(`unknown backend "${backendId}"`);
  return found.models;
}

export function buildFor(backendId: string, model: string, prompt: string, _workdir: string): string[] {
  const backend = BACKENDS.find((b) => b.id === backendId);
  if (backend === undefined) throw new Error(`unknown backend "${backendId}"`);
  // NO --dir, on either engine: measured to fail on a git worktree. The
  // confinement is the spawn's cwd, set in localRunner.
  const common = [backend.bin, "run", "--pure", "--format", "json", "-m", model, "--title", `cod-${cronName(prompt)}`];
  return backendId === "opencode"
    ? [...common.slice(0, 3), "--auto", ...common.slice(3), JSON.stringify(prompt)]
    : [...common, JSON.stringify(prompt)];
}
```

Simplify: pass the cron name in rather than deriving it from the prompt. Use the signature `buildFor(backendId, model, prompt, title)` and have `src/agent.ts` pass `cod-${cron.name}`.

Run: `bun test ./tests/backend.test.ts` → **Expected: 6 pass**.

Commit: `feat(backend): opencode and kilo as interchangeable engines`

---

### Task 5 — per-model scoring and a circuit breaker (TDD)

Rotation is what converts 25% into something usable, and it is free.

**Test first** — create `tests/registry.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { Registry } from "../src/registry";

test("a model that always fails is dropped from rotation", () => {
  const r = new Registry();
  for (let i = 0; i < 3; i += 1) r.record({ backend: "kilo", model: "bad", ok: false, at: i * 1000 });
  expect(r.healthy("kilo", "bad")).toBe(false);
  expect(r.healthy("kilo", "good")).toBe(true);
});

test("a failure that follows a success still counts against the model", () => {
  // Consecutive failures trip the breaker; a 200 that failed our assertion is
  // still a failure. This is the ONLY mechanism that catches a model which
  // answers but answers wrongly.
  const r = new Registry();
  r.record({ backend: "kilo", model: "m", ok: true, at: 1 });
  r.record({ backend: "kilo", model: "m", ok: false, at: 2 });
  expect(r.healthy("kilo", "m")).toBe(true); // one failure is not a pattern
  r.record({ backend: "kilo", model: "m", ok: false, at: 3 });
  expect(r.healthy("kilo", "m")).toBe(false);
});

test("a tripped model comes back after the cooldown", () => {
  const r = new Registry({ cooldownMs: 1000, threshold: 2 });
  r.record({ backend: "kilo", model: "m", ok: false, at: 0 });
  r.record({ backend: "kilo", model: "m", ok: false, at: 1 });
  expect(r.healthy("kilo", "m")).toBe(false);
  r.record({ backend: "kilo", model: "m", ok: true, at: 2000 });
  expect(r.healthy("kilo", "m")).toBe(true);
});

test("the picker prefers a backend whose models are all healthy", () => {
  const r = new Registry();
  for (let i = 0; i < 3; i += 1) r.record({ backend: "opencode", model: "opencode/space-bunny-free", ok: false, at: i });
  const pick = r.pick([["opencode", "opencode/space-bunny-free"], ["kilo", "kilo/kilo-auto/free"]]);
  expect(pick).toEqual({ backend: "kilo", model: "kilo/kilo-auto/free" });
});

test("when EVERYTHING is unhealthy the picker still returns something", () => {
  // A registry that returns nothing is an outage of its own making.
  const r = new Registry();
  for (let i = 0; i < 9; i += 1) r.record({ backend: "kilo", model: "kilo/kilo-auto/free", ok: false, at: i });
  expect(r.pick([["kilo", "kilo/kilo-auto/free"]])).toEqual({ backend: "kilo", model: "kilo/kilo-auto/free" });
});

test("the picker rotates across healthy models rather than repeating one", () => {
  const r = new Registry();
  const seen = new Set<string>();
  for (let i = 0; i < 6; i += 1) {
    const p = r.pick([["kilo", "kilo/kilo-auto/free"], ["kilo", "kilo/stepfun/step-3.7-flash:free"]]);
    if (p) seen.add(p.model);
  }
  expect(seen.size).toBeGreaterThan(1);
});

test("a success raises the score so it is picked more often", () => {
  const r = new Registry();
  r.record({ backend: "kilo", model: "a", ok: true, at: 1 });
  r.record({ backend: "kilo", model: "a", ok: true, at: 2 });
  const p = r.pick([["kilo", "a"], ["kilo", "b"]]);
  expect(p?.model).toBe("a");
});
```

Run: `bun test ./tests/registry.test.ts` → **Expected: cannot find module `../src/registry`**.

**Implement** — create `src/registry.ts`:

```ts
/**
 * Which model should this job use?
 *
 * Measured, not guessed. We were pinned to ONE model on a shared best-effort
 * pool and rode it to a ~25% success rate; Zen's free tier is documented to
 * have per-model rot (muse-spark 500s, deepseek retired upstream), so the fix
 * is to rotate, not to hope.
 *
 * A model that answers but fails the assertion counts as a FAILURE. That is the
 * only mechanism that protects against a model being confidently wrong, which
 * is the failure this system cares most about.
 */

export interface Attempt { readonly backend: string; readonly model: string; readonly ok: boolean; readonly at: number }

export interface Pick { readonly backend: string; readonly model: string }

export class Registry {
  private readonly stats = new Map<string, { ok: number; fail: number; consecutiveFail: number; trippedAt: number | null }>();
  private cursor = 0;

  public constructor(
    private readonly threshold = 2,
    private readonly cooldownMs = 300_000,
  ) {}

  private key(backend: string, model: string): string { return `${backend}::${model}`; }

  public record(attempt: Attempt): void {
    const k = this.key(attempt.backend, attempt.model);
    const s = this.stats.get(k) ?? { ok: 0, fail: 0, consecutiveFail: 0, trippedAt: null };
    if (attempt.ok) { s.ok += 1; s.consecutiveFail = 0; s.trippedAt = null; }
    else { s.fail += 1; s.consecutiveFail += 1; if (s.consecutiveFail >= this.threshold) s.trippedAt = attempt.at; }
    this.stats.set(k, s);
  }

  public healthy(backend: string, model: string, now = 0): boolean {
    const s = this.stats.get(this.key(backend, model));
    if (s === undefined) return true;
    if (s.trippedAt === null) return true;
    if (now - s.trippedAt < this.cooldownMs) return false;
    // Cooldown elapsed: let it back in, but keep the consecutive-failure count
    // so two more failures trip it again immediately.
    return s.consecutiveFail < this.threshold;
  }

  public pick(candidates: readonly Pick[], now = 0): Pick | null {
    if (candidates.length === 0) return null;
    const healthy = candidates.filter((c) => this.healthy(c.backend, c.model, now));
    // Everything is sick. Still dispatch: a provider outage is not ours to
    // refuse work over, and refusing is its own kind of silent failure.
    const pool = healthy.length > 0 ? healthy : candidates;
    const scored = pool.map((c) => {
      const s = this.stats.get(this.key(c.backend, c.model));
      const rate = s === undefined || s.ok + s.fail === 0 ? 0.5 : s.ok / (s.ok + s.fail);
      return { c, rate };
    });
    // Rotate the starting point so a single healthy model is not hammered by
    // every job in the same order.
    const offset = this.cursor % scored.length;
    this.cursor += 1;
    const rotated = [...scored.slice(offset), ...scored.slice(0, offset)];
    rotated.sort((x, y) => y.rate - x.rate);
    const best = rotated[0];
    // Break ties randomly so two equally-good models both get traffic.
    const tied = rotated.filter((x) => x.rate === best.rate);
    return tied[Math.floor(Math.random() * tied.length)]?.c ?? null;
  }
}
```

Run: `bun test ./tests/registry.test.ts` → **Expected: 7 pass**.

Commit: `feat(registry): rotate models by measured success, break on consecutive failure`

---

### Task 6 — install Kilo in the image

**Step 6a** — add to `docker/Dockerfile.sandbox`, immediately after the existing `bun build` block:

```dockerfile
# Kilo Code, the second engine.
#
# @kilocode/cli is an opencode fork, so it speaks the same JSONL contract and
# the same flags. Installed globally so the agent driver can select either
# engine per job. Pinned: an unpinned agent runtime is how a working image
# becomes a broken one on a random rebuild.
RUN bun add --global @kilocode/cli@7.8.1 \
    && ln -sf /usr/local/bin/kilo /usr/local/bin/kilocode \
    && kilo --version
```

If `bun add --global` places the binary elsewhere, locate it with `command -v kilo` in the same `RUN` and symlink from there — **verify with `kilo --version` printing `7.8.1`**, and do not proceed until it does.

**Step 6b** — verify the whole image:

```bash
cd /home/rohi/homelab/projects/corporate-on-demand
docker build -f docker/Dockerfile.sandbox -t cod-sandbox:test .
docker run --rm --user 1000:1000 cod-sandbox:test sh -lc 'kilo --version && kilo models 2>/dev/null | grep -c ":free"'
```

**Expected output:** a version line, then a count ≥ 15.

Commit: `feat(image): ship the kilo engine alongside opencode`

---

### Task 7 — the driver selects a backend per job

**Test first** — append to `tests/agent.test.ts`:

```ts
describe("the backend is selectable per job", () => {
  test("runAgent can be pinned to kilo and builds the kilo command", async () => {
    let seen: readonly string[] = [];
    const spy: CommandRunner = async (args) => { seen = args; return { stdout: "", stderr: "", code: 0, timedOut: false }; };
    await runAgent(cron, worker, async () => {}, { runner: spy, backend: "kilo", model: "kilo/kilo-auto/free", workdir: "/work/x" });
    expect(seen[0]).toBe("kilo");
    expect(seen).toContain("kilo/kilo-auto/free");
  });

  test("the default backend is still opencode", async () => {
    let seen: readonly string[] = [];
    const spy: CommandRunner = async (args) => { seen = args; return { stdout: "", stderr: "", code: 0, timedOut: false }; };
    await runAgent(cron, worker, async () => {}, { runner: spy, workdir: "/work/x" });
    expect(seen[0]).toBe("opencode");
  });
});
```

Run: `bun test ./tests/agent.test.ts` → **Expected: 2 fail** (`backend` not on `RunAgentOptions`).

**Implement** — in `src/agent.ts`:
- add `readonly backend?: string;` to `RunAgentOptions`
- change `buildArgs` to delegate: `return buildFor(options.backend ?? "opencode", model, prompt, `cod-${cron.name}`);`
- keep `buildArgs` exported so the existing tests keep passing.

In `src/drivers.ts`, make `driverFor` take an optional registry and record each outcome:

```ts
// after runAgent returns, when a registry was supplied:
registry?.record({ backend, model, ok: !out.startsWith("agent FAILED"), at: Date.now() });
```

**The model string decides the backend.** `Worker.model` is already a free-form string; a worker whose model starts `kilo/` is dispatched to the kilo engine. That keeps the workspace schema unchanged and makes the choice visible in `cod.json`:

```ts
export function backendForModel(model: string): string {
  return model.includes("/") && BACKENDS.some((b) => b.models.includes(model)) ? model.split("/")[0] : "opencode";
}
```

Run: `bun test ./tests/` → **Expected: all pass**.

Commit: `feat(driver): pick the engine from the worker's model id`

---

### Task 8 — a live comparison, then docs

**Step 8a** — measure both engines honestly before claiming anything:

```bash
cd /home/rohi/homelab/projects/corporate-on-demand
for b in opencode kilo; do
  echo "== $b =="
  ok=0
  for i in $(seq 1 8); do
    out=$(docker run --rm --user 1000:1000 cod-sandbox:test sh -lc \
      "cd /tmp && timeout 90 $b run --pure --format json -m $( [ $b = kilo ] && echo kilo/kilo-auto/free || echo opencode/space-bunny-free ) 'What is 17 plus 26? Reply with only the number.'" 2>&1)
    if echo "$out" | grep -q '"43"'; then ok=$((ok+1)); fi
  done
  echo "$b: $ok/8"
done
```

**Expected:** a number for each. **Record the real numbers in the docs** — whatever they are. If kilo is not better on the day you measure, say so; the multi-backend design still stands on the health-signal argument alone.

**Step 8b** — update, in this order:
- `docs/OPEN_QUESTIONS.md` — close the provider-reliability question, cite the measured numbers
- `skills/cod-operations/SKILL.md` — replace the single-provider health check with a two-engine one, and document that `agent FAILED:` in results means the assertion rejected a run that exited 0
- `docs/SECURITY_POSTURE.md` — note that a second engine is installed, MIT, from npm
- `README.md`, `CHANGELOG.md` — the dual-backend capability

Commit: `docs: dual-backend runtime, with measured numbers`

---

## Tests / validation

Full gate before considering this done:

```bash
cd /home/rohi/homelab/projects/corporate-on-demand
./node_modules/.bin/tsc --noEmit          # Expected: no output
bun test ./tests/                         # Expected: all pass, 0 fail
sh verify.sh                              # Expected: "verify.sh: PASS"
sh scripts/cleanroom.sh /tmp/cod-dual     # Expected: PASS from a fresh clone, deleted image
```

Then the live proof, which is the only one that counts:

```bash
docker ps -aq --filter name=cod-sandbox | xargs -r docker rm -f
```

Build a workspace whose worker model is `kilo/kilo-auto/free`, run one real job, and confirm from `cod results` that the line shows a real file list — for example `[1 file: answer.txt]` — which is only possible if a completed tool was observed.

**Negative control, which must fail:** a job whose agent produces text but completes no tool must be reported `agent FAILED: no completed tool`, not as a success. If this passes when it should fail, the assertion is decorative and the work is not done.

## Risks, tradeoffs, and open questions

- **Kilo is a fork of opencode, so the engine is not diversified — only the model pool.** Two engines give a health signal, not independence. If the shared truncation bug is present in `@kilocode/cli@7.8.1`, the Task 2 assertion is what catches it. **Unverified either way**; worth a targeted check against `anomalyco/opencode#31435` before trusting Kilo unattended.
- **The `require ≥1 completed tool` rule will reject legitimate read-only jobs.** A job that only inspects and reports makes no tool call. Decide now: either such jobs are out of scope, or add a per-job `expectTools: false`. My recommendation is to make it explicit per job rather than loosen the global rule, because a global exception is exactly how the wrong-reason class came back.
- **Kilo's free pool will rot too.** `qwen3.8-27b:free` was already rate-limited on first contact. The registry's rotation handles it; do not hand-pin a model.
- **My reliability sample is small** — 12 arithmetic calls, 3 models, one prompt, one afternoon. Task 8a exists to get a real number before the docs claim anything.
- **`kilo-auto/free` is an auto-router**, so the model behind a given call is not reproducible. That is fine for rotation and bad for debugging; the `ref` id and the log file are the only handle.
- **Adding a second engine doubles the image size and the supply chain.** Both are npm-published; both are MIT.
- The `ref` id → log-file lookup (Task 3 makes the id available; Task 8 documents it) is deliberately left as a follow-up rather than done here, so this change stays reviewable.
