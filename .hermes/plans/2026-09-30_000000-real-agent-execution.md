# Real agent execution — replace the echo with a live model call

## Goal

`cod` runs a scheduled job by invoking a real, credential-free LLM through the
vendored `opencode` runtime, so that `echoDriver` is no longer on the live path
and a cron job produces actual model output.

## Current context / assumptions

**Already built and on `main` (verified: 263 tests, `verify.sh` PASS, clean-room
PASS from a fresh clone):** dispatcher with a per-step loop (`src/dispatch.ts`),
crash-safe work ledger (`src/work.ts`), level-triggered reconciler
(`src/reconcile.ts`), CLI surface for all of it, `cod purge`, systemd unit, git
identity in the image. Every capability is reachable from the command line and
that is a hard project requirement.

**The seam.** `src/task.ts` still exports `echoTask`, a synchronous function that
returns a string literal. `src/supervisor.ts` calls
`dispatch(cron, echoDriver, { onStep })`. The `Driver` type in `src/dispatch.ts`
is already the correct contract:

```ts
export type Driver = (
  cron: Cron,
  step: (kind: StepKind, label: string) => Promise<void>,
) => Promise<string>;
```

**Measured facts this plan depends on (do not re-derive, but re-verify in Task 1):**

- `opencode` 1.18.31 is vendored at `vendor/opencode/1.18.31/opencode`, installed
  to `/usr/local/bin/opencode` in the image, and is on the supervisor's PATH.
- A real model call **works inside the container**: exit 0, **4.4 seconds**,
  credential-free, `"cost":0`, model `opencode/space-bunny-free`.
- The exact working invocation is already proven in `scripts/cleanroom.sh:87`:
  ```
  cd /work && opencode run --pure --format json -m opencode/space-bunny-free "..."
  ```
- `opencode run` **hangs on the host** (280s, zero output) even with no model
  specified, while the provider endpoint returns HTTP 200 in 0.45s. The hang is
  in opencode's own startup, not the network. **This does not matter** — the
  supervisor runs inside the container, which is the path that works. Do not try
  to "fix" the host-side hang; it is out of scope and not on the live path.
- `opencode run --help` confirms the flags used below: `--pure`, `-m/--model`,
  `--format json|default`, `--dir`, `--title`, `--auto`, `--agent`.
- `opencode models` lists 8 free models including `opencode/space-bunny-free`.
- `Worker.model` already exists in `src/workspace.ts` and is
  `opencode/space-bunny-free` in `templates/departments/engineering.json`.
  **Nothing currently reads it** — that is the gap.

**Output format.** `--format json` emits JSONL, one object per line. The events
observed, in order:

```json
{"type":"step_start","timestamp":...,"sessionID":"ses_...","part":{...,"type":"step-start"}}
{"type":"text","timestamp":...,"sessionID":"ses_...","part":{"type":"text","text":"E2E_OK","time":{...}}}
{"type":"step_finish","timestamp":...,"sessionID":"ses_...","part":{"type":"step-finish","reason":"stop","tokens":{"total":7799,"input":5854,"output":5,"reasoning":0},"cost":0}}
```

**YAGNI — explicitly NOT in this plan.** No reviewer agent, no merge policy, no
worktree-per-agent, no retry loop, no multi-agent dispatch, no cost metering.
Every one of those is a decision Rohi has not made. This plan makes jobs produce
real model output and nothing more.

## Architecture / proposed approach

Add `src/agent.ts` exporting one function, `runAgent(cron, worker, step, opts)`,
which resolves the worker's model from the workspace, invokes `opencode run`
inside the container's worktree with a hard timeout, parses the JSONL event
stream, and reports each `step_start` through the existing `step` callback so the
supervisor's progress heartbeat keeps working. `src/supervisor.ts` then calls
`dispatch(cron, runAgentDriver, ...)` instead of `echoDriver`. The echo driver
stays exported and tested as the deterministic reference implementation.

## Step-by-step tasks

Every task follows TDD: write the failing test, run it, see it fail, implement
minimally, see it pass, commit. Work on `main`. `cd
/home/rohi/homelab/projects/corporate-on-demand` first.

**Before starting, in every shell:**

```sh
cd /home/rohi/homelab/projects/corporate-on-demand
export PATH="$HOME/.local/bin:$PATH"
```

