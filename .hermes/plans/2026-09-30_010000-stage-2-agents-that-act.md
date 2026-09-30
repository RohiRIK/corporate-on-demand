# Stage 2 — Agents that can act

## Goal

A scheduled job runs an agent that **edits files and commits them on its own
branch**, carries the skills its job needs, is bounded by blast radius at the
moment of action, and leaves behind a diff and a decision that the owner can read
without opening a log — plus an out-of-container operations skill for managing
and troubleshooting the system from the host.

## Current context / assumptions

**All settled by Rohi, and not to be re-opened:**

- **Autonomy is automatic.** No human gate anywhere. Agents act; the CEO manages
  them. Rohi "opens the computer and sees the stuff that they do."
- **The cast is CEO + CTO + Engineering.** All three are *working* roles with a
  standing purpose, not meeting-only attendees. CISO/CPO/CFO join later by
  existing, which is why the cast is derived from config and never hardcoded.
- **The company meets** once or twice a day; the product of a meeting is a
  **decision, not minutes**.
- **No Telegram gateway, ever. Disk and CLI only.**

**Already built, verified, and unused — this stage wires it up:**

- `src/worktree.ts` — `acquireWorktree(repoRoot, root, job, baseRef)` returns
  `{path, branch}`, is **idempotent** (a retry reclaims its own worktree), names
  the branch `cod/<job>`, and keeps the branch on release. It has **no production
  caller** — only tests.
- `src/agent.ts` — the real model driver. Spawns `opencode run --pure --format
  json -m <model>` via `Bun.spawn` inside the container, parses the JSONL event
  stream, reports steps, and **never throws**.
- `src/dispatch.ts` — the async step loop. `step()` is a boundary.
- `src/work.ts` — the crash-safe ledger with `lease_epoch` fencing, and the
  novelty gate.
- `src/reconcile.ts` — the level-triggered, idempotent reconciler.
- `agentWorkdir(agent)` → `/work/<agent>` — each worker already has its own
  directory inside the container.

**Known and measured, so nobody re-derives it:**

- `opencode run` **hangs on the host** (280s, no output). It must be spawned
  inside the container. The container has no docker binary and no socket, by
  design.
- `node:child_process` `execFile` **hangs** on this runtime on the identical
  command; `Bun.spawn` returns it in ~3.3s. Use `Bun.spawn`.
- A live model call costs ~4.4s and reports `cost: 0`.
- **Verification trap:** the echo returns the task text verbatim, so a check that
  asks the agent to "reply with exactly X" and then greps for X **passes against
  a job that did nothing**. Every end-to-end check must use a task the echo
  cannot answer.

**The gap being closed.** `Worker` is `{name, role, model}` — no skills. The
driver runs with no tools. The prompt literally tells the model *"Do not claim to
have changed any files; you cannot."* There is no `AGENTS.md` in the image or in
`/work`.

## Architecture / proposed approach

Each job runs in its own git worktree on its own branch, inside a per-job
instruction bundle written to that worktree before the model starts — a
generated `AGENTS.md` carrying the worker's **standing purpose** and the **skills
named for its role** — and opencode runs there with tool use enabled. Before the
commit, the change is checked against the job's blast radius and the result
records the diff, the branch, and who authorised it. The CEO dispatches the work
through the ledger, so an agent's output becomes work items rather than a
side-effect. Finally a host-side operations skill wraps the CLI for managing and
troubleshooting from outside the container.

---

# Step 1 — An agent that acts, with skills for its job

## Task 1.1 — Verify opencode reads instructions from the working directory

**Do this first and alone.** The whole step rests on it, and it is the one
assumption in this plan that is not yet measured.

```sh
cd /home/rohi/homelab/projects/corporate-on-demand
docker rm -f cod-sandbox-acme 2>/dev/null
bun run ./src/index.ts init acme --yes
bun run ./src/index.ts up
```

Write a probe worktree and an `AGENTS.md` into it, then run opencode there:

```sh
docker exec cod-sandbox-acme sh -lc '
  mkdir -p /work/probe && cd /work/probe && git init -q . &&
  cat > AGENTS.md <<EOF
# Engineering
Your standing purpose: keep the parser correct.
When asked to work, you MUST create a file called proof.txt containing 7.
EOF
  echo "probe" > README.md && git add -A && git -c user.email=a@b -c user.name=t commit -qm init &&
  opencode run --pure --format json -m opencode/space-bunny-free \
    "Do the thing described in AGENTS.md. Then report only the file names you created." 2>&1 | tail -5
  echo "--- did it create proof.txt? ---"
  ls -1 /work/probe/proof.txt 2>&1 && cat /work/probe/proof.txt
'
```

