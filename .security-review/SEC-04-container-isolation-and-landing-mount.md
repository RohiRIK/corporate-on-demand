# SEC-04 — Container isolation: docker.sock guard is an exact-string blocklist; the writable landing mount hands host git credentials to every agent

**Severity: SEVERE (blocking) for finding B; SHOULD-FIX for finding A**
**Locations: `src/docker.ts:227-237` (`assertMountAllowed`), `src/docker.ts:484-492` (landing mount), `src/docker.ts:494-497` (network), `docker/Dockerfile.sandbox:127,132`**
**Class: CWE-250 execution with unnecessary privileges / CWE-269 privilege-context error**

## What is already right, and should be recorded as such

`buildRunArgv` (`docker.ts:269-308`) is better than most container setups: `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit 512`, `--user 1000:1000`, a named volume for `/work`, and an explicit refusal to bind anything by default. `Dockerfile.sandbox:127` sets `USER bun`, `:128` `WORKDIR /work`, and the base image is pinned by digest (`:13`) with the agent binary vendored (`:32`). The `/cod/cod.json` bind is `readOnly: true` (`:470`), which correctly stops the system rewriting the operator's workspace file. These are deliberate and they hold.

## Finding A — the socket guard matches exactly two strings, and only on the `source` field

`docker.ts:229-237`:

```ts
const FORBIDDEN_MOUNT_SOURCES = ["/var/run/docker.sock", "/run/docker.sock"] as const;
export function assertMountAllowed(source: string): void {
  for (const forbidden of FORBIDDEN_MOUNT_SOURCES) {
    if (source === forbidden) throw new UsageError(...);
  }
}
```

This is the single control standing between a container running arbitrary model-driven code and root on the host, and it is defeated by ordinary path variation:

- a **trailing slash or component** — `/var/run/docker.sock/` or `/run/docker.sock/…`;
- a **symlinked or non-standard path** — `/var/run/docker/podman.sock`, `/run/user/1000/docker.sock`, `/home/rohi/.docker/desktop/docker.sock`, or a rootless dockerd socket (common on this kind of host, and dockerd is exactly what the guard is meant to keep out);
- any other socket that grants the same API.

There is no normalisation at all: no `resolve()`, no `realpath()`, no trailing-separator trim, before the comparison. The comment at `:222-226` states the intent — "The Docker socket is the only path from 'contained' to 'host lost'" — and the implementation does not deliver the intent, which is worse than a missing check because the code reads as though the problem is solved.

Correct form: resolve the source, then refuse if the resolved path's basename is `docker.sock` or its parent is a docker/podman runtime directory. Better still, refuse by *policy* rather than by name — allowlist the mounts (the four at `:465-493`) instead of blocklisting the dangerous ones.

This one is reachable only by an operator (mount sources come from config, not from a model), so SHOULD-FIX rather than SEVERE on its own. It is listed here because it is the control that the whole container story leans on, and it is one `realpath()` away from being correct.

## Finding B — `workspace.landing.repo` is mounted WRITABLE at `/landing`, and it is a git repository

`docker.ts:484-492`:

```ts
...(workspace.landing === undefined ? [] : (() => {
  assertMountAllowed(workspace.landing.repo);
  return [{ source: workspace.landing.repo, target: "/landing", readOnly: false }];
})()),
```

`readOnly: false`, target `/landing`. And that same path is then used as a git remote: `src/land.ts:198-199` does `git push origin HEAD:refs/heads/cod-landed` inside it. It is therefore a git repository with a working `.git`, mounted read-write into a container whose agents run with `--auto` tool permission.

Consequences:

- The **host's git credentials** for that remote — `~/.gitconfig` credentials helper config, any `credential.helper store` file, any `insteadOf` / `pushInsteadOf` rewrite rules, and any SSH key or agent forwarding configured there — are visible and writable to every agent process. `credential.helper store` writes credentials to a plaintext `.git-credentials`; a writable bind means an agent can add one and capture the next push.
- The image sets `safe.directory '*'` (`Dockerfile.sandbox:132`) and a global identity (`:145-147`), which is defensible for `/work` but here means the agent is actively encouraged to operate on this mount.
- Because the mount is writable, an agent can modify `.git/config` on the host side. Note `land.ts:184-189` passes `-c core.hooksPath=/dev/null` and explicit identity for the **merge** in `/work`, and then performs an **unguarded** `git push` at `:199` against `/landing`. Whatever `core.hooksPath` `/work` has, `/landing/.git/config` is under the agent's control and is honoured by that push.

The comment at `:478-483` calls this "the single most dangerous thing this container could be given" and then grants exactly that. The intent and the implementation are in direct contradiction.

## Finding C — `network: "bridge"` with the containment claim withdrawn in the comment

`docker.ts:494-497` deliberately allows egress and the comment says so honestly: "This container is a trusted host process, not a containment boundary." That is a legitimate decision (agents install packages) and I am not asking for it to change. But the consequence must be stated once, centrally: with egress, a writable host git mount, and `--auto` agents, the agent-side *credential* boundary is the only one left, and Finding B removes it for the landing repo. The two decisions interact and neither comment cross-references the other.

## Concrete correction

1. `assertMountAllowed`: `realpathSync` the source before comparing, normalise trailing separators, and refuse on resolved basename `docker.sock` / parent `docker`/`podman` runtime dirs. Failing to resolve should refuse, not pass.
2. Make the `/landing` mount `readOnly: true`, and change the push at `land.ts:198-199` to a dedicated helper that runs with `-c core.hooksPath=/dev/null` and explicit identity, mirroring the merge. If a writable landing mount is genuinely required, it needs a stated reason and its own `assertMountAllowed`-equivalent credential policy.
3. Do not put `safe.directory '*'` and a writable global git identity in an image whose stated posture is "untrusted input, contained" (`boundary.ts:2-8`). Scope them to `/work` via a per-repo `safe.directory` rather than image-wide.
4. Add a test asserting `--security-opt no-new-privileges`, `--cap-drop ALL` and the read-only-ness of `/landing`. The comment at `docker.ts:265-267` says a test exists to pin this argv; extend it to cover the landing mount's mode, which is the flag most likely to be quietly flipped to `false`.

## Verification performed

Read-only. No container was started and no `docker run` executed.