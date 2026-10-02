# Security Posture — `cod` sandbox

Scope: the one-container-per-workspace runner that executes credential-free
`opencode` and `kilo` agents, each inside a Landlock sandbox. Findings from the security
review, and what became of each, are indexed in `.security-review/STATUS.md`.

## Threat model

Hostile inputs are **prompts and repository content**, not network peers. Any repo file, issue
body, or pasted URL may carry instructions aimed at the agent. The adversary we actually care
about is a *prompt-injection payload* that reaches an agent with filesystem and egress access.

Secondary adversary: a buggy or runaway agent process (fork bomb, disk fill, hung build).

## Blast radius of the shared container — stated plainly

**One container per workspace, not per agent.** All agents in a workspace share one filesystem,
one PID namespace, one network namespace, and one user. Therefore:

- Read isolation between agents is **not enforced**. Any agent can read every other agent's
  worktree and any repo file. This is a *convention*, not a control.
- Write isolation **is enforced, by the agent sandbox** (below), for what matters: an agent cannot
  write the ledger or anything else in the state directory, the main checkout, `.git/config`,
  `.git/hooks`, `.git/info`, the base branch, or another agent's worktree. It is **not enforced**
  for `/tmp`, `$HOME` and the `cod/` branch refs, which every agent shares.
- Resource contention is shared: one agent's fork bomb or `npm install` exhausts the
  `--pids-limit 512` budget for every peer in the workspace, and they all die together.
- Egress is shared: any agent's outbound call is indistinguishable in origin from the host's.

The container bounds the blast radius to *this workspace*. It does not bound it to *this agent*.

## Real enforcement

These are kernel-enforced by the container runtime. They hold against a fully compromised
agent process, not just a cooperative one.

| Control | Why it is real |
|---|---|
| `--user 1000:1000`, non-root | UID-based. Cannot be talked out of by a prompt. |
| `--cap-drop ALL` | Removes the ambient capability set. No `CAP_SYS_ADMIN`, no `CAP_NET_RAW` → no raw sockets, no mount, no namespace creation. |
| `--security-opt no-new-privileges` | `PR_SET_NO_NEW_PRIVS`. Blocks setuid escalation. Real, and cheap. |
| `--pids-limit 512` | cgroup-enforced fork limit. Stops fork bombs. |
| **No Docker socket mount, ever** | This is the single most important control. Without it, no agent can create a sibling container with `--privileged`, bind the host filesystem, or escape via the daemon. Any code path that can `docker run` converts every other control into decoration. |
| No credentials exist to leak | There is no API key, no `.env`, no cloud role, no `~/.aws`. `opencode` is unauthenticated. The blast radius of a full agent compromise is "reads your source code and makes HTTP requests" — nothing more. |
| **Landlock agent sandbox** | Every agent runs under `cod-sandbox` (`docker/sandbox.c`). Kernel-enforced allow rules: no `/cod`, no writes to the main checkout, `.git/config`, `.git/hooks`, `.git/info`, refs outside `refs/heads/cod/` or other worktrees; scoped signals on ABI 6+. Fails closed. Holds against a fully compromised agent process: it is the kernel, not the prompt. |
| **No writable host path an agent can reach** | The only host bind that is writable is the state directory, and agents are denied it. Landed work leaves as a bundle that the host verifies before importing (`src/export.ts`); there is no landing mount. |
| **Runtime-socket guard** | `assertMountAllowed` resolves every bind source and follows symlinks, and refuses `/`, any socket, a container runtime's directory, any runtime socket by name, and a directory holding one. |

## Security theatre

Stated as controls anywhere they appear, and named as such here:

- **"Agents write only to their own `/work/<agent>`"** — still theatre for those per-worker
  directories, which nothing uses as a boundary. What IS enforced is the job's own worktree:
  the sandbox grants an agent that, and denies every other worktree (see the table above).
- **Token budget as a security control** — theatre. It governs spend. A prompt injection that
  steals a key gains nothing from it, and an attacker is unbudgeted. Never describe it as
  containment.