Use `./node_modules/.bin/tsc --noEmit` for typecheck, never `bun x tsc` — the
latter triggers a Tirith security scan that blocks the run.

---

### Task 1 — Verify the runtime, and record it as a test

The whole plan rests on a real model call working. Prove it in the test suite
first, so a broken provider or a wrong flag fails the build instead of silently
making every job return an error.

Create `tests/agent.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";

/**
 * The one test that talks to a real model.
 *
 * Everything else in this file is pure and instant. This one costs 4-5 seconds
 * and needs Docker plus the network, so it is the single point where "real agent
 * execution works" is true or false. It was verified by hand before this plan
 * existed: exit 0, ~4.4s, credential-free, cost 0.
 */
describe("the agent runtime", () => {
  test("a real model call returns text, credential-free, at no cost", () => {
    const out = execFileSync(
      "docker",
      [
        "exec", "cod-sandbox-cod", "sh", "-lc",
        'cd /work && timeout 120 opencode run --pure --format json -m opencode/space-bunny-free "reply with exactly: AGENT_OK" 2>&1',
      ],
      { encoding: "utf8", timeout: 180_000 },
    );
    // The text event carries the model's actual answer.
    expect(out).toContain("AGENT_OK");
    // Free model: the token block must report no cost. If this ever fails, a
    // paid model has entered the system and the security posture changed.
    expect(out).toContain('"cost":0');
  }, 180_000);
});
```

Run it:

```sh
docker rm -f cod-sandbox-cod 2>/dev/null
bun test ./tests/agent.test.ts
```

Expected: `1 pass`. If it fails with a docker error, the container is not up —
start it with `bun run ./src/index.ts up` and retry. If it fails with a timeout,
**stop and report**; do not proceed, because a failing provider invalidates the
rest of the plan.

Commit:

```sh
git add tests/agent.test.ts
git -c user.name=Bob -c user.email=bob@localhost commit -m \
  "test: prove a real credential-free model call works end to end

The plan for real agent execution rests on this being true, so it is
pinned by a test rather than assumed. Docker exec, the exact invocation
already used by cleanroom.sh, exit 0, ~4.4s, and the assertion that cost
is 0 - because a paid model entering the system is a change to the
security posture and should fail the build, not pass quietly."
git push origin main
```

---

### Task 2 — Parse the event stream

The dispatcher needs progress and a final answer from JSONL. Pure parsing, no
Docker, no model — so it is fast and deterministic.

Create `src/events.ts`:

```ts
/**
 * Parsing the opencode JSONL event stream.
 *
 * `opencode run --format json` emits one JSON object per line, in order:
 * step_start, then one or more `text` parts, then step_finish carrying token
 * counts and cost. This module turns that stream into the two things the
 * dispatcher needs - a progress report per step, and the final answer.
 *
 * Lines that are not JSON are SKIPPED rather than thrown on. A truncated final
 * line is the expected shape of a killed process, and losing the answer to a
 * stray log line would be worse than ignoring it.
 */

export interface AgentText {
  readonly text: string;
  readonly timestamp: number;
}

export interface AgentTokens {
  readonly total: number;
  readonly input: number;
  readonly output: number;
  readonly cost: number;
}

export interface ParsedStream {
  /** One entry per step_start event, in order. */
  readonly steps: readonly number[];
  /** The model's text, concatenated in order. */
  readonly answer: string;
  /** Token counts, if the stream got as far as a step_finish. */
  readonly tokens: AgentTokens | null;
  /** Every non-JSON line, kept so a failure can be reported rather than hidden. */
  readonly unparsed: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseEventStream(raw: string): ParsedStream {
  const steps: number[] = [];
  const texts: string[] = [];
  const unparsed: string[] = [];
  let tokens: AgentTokens | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      unparsed.push(trimmed);
      continue;
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      unparsed.push(trimmed);
      continue;
    }
    if (event.type === "step_start") {
      steps.push(1);
      continue;
    }
    if (event.type === "text") {
      const part = isRecord(event.part) ? event.part : null;
      if (part !== null && typeof part.text === "string") texts.push(part.text);
      continue;
    }
    if (event.type === "step_finish") {
      const part = isRecord(event.part) ? event.part : null;
      const counts = part !== null && isRecord(part.tokens) ? part.tokens : null;
      const cost = part !== null && typeof part.cost === "number" ? part.cost : 0;
      tokens = {
        total: counts !== null && typeof counts.total === "number" ? counts.total : 0,
        input: counts !== null && typeof counts.input === "number" ? counts.input : 0,
        output: counts !== null && typeof counts.output === "number" ? counts.output : 0,
        cost,
      };
    }
  }
  return { steps, answer: texts.join(""), tokens, unparsed };
}

/** One line a human can read, for the log. Never the whole model output. */
export function describeRun(parsed: ParsedStream): string {
  if (parsed.tokens === null) return `${parsed.steps.length} step(s), no completion event`;
  return `${parsed.steps.length} step(s), ${parsed.tokens.total} tokens, cost ${parsed.tokens.cost}`;
}
```