**Expected:** the run returns a `text` event, `proof.txt` exists and contains
`7`. If it does not, opencode is ignoring the directory instructions — **stop and
report**, because the instruction-bundle approach in 1.3 has to change.

Commit nothing. This is an observation.

## Task 1.2 — Add `skills` to the worker schema

A worker names the skills its job needs. This is the schema change that makes
"specialized skills based on the job" expressible at all.

Append to `tests/workspace.test.ts`:

```ts
  test("a worker names the skills its job needs", () => {
    const parsed = Workspace.safeParse({
      version: 1,
      company: { name: "acme", purpose: "test" },
      departments: [{
        name: "engineering",
        workers: [{ name: "builder", role: "builds", model: "opencode/space-bunny-free", skills: ["testing"] }],
      }],
      timezone: "UTC",
    });
    expect(parsed.success).toBe(true);
  });

  test("skills are optional, so an existing workspace still loads", () => {
    // The template ships workers with no skills. Making it required would break
    // every existing cod.json the moment this lands.
    const parsed = Workspace.safeParse({
      version: 1,
      company: { name: "acme", purpose: "test" },
      departments: [{ name: "engineering", workers: [{ name: "builder", role: "builds", model: "opencode/space-bunny-free" }] }],
      timezone: "UTC",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.departments[0]?.workers[0]?.skills).toEqual([]);
  });

  test("a skill name is a plain lowercase identifier", () => {
    // A skill name reaches a file path in the bundle, so it is validated here
    // rather than trusted at the point of use.
    const base = {
      version: 1, company: { name: "acme", purpose: "t" }, timezone: "UTC",
      departments: [{ name: "engineering", workers: [{ name: "b", role: "r", model: "m", skills: ["../etc/passwd"] }] }],
    };
    expect(Workspace.safeParse(base).success).toBe(false);
  });
```

Run `bun test ./tests/workspace.test.ts` — the first fails, the rest fail to
compile. Then edit `src/workspace.ts`:

```ts
/** Skills this worker's job needs, resolved from the bundle at dispatch time. */
const SkillName = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and hyphens");

export const Worker = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and hyphens"),
  role: z.string().min(1),
  model: z.string().min(1),
  skills: z.array(SkillName).default([]),
});
```

Run `bun test ./tests` then `./node_modules/.bin/tsc --noEmit`. Expected: all
pass. Commit:

```sh
git add src/workspace.ts tests/workspace.test.ts
git -c user.name=Bob -c user.email=bob@localhost commit -m \
  "feat: workers name the skills their job needs

Optional, defaulting to empty, so every existing cod.json still loads.
Validated as plain lowercase identifiers because a skill name reaches a
file path in the per-job instruction bundle - the same reasoning that made
the work-item id and the worktree name validate at their boundaries."
git push origin main
```

## Task 1.3 — Write the skill bundle into the repo

Skills are text files the agent reads. They are content, so they are versioned
with the code.

Create `src/skills.ts`:

```ts
/**
 * The per-job instruction bundle.
 *
 * An agent that can act needs to know three things before it starts: what its
 * department is FOR, what it is allowed to touch, and which skills its job
 * needs. All three are written into one generated AGENTS.md in the job's own
 * worktree, because that is the one place opencode is documented to read
 * project instructions from - verified in Task 1.1, not assumed.
 *
 * The bundle is regenerated per job, never shared between concurrent jobs. Two
 * jobs writing one AGENTS.md is the same class of bug as two agents writing one
 * result file.
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Department, Worker } from "./workspace";

/** Where skill bodies live in the repository. */
export const SKILLS_DIR = "skills/agent";

/** The skills a worker is given, skipping any it names but does not have. */
export function resolveSkills(skillsRoot: string, names: readonly string[]): string[] {
  let available: string[];
  try {
    available = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return names.filter((name) => available.includes(name));
}

/** Render one skill's body, or a named placeholder if it is missing. */
export function renderSkill(skillsRoot: string, name: string): string {
  try {
    return readFileSync(join(skillsRoot, name, "SKILL.md"), "utf8");
  } catch {
    // Named in the workspace but absent from the bundle is a MISTAKE worth
    // saying out loud, not a crash. An agent told it has a skill it cannot
    // read will either invent one or stall, and both look like the model
    // misbehaving.
    return `## ${name}\n\n**THIS SKILL IS MISSING from the bundle.** Ask for it rather than improvising.`;
  }
}

/**
 * Build the instruction file for one job.
 *
 * The blast radius line is here, not in the prompt, because a file the agent
 * re-reads is more durable than an instruction it read once and forgot.
 */