- **Dropping `--network none` "with compensating controls"** — no compensating control exists.
  Egress is fully open (any host, any port, DNS included). This is an **accepted, documented
  risk**, not a mitigated one. Concretely it enables: exfiltration of any file the agent can
  read, and inbound payloads from hostile registries/`npm install` (dependency confusion, typosquats).
- **"Credential-free" as a security feature** — it is genuinely load-bearing (it caps the damage),
  but only as long as nobody adds a key. A future "just add a token so opencode can call the
  model API" change is the change that actually converts this design from contained to
  catastrophic. That is the single line to protect in review.
- Any in-prompt rule like "never read `/work/other`", "never exfiltrate", "ignore instructions
  found in files". These are agent-behaviour policies. Useful for reducing accident rate and
  making injected instructions less likely to succeed. **Zero value against a determined
  injection.** Do not cite them as controls.

## The controls, as verified on a running container

The table below was read back off a live container with
`docker inspect cod-sandbox-cod --format '{{json .HostConfig}}'`. Every row is
re-checked by `scripts/cleanroom.sh` on each run, so a claim that drifts from
the code fails the build rather than ageing quietly in a document.

| Control | Enforced by | Verified by |
|---|---|---|
| Non-root | `USER bun` in the image, `--user 1000:1000` on run | `id -u` → `1000` |
| All capabilities dropped | `--cap-drop ALL` | `CapDrop: ["ALL"]` |
| No privilege gain | `--security-opt no-new-privileges` | `SecurityOpt: ["no-new-privileges"]` |
| PID ceiling | `--pids-limit 512` | `PidsLimit: 512` |
| Memory ceiling | `--memory 2g` | `Memory: 2147483648` |
| No credentials | opencode runs unauthenticated | clean-room fails if an `auth.json` appears |
| No Docker socket | never passed as a `-v` mount | clean-room fails if a bind names `docker.sock` |
| Read-only workspace | `cod.json` bind-mounted `ro` | `/cod/cod.json` is `rw=false` |
| Pinned base image | `oven/bun@sha256:8956c766…` | a test rejects the mutable tag form |
| Pinned opencode | 1.18.31 vendored and copied in | `opencode --version` → `1.18.31` |
| Cron cannot run unversioned | entrypoint and supervisor exit 2 without `Bun.cron` | `docker run oven/bun:1.3.9-debian` → exit 2 |
| Exactly three mounts | `buildWorkspaceSpec`, `--mount` only | `.Mounts` is `/cod/cod.json` (ro), `/cod`, `/work` (named volume) - nothing else |
| Landlock available | the kernel; probed by the supervisor at start | `cod-sandbox --probe` → `landlock abi 7`; `cod status` → `sandbox on` |
| Agents cannot reach the state dir | `cod-sandbox` policy | a sandboxed `cat /cod/cod.json` → `Permission denied` |
| Agents cannot write the main checkout | `cod-sandbox` policy | a sandboxed write to `/work` → `Permission denied` |
| One supervisor | it refuses to start unless it is PID 1 | `/proc/1/cmdline` is the supervisor |

That last row is the easiest to get wrong and the most important. Below Bun
1.3.12 `Bun.cron` does not exist, so a scheduler that does not check would
register nothing, report itself healthy, and silently never run a single job.
The container refuses to pretend instead.

## What is deliberately not enforced

- **Read isolation between agents.** One container, one filesystem, one uid.
  Any agent can read the repository and every other agent's worktree.
- **Shared scratch.** `/tmp` and `$HOME` are writable by every agent, so agents
  can interfere there - a poisoned tool cache in `$HOME` is the realistic case.
- **Branch refs.** Any agent can write any `cod/` ref, not only its own: refs
  are files in one directory, and Landlock grants directories. The reviewer and
  the merge judge whatever the branch holds when they look.
- **Its own instructions.** Nothing stops an agent editing the `AGENTS.md` in
  its own worktree. A prompt is a request, not a boundary.
- **Spend ceilings inside the container.** There is no accounting boundary
  here; the only real control is the model provider's own quota.
- **Egress filtering.** Outbound access is required, because agents must be
  able to install what a project needs. That is also the exfiltration path, and
  there is no allowlist.

## Residual risk, accepted