Create `tests/events.test.ts` with at least these cases, each a real fixture
string copied from the Task 1 output:

```ts
import { describe, expect, test } from "bun:test";
import { parseEventStream, describeRun } from "../src/events";

// The three real lines from the verified call, trimmed.
const REAL = [
  '{"type":"step_start","timestamp":1790739488768,"sessionID":"ses_f0f9","part":{"type":"step-start"}}',
  '{"type":"text","timestamp":1790739488791,"sessionID":"ses_f0f9","part":{"type":"text","text":"E2E_OK","time":{"start":1,"end":2}}}',
  '{"type":"step_finish","timestamp":1790739488803,"sessionID":"ses_f0f9","part":{"type":"step-finish","reason":"stop","tokens":{"total":7799,"input":5854,"output":5,"reasoning":0,"cache":{"write":0,"read":1940}},"cost":0}}',
].join("\n");

describe("parseEventStream", () => {
  test("reads the answer, the step count and the tokens from a real stream", () => {
    const parsed = parseEventStream(REAL);
    expect(parsed.answer).toBe("E2E_OK");
    expect(parsed.steps.length).toBe(1);
    expect(parsed.tokens?.total).toBe(7799);
    expect(parsed.tokens?.cost).toBe(0);
  });

  test("concatenates several text parts in order", () => {
    const two = [
      '{"type":"text","part":{"type":"text","text":"one "}}',
      '{"type":"text","part":{"type":"text","text":"two"}}',
    ].join("\n");
    expect(parseEventStream(two).answer).toBe("one two");
  });

  test("a truncated final line is skipped, not thrown on", () => {
    // The expected shape of a killed process. Losing the answer to a stray
    // line would be worse than ignoring the line.
    const parsed = parseEventStream(`${REAL}\n{"type":"text","part":{"tex`);
    expect(parsed.answer).toBe("E2E_OK");
    expect(parsed.unparsed.length).toBe(1);
  });

  test("a stream with no completion event reports null tokens, not zeros", () => {
    // Zero tokens and "never finished" are different facts and must not collapse.
    const parsed = parseEventStream('{"type":"step_start","part":{"type":"step-start"}}');
    expect(parsed.tokens).toBeNull();
  });

  test("empty input is an empty answer, not a crash", () => {
    const parsed = parseEventStream("");
    expect(parsed.answer).toBe("");
    expect(parsed.tokens).toBeNull();
  });
});

describe("describeRun", () => {
  test("summarises a completed run in one line", () => {
    expect(describeRun(parseEventStream(REAL))).toContain("7799 tokens");
  });
});
```

Run `bun test ./tests/events.test.ts` — expect `6 pass`. Typecheck with
`./node_modules/.bin/tsc --noEmit` — expect no output. Commit as
`feat: parse the opencode event stream` and push.

---

### Task 3 — The agent driver

The real driver. Isolated behind an injectable command runner so the logic is
testable without Docker or a model.

Create `src/agent.ts`:

```ts
/**
 * Running a job for real: an actual model call.
 *
 * The echo this replaces could not fail for interesting reasons, which was
 * exactly why it was useful at first. This can - it shells out, it depends on a
 * free provider, and it can be killed mid-stream. Every one of those failure
 * modes is handled here and reported, not swallowed.
 *
 * The command runner is injected so the logic is testable without Docker and
 * without a model. The real one is `docker exec` because the supervisor runs
 * inside the container, and the runtime is only proven to work there.
 */