export function buildInstructions(
  department: Department,
  worker: Worker,
  job: { readonly name: string; readonly task: string },
  blastRadius: number,
  skillsRoot: string,
): string {
  const skills = resolveSkills(skillsRoot, worker.skills);
  const lines = [
    `# ${department.name.toUpperCase()} — ${worker.name}`,
    "",
    "## Standing purpose",
    "",
    department.purpose.length > 0
      ? department.purpose
      : "(none declared — ask the CEO what this department is for before starting work.)",
    "",
    "## This job",
    "",
    job.task,
    "",
    "## Boundaries",
    "",
    `- You are working on branch \`cod/${job.name}\` in your own worktree.`,
    `- Blast radius for this job: ${blastRadius} (0 self-contained, 1 cross-department, 2 global).`,
    blastRadius >= 2
      ? "- **This is global work. Do not act on it. Report to the CEO and stop.**"
      : "- Stay inside this worktree. Do not touch paths outside it.",
    "- Do not push, merge, or force-push. You have no authority to land anything.",
    "- When you are finished, commit your work with a clear message.",
    "",
    "## Skills",
    "",
  ];
  if (skills.length === 0) {
    lines.push("(none assigned to this worker.)", "");
  }
  for (const name of skills) {
    lines.push(renderSkill(skillsRoot, name), "");
  }
  return lines.join("\n");
}

/** Write the bundle into a job worktree. Returns the path written. */
export function writeInstructions(worktreePath: string, contents: string): string {
  mkdirSync(worktreePath, { recursive: true });
  const path = join(worktreePath, "AGENTS.md");
  writeFileSync(path, contents, "utf8");
  return path;
}
```

Add `purpose` to the department schema in `src/workspace.ts`, same optional
treatment:

```ts
export const Department = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and hyphens"),
  /** What this department is FOR. It works from this, not from a list of crons. */
  purpose: z.string().default(""),
  workers: z.array(Worker).min(1),
});
```

Append to `tests/workspace.test.ts`:

```ts
  test("a department declares a standing purpose", () => {
    const parsed = Workspace.safeParse({
      version: 1, company: { name: "acme", purpose: "t" }, timezone: "UTC",
      departments: [{ name: "engineering", purpose: "keep the parser correct", workers: [{ name: "b", role: "r", model: "m" }] }],
    });
    expect(parsed.data?.departments[0]?.purpose).toBe("keep the parser correct");
  });
```

Create the bundle with **two** seed skills, so the mechanism is exercised by
something real rather than by an empty directory:

- `skills/agent/testing/SKILL.md` — how to write and run a test in this repo
  (`bun test ./tests`, `./node_modules/.bin/tsc --noEmit`, never `bun x tsc`)
- `skills/agent/git-discipline/SKILL.md` — commit on your own branch, never
  push or merge, one logical change per commit

Create `tests/skills.test.ts` covering: a named skill resolves; a missing one
renders the named placeholder rather than crashing; instructions contain the
purpose, the branch, and the blast radius; global work says **do not act**; a
job with no skills still gets a valid file.

Run `bun test ./tests/skills.test.ts` — expect pass. Commit as
`feat: the per-job instruction bundle, and two seed skills`.

## Task 1.4 — Run each job in its own worktree

`src/dispatch.ts` gains worktree acquisition, and `src/agent.ts` gains the
working directory and tool use.

**The blast-radius default is 0, and the prompt's "you cannot" line is deleted
in the same commit that grants tools.** Leaving them together would put a
contradiction in front of the model.

In `src/agent.ts`, `buildArgs` gains `--dir` and `--auto`:

```ts
export function buildArgs(cron: Cron, model: string, prompt: string, workdir: string): string[] {
  return [
    OPENCODE_BIN, "run", "--pure", "--auto", "--format", "json",
    "-m", model,
    "--dir", workdir,
    "--title", `cod-${cron.name}`,
    JSON.stringify(prompt),
  ];
}
```

Delete from `buildPrompt` the line `Do not claim to have changed any files; you
cannot.` — the **tests** in `tests/agent.test.ts` assert its presence, so update
them: `buildArgs` now contains `--auto` and the prompt no longer contains
"cannot". The two assertions that pin *safety* become assertions that pin the
**boundary**: `--dir` is present, and the radius-2 instruction is present.

`runAgent` gains a `workdir` option and passes it through. In `src/dispatch.ts`,
acquire the worktree before the driver runs and release it after, so a retry
reclaims its own worktree and a crash leaves the branch behind rather than
losing it.

Append to `tests/dispatch.test.ts`: a job acquires a worktree; the driver is
given its path; releasing keeps the branch; a second run of the same job reuses
the same worktree; a worktree from a different job is not reused.

Run `bun test ./tests`, then a real end-to-end **with a task the echo cannot
fake**:

```sh
W=/tmp/cod-act; rm -rf $W; mkdir -p $W
export COD_WORKSPACE=$W/acme.json COD_STATE_DIR=$W/state
bun run ./src/index.ts init acme --yes
```

Write a cron whose task is *"Create a file called answer.txt containing the
number of files in this directory, and commit it."* — the echo cannot count, and
neither can a grep of the output. Bring it up, run `cod supervise` past a minute
boundary, then:

```sh
docker exec cod-sandbox-acme sh -lc \
  'git -C /work log --oneline -5; git -C /work show --stat HEAD | head -20'