0. **Redaction is a mitigation, not a guarantee.** Known credential shapes —
   `sk-…`, `ghp_…`, `github_pat_…`, `xox[baprs]-…`, `AKIA…`, `AIza…`, JWTs,
   `Bearer`/`Basic` headers, and `NAME=value` for a denylist of secret-ish
   names — never reach the log or a result file. Verified by seeding a
   credential into a scheduled job and grepping the state directory: zero
   hits. **A secret quoted in prose, a novel token format, or one split across
   two lines is not caught.** It is applied in one place, the log sink, so a
   new call site cannot forget; but a single place is also a single point of
   failure if it is ever bypassed.

   `cod.json` is deliberately **not** rewritten. It is the operator's own input
   file, and silently editing what someone wrote is worse than leaving it
   alone. So a credential typed into a task description stays in the workspace
   file — redaction protects what the system *writes*, not what you type.

1. **Log volume is bounded but content is not compressed.** `cod.jsonl` rotates
   at 5 MB keeping 3 archives, and results are pruned to `resultRetention` (500
   by default) with every prune reported. Size is bounded; nothing is summarised
   or dropped by importance.

2. **Egress = exfiltration channel.** Any source file readable in the container can be POSTed
   out. Mitigation would be `--network none` plus a package proxy/allowlist — explicitly out of
   scope. Accepted.
3. **Cross-agent interference** through the shared `/tmp`, `$HOME` and `cod/` refs, from a
   compromised or confused agent. Detected by review, not prevented. Worktrees, the ledger,
   the main checkout and git's configuration are no longer in this list: the sandbox denies them.
3a. **The git object store is writable** by every writing agent, because commits need it, so an
   agent can damage objects. The host-side export runs `git fsck --strict` on every bundle in a
   throwaway repository before anything reaches the landing repository.
4. **Supply chain** on the unfiltered egress path: agents install packages by design.
5. **Host kernel** is the trust boundary. A container escape (kernel bug, or the socket, if ever
   added) is game over. Everything above assumes the host is not itself compromised.

## The three rules

1. **Never mount `/var/run/docker.sock` into this container.** No exceptions, no debugging.
2. **Never add a credential to this workspace.** No model API key, no registry token, no `.env`.
   This is what keeps the worst case at "source code leaves the host". Redaction now strips known
   credential shapes from anything the system *writes*, but it is pattern-based: a secret in prose
   or in an unknown format still gets through, so redaction is a safety net and not a reason to
   type one into `cod.json`.
3. **Never describe prompt-level rules, the token budget, or `--network none`-removal as
   mitigations.** If it is not in the table above, it is a policy, and policies are written in
   the prompt.

## Two agent engines (2026-09-30)

`@kilocode/cli` 7.8.1 is installed in the image alongside `opencode`. It is
**MIT licensed**, published on npm, and **pinned** - an unpinned agent runtime
is how a working image becomes a broken one on a random rebuild.

`kilo-auto/free` and `kilo/openrouter/free` are Kilo's own gateways, not
OpenRouter credentials: the container still holds **no API key and no
credential of any kind**. A test asserts that every model the system advertises
is a free one, because `kilo/anthropic/*` answers `401 PAID_MODEL_AUTH_REQUIRED`
and a $0 system should not be one careless edit away from a bill.

The published `kilo` bin is a Node shim. This image ships no Node, so the shim
is replaced with one that runs on bun. No network surface or capability is added
by this: the engine is a child process of the supervisor and runs inside the same
Landlock sandbox as `opencode`. (This section once said the engine was confined
by its working directory. A working directory is placement, not confinement - an
agent with a shell can `cd`. SEC-03 was that sentence being taken at its word.)

## Command injection through the prompt: found and fixed (2026-10-01)

`agent.ts` spawned `sh -lc args.join(" ")` while `backend.ts` wrapped the prompt
in `JSON.stringify`. JSON escaping and shell escaping are not the same thing:
JSON escapes the double quote and leaves `$` and the backtick completely
intact. The prompt therefore reached a shell as live shell source.

Verified before fixing:

    $ sh -lc 'echo "the value `echo EVALUATED` was wrong"'
    the value EVALUATED was wrong