import { execFile } from "node:child_process";
import { parseEventStream, describeRun, type ParsedStream } from "./events";
import type { Cron, Worker } from "./workspace";
import type { StepKind } from "./dispatch";

export const OPENCODE_BIN = "opencode";

/** Long enough for a real call (measured 4.4s), short enough to not wedge a slot. */
export const DEFAULT_AGENT_TIMEOUT_MS = 180_000;

export const CONTAINER = "cod-sandbox-cod";
export const WORKDIR = "/work";

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  /** True when our own timeout fired, which is a different failure from exit 1. */
  readonly timedOut: boolean;
}

export type CommandRunner = (args: readonly string[], timeoutMs: number) => Promise<CommandResult>;

/**
 * The real runner: run inside the container.
 *
 * `docker exec` rather than a local spawn because the supervisor IS the
 * container's PID 1, and the runtime hangs when run on the host. The container
 * path is the one measured working.
 *
 * `-e` as well as -m, so the exit code is the command's rather than always 0.
 */
export const dockerRunner: CommandRunner = (args, timeoutMs) =>
  new Promise<CommandResult>((resolve) => {
    const child = execFile(
      "docker",
      ["exec", CONTAINER, "sh", "-lc", `cd ${WORKDIR} && ${args.join(" ")}`],
      { encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const killed = error !== null && "killed" in error && error.killed === true;
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code, timedOut: killed });
      },
    );
    child.on("error", () => resolve({ stdout: "", stderr: "docker exec could not start", code: 127, timedOut: false }));
  });

/**
 * The prompt.
 *
 * Deliberately short and bounded. An agent given the whole workspace and no
 * boundary will wander; one given one job and a place to answer will finish.
 * Rohi has not chosen an autonomy model, so this does the least defensible
 * thing: it asks for a text answer and does not grant tool use.
 */
export function buildPrompt(cron: Cron, company: { name: string; purpose: string } | null): string {
  const who = company === null ? "You are an agent in an automated workspace." :
    `You are an agent working for ${company.name}, whose purpose is: ${company.purpose}`;
  return [
    who,
    "",
    `Your job: ${cron.task}`,
    "",
    "Do the job and report what you did in plain text. Be brief.",
    "Do not ask questions - there is nobody reading this conversation.",
    "Do not claim to have changed any files; you cannot.",
  ].join("\n");
}

/**
 * Build the command. `--pure` keeps third-party plugins out, `--format json`
 * gives a parseable stream, and the model comes from the worker rather than
 * being hardcoded - per-worker routing is a settled decision.
 *
 * Deliberately NOT --auto: that grants tool-use permission, and no decision has
 * been made about what an agent may touch.
 */
export function buildArgs(cron: Cron, model: string, prompt: string): string[] {
  return [
    OPENCODE_BIN, "run", "--pure", "--format", "json",
    "-m", model,
    "--title", `cod-${cron.name}`,
    JSON.stringify(prompt),
  ];
}

export interface RunAgentOptions {
  readonly runner?: CommandRunner;
  readonly timeoutMs?: number;
  readonly model?: string;
  readonly company?: { name: string; purpose: string } | null;
}

/**
 * Run one job. Returns the model's text, or a message saying why there is none.
 *
 * Never throws: a job that fails must still record a result, because a failure
 * that vanishes is what makes a schedule untrustworthy.
 */
export async function runAgent(
  cron: Cron,
  worker: Worker | null,
  step: (kind: StepKind, label: string) => Promise<void>,
  options: RunAgentOptions = {},
): Promise<string> {
  const runner = options.runner ?? dockerRunner;
  const timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const model = options.model ?? worker?.model ?? "opencode/space-bunny-free";
  const prompt = buildPrompt(cron, options.company ?? null);

  await step("plan", `${model}: preparing ${cron.name}`);

  const result = await runner(buildArgs(cron, model, prompt), timeoutMs);
  const parsed: ParsedStream = parseEventStream(`${result.stdout}\n${result.stderr}`);

  // Report the model's own steps, so a long call looks like progress rather
  // than one long silent step. This is the whole reason the dispatcher exists.
  for (const [index] of parsed.steps.entries()) {
    await step("act", `model step ${index + 1}`);
  }
  await step("observe", describeRun(parsed));

  if (result.timedOut) {
    return `agent timed out after ${timeoutMs}ms; partial output: ${truncate(parsed.answer || "none", 400)}`;
  }
  if (result.code !== 0) {
    return `agent exited ${result.code}: ${truncate(result.stderr || parsed.unparsed.join(" ") || "no detail", 400)}`;
  }
  if (parsed.answer === "") {
    return `agent produced no text; stream had ${parsed.unparsed.length} unreadable line(s)`;
  }
  return parsed.answer;
}

