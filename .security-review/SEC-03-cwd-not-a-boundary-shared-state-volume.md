# SEC-03 — Agent shell defeats worktree cwd confinement and reaches the shared state volume (HIGH)

## Where

- `src/agent.ts:81` — `cwd` set to the worktree, commented as "THE BOUNDARY"
- `src/backend.ts:63,81` — `--auto` granted to both engines
- `src/docker.ts:477` — `/work` writable named volume, shared by all jobs
- `src/docker.ts:476` — `stateDir` → `/cod`, **`readOnly: false`**
- `src/supervisor.ts:110` — `workdir: worktree.path`

## What

`src/agent.ts:77-81` says:

```
// THE BOUNDARY. The agent can only reach its own worktree, and it reads
// the AGENTS.md bundle from there.
cwd,
```

That comment is false, and the code gives the reason it is false three lines up in the same
file: `--auto` (`src/backend.ts:63,81`) is passed to the engine, which **grants the model tool
use**. `src/agent.ts:147-151` states this as a deliberate decision.

`cwd` sets where the process starts. It does not restrict what the process may open. An
agent with a shell does not need a bug to leave its worktree — `cd /work/other-job` or an
absolute path is enough. Nothing in `agent.ts`, `backend.ts`, or `supervisor.ts` re-checks the
working directory after launch, and there is no seccomp/AppArmor/LSM profile in
`buildRunArgv` (`src/docker.ts:269-328` — `--cap-drop ALL` and `no-new-privileges` are present
and correct, but neither constrains filesystem paths).

## Concrete reachability

1. **Other jobs' worktrees.** `/work` is one named volume (`docker.ts:477`) holding the repo
   and *every* per-job worktree (`worktree.ts:59-96`). Worktree separation is a git-level
   convention — "one branch per worktree", per `worktree.ts:14-15`. It stops *concurrent
   writes*; it does not stop *reads or writes* across worktrees. Job A can read job B's
   in-progress code and rewrite it. The volume comment at `entrypoint.sh:22-24` is
   refreshingly honest about this ("Convention, not enforcement") — but the comment is in the
   entrypoint, not on the boundary it contradicts.

2. **The state volume is mounted WRITABLE and the agent can reach it.** `stateDir` is bind
   mounted at `/cod` with `readOnly: false` (`docker.ts:476`). That directory holds the SQLite
   ledger that `land.ts` treats as the durable authority: `openWork`, `latestReview`
   (`land.ts:91-93`), and the retry/release UPDATE at `land.ts:155-157`.

   An agent with write access to that DB controls:
   - **the landed/rejected guard** (`land.ts:94`) — write `landed` for a work id and that item
     is skipped forever
   - **the retry count** (`land.ts:109`) — reset `attempts` to keep an item retrying
     indefinitely
   - **the brief** (`land.ts:151-156`) — the reviewer's words are read straight out of
     `work.reason`, so DB write access is prompt injection into every subsequent retry

   This is the sharpest finding in this pass: the guard that is described as "the durable
   guard" against exactly this class of bug is writable by the actor it is guarding against.
   No capability separation, no DB read-only mount, no integrity check on the ledger.

## Note on the `--auto` decision

The design (`src/agent.ts:141-156`) argues the boundary *is* `--dir`/cwd plus a per-job
`AGENTS.md` naming the blast radius. A prompt is not a boundary. It is guidance the model is
free to disregard, and the same document grants the tool use that makes disregarding it
profitable. The comment's own framing — "An agent with tools and no boundary is an unbounded
actor; an agent with tools and a boundary is a worker" — is right about the diagnosis and
wrong about which control supplies the boundary.

## Fix

1. Mount `stateDir` **`readOnly: true`** at `/cod`. The supervisor only ever reads state to
   schedule; writes happen from the host process. This is the highest value-per-character
   change in this finding.
2. Give each job its own writable directory rather than a shared `/work` volume, or run each
   job in its own container. That is the real fix for cross-job reach and it is a design
   change, not a flag.
3. If cwd must be the only confinement available, remove `--auto` and drop tool use. The
   current combination — full tool use, prompt-only boundary — is the worst of both.
4. Add a syscall-level restriction (`--security-opt seccomp=...`, or read-only rootfs with
   explicit writable mounts) so "leave the worktree" fails rather than succeeds quietly.