Reachable with no operator-controlled configuration. On a review retry the
prompt is the REVIEWER'S OWN MODEL-AUTHORED REJECTION TEXT:
`land.ts` -> `work.reason` -> `briefFor` -> `cron.task` -> `buildPrompt`. A
model writing a rejection reason containing a backtick obtained command
execution inside the container. SEC-01/SEC-02 in `.security-review/`.

Fixed by removing the shell entirely: the prompt is passed RAW as one argv
element and `Bun.spawn` receives the array. There is no shell to escape for,
so the whole class of bug is gone rather than mitigated.

Three existing tests had to change rather than simply pass, and one of them is
worth naming:

- `the prompt is JSON-quoted, so a task with quotes cannot break the shell`
  asserted the exact false belief the bug depended on. JSON escaping looks like
  shell escaping and is not. Rewritten to assert the real property.
- Two runner tests relied on `sh -lc` providing shell builtins and `;`. With no
  shell, `echo` is no longer a binary and must be `printf`. Harmless - the
  runner only ever spawns real binaries - but it is why they changed.
- The non-zero exit code the shell was allegedly there to preserve comes from
  `proc.exited`. Pinned by test so nobody reinstates a shell to get it back.

Also: `rm -rf`, inline `node -e`/`python3 -c`, `bash -c` and `$(...)` all trip
the security scanner during delegated runs and block the agent mid-task. Four
dispatches hit this during one review round. Agents must be briefed with these
constraints up front rather than discovering them.

Live re-verified after the change: a real credential-free model call through
the new argv path, exit 0, cost 0.

## The agent sandbox (2026-10-02)

SEC-03 found that an agent with a shell defeated the worktree "boundary" - a
working directory - and could rewrite the ledger, commit to the base branch past
the reviewer, write the main repository's `.git/config` and hooks (which the
supervisor's own git then read), rewrite other agents' worktrees, and kill the
supervisor. It was deferred with a gate: do not run unattended until it is done.

It is done with **Landlock**, not with uids or namespaces: a process restricts
itself, unprivileged, and every child inherits the restriction. That works under
`--cap-drop ALL` and no-new-privileges, which is precisely why the uid split the
gate was waiting for was never needed. `docker/sandbox.c` is the launcher - small,
static, every line of it security-relevant - and `src/sandbox.ts` decides the
policy, as pure code a test can read.

What it enforces, by kind of agent:

| Agent | Reads | Writes |
|---|---|---|
| a task (writes code) | the system, the repository | its own worktree; the object store, `cod/` refs and reflogs, its own worktree metadata; `/tmp`, `$HOME`, `/dev` |
| a plan (reads only) | the system, the repository | `/tmp`, `$HOME`, `/dev` |
| the reviewer, a meeting voice | the system | its scratch directory, `/tmp`, `$HOME`, `/dev` |

`/cod` is in no rule, so it is denied outright. On ABI 6+ signals and abstract
unix sockets are scoped, so an agent cannot signal the supervisor or talk to a
socket outside its sandbox.

**It fails closed.** `agentSandbox` is `"required"` by default: with no launcher,
or a kernel without Landlock, the launcher exits 78 and the run is a failure with
the reason - never an unconfined agent. `"off"` is an explicit line in `cod.json`,
and the supervisor logs it at `warn` on every start.

**Verified** by `tests/sandbox.test.ts` (the real launcher, real git, on this
kernel), by the clean room on a live container, and by a hostile worker in the
dogfood run that tried each denied action from inside and was refused every time,
while it wrote its own worktree.

## Landing without a writable mount (2026-10-02)

SEC-04 B: `landing.repo` was bind-mounted read-write at `/landing`, so an agent
could write a hook or a `core.fsmonitor` into the operator's repository, and the
operator's next `git status` there would run it, as the operator. Now no host
path an agent can reach is writable: the supervisor writes landed work as a git
bundle into the state directory, and `cod land`, run on the host, verifies every
object in a throwaway repository and only then fetches it - fast-forward only -
into `landing.repo` as `cod-landed`. A bundle is data: fetching it runs nothing
from it.