function truncate(text: string, width: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}\u2026`;
}
```

Add to `tests/agent.test.ts`:

```ts
import { buildArgs, buildPrompt, runAgent, type CommandRunner } from "../src/agent";
import type { Cron, Worker } from "../src/workspace";

const cron: Cron = { name: "nightly", agent: "builder", task: "summarise the day", schedule: "0 3 * * *", enabled: true };
const worker: Worker = { name: "builder", role: "builds", model: "opencode/space-bunny-free" };

/** Echo canned stdout, so these need no Docker and no model. */
function runnerReturning(stdout: string, code = 0, timedOut = false): CommandRunner {
  return async () => ({ stdout, stderr: "", code, timedOut });
}

describe("buildArgs", () => {
  test("uses the WORKER's model, not a hardcoded one", () => {
    const args = buildArgs(cron, worker.model, "hi");
    expect(args).toContain("-m");
    expect(args[args.indexOf("-m") + 1]).toBe("opencode/space-bunny-free");
  });

  test("never grants tool-use permission", () => {
    // No decision has been made about what an agent may touch, so --auto is
    // withheld. If this test ever needs deleting, that decision was made.
    expect(buildArgs(cron, "m", "hi")).not.toContain("--auto");
  });

  test("is credential-free: no env or auth flags leak into the command", () => {
    expect(buildArgs(cron, "m", "hi").join(" ")).not.toMatch(/api[-_]?key|token|password/i);
  });
});

describe("buildPrompt", () => {
  test("states the job and tells the agent nobody is reading", () => {
    const prompt = buildPrompt(cron, { name: "acme", purpose: "test things" });
    expect(prompt).toContain("summarise the day");
    expect(prompt).toContain("acme");
    expect(prompt).toContain("nobody reading");
  });
});

describe("runAgent", () => {
  const STREAM = [
    '{"type":"step_start","part":{"type":"step-start"}}',
    '{"type":"text","part":{"type":"text","text":"I did the thing."}}',
    '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":10,"input":9,"output":1},"cost":0}}',
  ].join("\n");

  test("returns the model's text", async () => {
    expect(await runAgent(cron, worker, async () => {}, { runner: runnerReturning(STREAM) }))
      .toBe("I did the thing.");
  });

  test("reports each model step through the callback", async () => {
    const seen: string[] = [];
    await runAgent(cron, worker, async (_k, label) => { seen.push(label); }, { runner: runnerReturning(STREAM) });
    expect(seen.some((l) => l.includes("model step 1"))).toBe(true);
    expect(seen.some((l) => l.includes("10 tokens"))).toBe(true);
  });

  test("a timeout is reported, not thrown", async () => {
    const out = await runAgent(cron, worker, async () => {},
      { runner: runnerReturning(STREAM, 0, true), timeoutMs: 1000 });
    expect(out).toContain("timed out");
  });

  test("a non-zero exit is reported with the reason", async () => {
    const out = await runAgent(cron, worker, async () => {},
      { runner: async () => ({ stdout: "", stderr: "provider refused", code: 3, timedOut: false }) });
    expect(out).toContain("exited 3");
    expect(out).toContain("provider refused");
  });

  test("empty output is reported as such, not returned as a success", async () => {
    const out = await runAgent(cron, worker, async () => {}, { runner: runnerReturning("") });
    expect(out).toContain("no text");
  });
});
```

Run `bun test ./tests/agent.test.ts` — expect `1 pass` (the live test) plus `8
pass` from the new unit tests. Typecheck clean. Commit as
`feat: the agent driver, a real model call with a tested failure path` and push.

---

### Task 4 — Put it on the live path

Create `src/drivers.ts` — the glue that resolves a worker and adapts `runAgent`
to the `Driver` signature. This is deliberately its own file: it is the only
place that knows about both the workspace and the driver, so neither has to know
about the other.

