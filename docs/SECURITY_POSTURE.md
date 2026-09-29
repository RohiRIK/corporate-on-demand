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

0. **Logs contain raw job output, unredacted.** `<stateDir>/logs/cod.jsonl`
   holds whatever a job printed, verbatim. Today that is an `echo` of a task
   string, so the exposure is nil. The moment agents do real work, this file
   becomes a place credentials, tokens and source can land, and **redaction
   stops being an improvement and becomes a requirement**. It is deliberately
   not implemented now: a redactor written before there is real output to redact
   would be untested, and an untested redactor is a false claim of safety. Log
   rotation bounds the file at `5 MB x 4` per workspace.

1. **Egress = exfiltration channel.** Any source file readable in the container can be POSTed
   out. Mitigation would be `--network none` plus a package proxy/allowlist — explicitly out of
   scope. Accepted.
2. **Cross-agent write corruption** from a compromised or confused agent. Detected by review,
   not prevented.
3. **Supply chain** on the unfiltered egress path: agents install packages by design.
4. **Host kernel** is the trust boundary. A container escape (kernel bug, or the socket, if ever
   added) is game over. Everything above assumes the host is not itself compromised.

## The three rules

1. **Never mount `/var/run/docker.sock` into this container.** No exceptions, no debugging.
2. **Never add a credential to this workspace.** No model API key, no registry token, no `.env`.
   This is what keeps the worst case at "source code leaves the host".
3. **Never describe prompt-level rules, the token budget, or `--network none`-removal as
   mitigations.** If it is not in the table above, it is a policy, and policies are written in
   the prompt.
