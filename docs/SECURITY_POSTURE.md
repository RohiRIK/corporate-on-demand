# Security Posture — `cod` sandbox

Branch: `feat/infra-scratch`. Scope: the one-container-per-workspace runner that executes
credential-free `opencode` agents.

## Threat model

Hostile inputs are **prompts and repository content**, not network peers. Any repo file, issue
body, or pasted URL may carry instructions aimed at the agent. The adversary we actually care
about is a *prompt-injection payload* that reaches an agent with filesystem and egress access.

Secondary adversary: a buggy or runaway agent process (fork bomb, disk fill, hung build).

## Blast radius of the shared container — stated plainly

**One container per workspace, not per agent.** All agents in a workspace share one filesystem,
one PID namespace, one network namespace, and one user. Therefore:

- Read isolation between agents is **not enforced**. Any agent can read every other agent's
  `/work/<other>` and any repo file. This is a *convention*, not a control.
- Write isolation is **not enforced** by the container. "Writes only to your own directory" is an
  instruction in a prompt to a non-adversarial-looking LLM. A prompt injection that convinces
  the model otherwise rewrites another agent's work. The only real consequence of a violation is
  **corrupted output**, not containment.
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

## Security theatre

Stated as controls anywhere they appear, and named as such here:

- **"Agents write only to their own `/work/<agent>`"** — theatre. Prompt instruction, not a
  mount or a `chown` boundary. Enforcement requires one container per agent, or per-agent UID
  plus distinct bind mounts. Neither is in scope.
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

That last row is the easiest to get wrong and the most important. Below Bun
1.3.12 `Bun.cron` does not exist, so a scheduler that does not check would
register nothing, report itself healthy, and silently never run a single job.
The container refuses to pretend instead.

## What is deliberately not enforced

- **Agent-to-agent isolation.** One container, one filesystem, one uid. Any
  agent can read and overwrite any other agent's files. Treat every agent as
  fully trusted and fully capable of sabotaging the others.
- **Write restriction.** Nothing stops an agent editing its own instructions.
  A prompt is a request, not a boundary.
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
3. **Cross-agent write corruption** from a compromised or confused agent. Detected by review,
   not prevented.
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
by this: the engine is a child process of the supervisor, confined to its
worktree by its working directory, exactly as `opencode` was.

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