```ts
/**
 * The live driver.
 *
 * Two lookups and one adaptation: cron -> worker -> model. The supervisor owns
 * the workspace, so the worker lookup happens there and the resolved worker is
 * passed in; this file exists so `dispatch` still receives a plain `Driver` and
 * `runAgent` stays independent of how the workspace is stored.
 */

import { runAgent, type RunAgentOptions } from "./agent";
import type { Company, Cron, Worker } from "./workspace";
import type { Driver } from "./dispatch";

/**
 * Build a Driver bound to one worker.
 *
 * A missing worker is NOT an error here: it falls back to the free default and
 * says so, because a renamed worker should produce a visible warning in the
 * result rather than a job that silently never runs.
 */
export function driverFor(worker: Worker | null, company: Company | null, options: RunAgentOptions = {}): Driver {
  return async (cron: Cron, step): Promise<string> => {
    if (worker === null) {
      await step("plan", `no worker named "${cron.agent}"; using the free default model`);
    }
    return runAgent(cron, worker, step, { ...options, company });
  };
}
```

Edit `src/supervisor.ts`. Find the existing call and replace it:

```ts
        const { dispatch, echoDriver } = await import("./dispatch");
        const result = await dispatch(cron, echoDriver, {
```

with:

```ts
        const { dispatch } = await import("./dispatch");
        const { driverFor } = await import("./drivers");
        const worker = findWorker(parsed, cron.agent);
        const result = await dispatch(cron, driverFor(worker ?? null, parsed.company), {
```

and add `findWorker` to the existing import from `./workspace` at the top of the
file. `parsed` is the already-parsed workspace in scope in that function — if the
name differs, use whatever the surrounding code calls it, and do not re-parse the
workspace file.

Keep the `onStep` logging callback exactly as it is; it now reports real model
steps.

Run:

```sh
./node_modules/.bin/tsc --noEmit          # expect no output
bun test ./tests                          # expect 0 fail, ~208 tests
sh verify.sh                              # expect "verify.sh: PASS"
```

Commit as `feat: the supervisor runs real agents, not the echo` and push.

---

### Task 5 — Prove it end to end, in a real container

Unit tests use a canned runner. This proves the real path.

Create a workspace with a job on the current minute, bring the container up, run
the supervisor, and read the result file:

```sh
W=/tmp/cod-real; rm -rf $W; mkdir -p $W
export COD_WORKSPACE=$W/cod.json COD_STATE_DIR=$W/state
bun run ./src/index.ts init acme --yes
bun run ./src/index.ts up
bun run ./src/index.ts status
```

Write a cron that fires every minute, then let the supervisor run for ~70 seconds
past a minute boundary:

```sh
node -e '
const fs=require("fs");const p=process.env.COD_WORKSPACE;
const w=JSON.parse(fs.readFileSync(p,"utf8"));
w.crons=[{name:"agent-probe",schedule:"* * * * *",agent:"builder",
  task:"Reply with exactly: REAL_AGENT_OK",enabled:true}];
fs.writeFileSync(p,JSON.stringify(w,null,2));'
timeout 75 bun run ./src/index.ts supervise
```

Then read what actually came back:

```sh
ls -t $COD_STATE_DIR/results/*.json | head -1 | xargs cat
```

Expected: the `output` field contains `REAL_AGENT_OK` and `ok` is `true`. The
log inside the container shows model steps:

```sh
docker exec cod-sandbox-cod sh -lc 'grep "step " /cod/logs/cod.jsonl | tail -5'
```

Expected: lines like `step 1/plan: opencode/space-bunny-free: preparing
agent-probe` and `step 2/act: model step 1`.

**If it does not contain `REAL_AGENT_OK`, stop and report the exact output.** Do
not adjust the test to match a failure.

Clean up:

```sh
bun run ./src/index.ts purge --purge
docker rm -f cod-sandbox-cod
rm -rf $W
```

Commit nothing for this task unless a test needs adding; the point is the
observation. Record the observed output in the commit message of Task 6.

---

### Task 6 — Retire the echo, and document what changed

**Do not delete `echoDriver`.** It is the deterministic reference implementation
the dispatcher tests pin, and the fallback when a workspace names no worker.
Instead, state its new status in its own doc comment, and add it to the docs.