```

**Expected:** a commit on `cod/<job>` adding `answer.txt`. If the output merely
repeats the task text, it is still the echo — stop and report.

Commit as `feat: agents work in their own worktree, with tools, bounded by
blast radius`.

---

# Step 2 — The boundary, and an account you can read

## Task 2.1 — Enforce blast radius before the commit

`JobResult` grows the fields the owner needs. In `src/results.ts`:

```ts
  /** The branch the job worked on, when it had one. */
  readonly branch?: string;
  /** Files changed, for the owner to read without opening a diff. */
  readonly changedFiles?: readonly string[];
  /** Blast radius the job ran under. */
  readonly blastRadius?: number;
  /** The work item this run came from, when it came from one. */
  readonly workId?: string;
```

Enforcement belongs in one function so it cannot be bypassed. Add to
`src/agent.ts`:

```ts
/**
 * Refuse a change that exceeds its declared blast radius.
 *
 * The check is on the FILES, not on the agent's description of them. An agent
 * that is told its radius is global has to stop before it does global damage,
 * and "stop" is only enforceable against what actually changed.
 */
export function radiusExceeded(changedPaths: readonly string[], radius: number): boolean {
  if (radius < 2) return false;
  return changedPaths.some((path) => /^(src\/|docker\/|ops\/|templates\/|\.github\/|package\.json|verify\.sh)/.test(path));
}
```

A radius-2 job that touched a global path is **reported and not committed**, with
the offending paths named. The branch stays, so nothing is lost — the same
"keep the work, refuse the landing" rule `releaseWorktree` already follows.

## Task 2.2 — Show the owner what happened

`cod results` must be readable at a glance. Extend the table to carry branch,
changed-file count, and radius, and add `cod results <workId>` for one job's
full detail. The reason this is in Stage 2 and not Stage 6: **looking is the
product.** Rohi's only interface with this system is opening the computer, so a
result he cannot read without `jq` is a result he will not read.

Append to `tests/results.test.ts`: a committed result persists branch, changed
files and radius; the human table includes them; `--json` round-trips them.

Run the suite, commit as
`feat: results carry the branch, the diff and the radius — because looking is the
product`.

---

# Step 3 — The CEO dispatches the work

## Task 3.1 — Dispatch a ledger item as a real job

`cod work claim` currently records that something was claimed; nothing runs it.
Add `cod work run <id>`, which claims the item, runs it through `dispatch` with
the item's blast radius and its department's purpose, and commits the outcome
back to the ledger with `commit(handle, id, leaseEpoch, ...)`.

**The fencing is not optional and must not be bypassed:** the commit carries the
epoch it was given, so a stale run cannot overwrite a newer result. This is
already the ledger's contract; reusing it is the point.

## Task 3.2 — Departments propose their own work

`propose()` currently has exactly one caller: the CLI, typed by a human. Give
each department a cycle that grades itself against its standing purpose and
proposes its next work. **The novelty gate is the brake** — it already refuses
byte-identical repeats in SQL, and it is known to be weak against rephrasing.
That weakness is honest and recorded rather than hidden, and the meeting is
where a human-grade objection would come from.

The blast-radius weakness also lives here and is closed here, not later:
`blast_radius` is currently **self-asserted by the proposing agent**, so the rule
constrains the thing it should be constraining. Derive the radius from the
operation server-side, or default it to the CEO. Do not ship the self-asserting
version.

## Task 3.3 — The company meets, and decides

Once or twice a day. The cast is **derived from the workspace**, never
hardcoded. Each role states a position; the CEO decides; the decision becomes
work items.

**The old v3.8.0 board meeting was not a meeting** — it collected activity, read
grades and wrote minutes, and no agent spoke. The output must be a **decision**,
and the minutes are a record of it, not the product.

---

# Step 4 — An operations skill, from outside the container

Everything so far is *inside* the sandbox. This step is for the host, and it is
deliberately last: a troubleshooting skill written before there is anything to
troubleshoot describes problems nobody has had.

Create `skills/cod-operations/SKILL.md` — a real skill, installable, that
troubleshoots `cod` **from the host** with the container running or not. It
wraps the CLI and reads host state; it never reaches into the container to fix
things by hand.

It must cover, in workflow order:

1. **Triage** — is the container up, is the image present, is the schedule
   registered, what did the last run do
2. **The common failures, each with the real cause and the real fix** — every one
   measured in this project's history, not invented:
   - the supervisor sees **0 jobs** (workspace file mounted from the wrong path)
   - **timezone off by hours** (`TZ` unset inside the container)
   - the job output is the **task text echoed back** (not a real model answer —
     and the check that cannot tell the difference)
   - a run **fails in milliseconds** (a nested `docker exec`, or the supervisor
     running where `opencode` is not)
   - `bun x tsc` **hangs or is blocked** by the security scanner; use
     `./node_modules/.bin/tsc`
   - a **stale container** from an older naming scheme
3. **Reading a post-mortem** — `cod logs`, `cod results`, `cod work list`, and
   how to tell a stuck run from a slow one (and the honest answer: you often
   cannot, and that is why the outcome is graded instead)
4. **Safe operations** — what is reversible (`purge` without `--purge` is a
   no-op; `down` keeps the work volume) and what is not (deleting a work volume
   destroys every commit an agent made)

Add `scripts/doctor-detect.sh`, referenced by the skill, that checks the above
and prints one line per finding rather than a wall of output. **Every check in it
must be executable from the host**, and the skill must say so.

Validate the skill by running it: follow its own triage steps against a running
container and against a stopped one, and confirm the output tells you which.

---

# Tests / validation

- **TDD per task**, as written above: the failing test, the red run, the
  implementation, the green run, the commit.
- **Unit, no Docker, no model** for the bundle, the radius check, the results
  shape and the ledger wiring. These must never be flaky.
- **One live model test** already exists in `tests/agent.test.ts`. It is
  deliberately one, because the free provider has already failed twice in one
  session; it skips with a warning when no container is running, because CI has
  no Docker.
- **Every end-to-end check must use a task the echo cannot answer.** This is
  recorded four times in the git history for a reason: a check that asks the
  agent to "reply with exactly X" and greps for X passes against a job that did
  nothing.
- **Mutation-test the load-bearing guards** before believing them: removing the
  radius check, the `--dir`, and the epoch predicate must each fail their own
  test. A test that cannot fail is not evidence.
- **Final gate**, from a deleted image:
  ```sh
  bun test ./tests
  ./node_modules/.bin/tsc --noEmit
  sh verify.sh
  docker rm -f $(docker ps -aq --filter name=cod-sandbox) 2>/dev/null
  docker volume ls -q --filter name=cod-sandbox | xargs -r docker volume rm -f
  sh scripts/cleanroom.sh /tmp/cod-stage2
  ```
  Expected: all pass, `RESULT: PASS`, and zero leftover containers or volumes.

# Risks, tradeoffs, and open questions

**Tool use is a real risk the moment it is granted.** `--auto` lets an agent act
without asking. That is the decision, and the mitigation is the boundary: own
worktree, own branch, blast radius enforced on the actual changed paths, and no
push or merge authority. **If Task 1.1 shows opencode ignoring directory
instructions, stop** — without the bundle the agent has no purpose, no boundary
and no skills, and granting tools at that point is an unbounded actor.

**A radius-2 job that trips the check is reported, not committed.** The branch
survives, so the work is not lost, but nothing lands. Someone must decide. That
is the intended shape — a refusal that keeps the work and asks.

**A hung agent holds a scheduler slot.** `DEFAULT_AGENT_TIMEOUT_MS` is 180s
against a `maxConcurrent` default of 2, so two hung calls stall the schedule.
Still no circuit breaker. The reconciler's per-item budget reclaims the ledger
but not the slot.

**The novelty gate is known-weak** and stays known-weak through this stage: it
catches byte-identical repeats, not rephrased ones. Reworded goals are normal
model output, so this is a speed bump, not a lock.

**What a slow agent looks like from outside is unresolved and unresolvable
locally** — a slow agent and a stuck one are indistinguishable without a signal
that does not exist. The mitigation is grading the outcome after the fact, which
is Stage 4's reviewer. Do not ship a "semantic progress" score to paper over it.

**The skills bundle is content, and content rots.** Two seed skills are enough to
prove the mechanism; the real set is a later decision about what the company
actually needs to know.
