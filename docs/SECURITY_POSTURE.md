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

## Residual risk, accepted

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