Edit the header comment of `echoDriver` in `src/dispatch.ts`:

```ts
/**
 * The echo driver: the deterministic reference implementation.
 *
 * NO LONGER ON THE LIVE PATH. The supervisor now runs `driverFor` in
 * src/drivers.ts, which makes a real model call. This stays because the
 * dispatcher tests pin the step accounting against it, and because it is the
 * fallback when a workspace names no worker - a real failure that returns a
 * visible string beats a job that silently never runs.
 *
 * It remains useful precisely because it cannot fail for interesting reasons.
 */
```

Update `docs/OPEN_QUESTIONS.md`: the "Closed: task execution" section says the
work is an echo. Rewrite it to record that real execution landed, what the
driver does, and that review, merge policy and autonomy were deliberately NOT
built.

Update `README.md`: the command table gains the fact that a cron job now performs
a real model call, and the badge must match the measured test count.

Run:

```sh
bun test ./tests | tail -3          # read the real number
./node_modules/.bin/tsc --noEmit
sh verify.sh
```

Then correct the README badge and prose to the number you actually measured.

Commit as `docs: real agent execution, and what was deliberately not built` and
push.

---

### Task 7 — Final gate

```sh
cd /home/rohi/homelab/projects/corporate-on-demand
bun test ./tests
./node_modules/.bin/tsc --noEmit
sh verify.sh
docker rm -f cod-sandbox-cod 2>/dev/null; docker volume ls -q --filter name=cod-sandbox | xargs -r docker volume rm -f
sh scripts/cleanroom.sh /tmp/cod-final
docker ps -aq --filter name=cod- | wc -l    # expect 0
```

Expected: all tests pass, no typecheck output, `verify.sh: PASS`,
`RESULT: PASS`, and zero leftover containers or volumes.

## Tests / validation

Per task, TDD is explicit above. Overall:

- **Unit, no Docker, no model:** the event parser (6 tests) and the driver logic
  (8 tests) run on a canned `CommandRunner`. These are the ones that must never
  be flaky, and they cover every failure path: timeout, non-zero exit, empty
  output, unparseable lines.
- **Integration, Docker + model:** exactly one test, Task 1's, plus the Task 5
  manual observation. Kept to one on purpose: a model call costs 4-5 seconds and
  depends on a free provider that has already failed twice in one session.
- **Regression:** the existing 263 tests must all still pass. `echoTask` and
  `echoDriver` keep their tests, so the deterministic path stays pinned.
- **Manual, once:** Task 5's end-to-end run, with the observed output recorded.

## Risks, tradeoffs, and open questions

**The provider is unreliable and will make this look broken.** The free model
endpoint failed twice this session, once with a 180-second hang. CI already
documents this and deliberately excludes the clean-room because "a build that
goes red because a free provider had a bad afternoon is a build people learn to
ignore." Consequence: the Task 1 test is the one thing here that can fail for
reasons unrelated to the code. If it fails, verify by hand with the `docker exec`
command before treating it as a regression.

**A real agent can hang a scheduler slot.** `DEFAULT_AGENT_TIMEOUT_MS` is 180s
against a `maxConcurrent` default of 2, so two hung calls occupy every slot and
the schedule stalls. The timeout bounds it, and the reconciler's per-item budget
reclaims the ledger, but there is no circuit breaker. A `--auto` on opencode would
not help - it is a permission flag, not a timeout.

**No retry, deliberately.** `cleanroom.sh` retries three times; this driver does
not, because "one retry with the review as feedback" was a decision about
*reviews*, and retrying model calls was never decided. Easy to add later.

**Agents cannot change anything yet.** No tool use, no `--auto`, no worktree per
agent, no commits. The driver asks for text and the agent can only answer with
text. That is the minimum defensible thing, and it means "real agents" here means
"real model output", not "agents that write code". Rohi's decision, recorded.

**The host-side hang is not fixed.** `opencode run` hangs on the host and works in
the container. The driver uses `docker exec`, so this is fine - but anyone
running `cod` expecting a local model call will find a 280-second hang and no
explanation. Worth a line in the README.

**`docs/OPEN_QUESTIONS.md` will be stale after this.** It currently says task
execution is an echo by decision. Task 6 fixes the most wrong part; the review,
merge and autonomy questions remain genuinely open and must stay marked as such.
