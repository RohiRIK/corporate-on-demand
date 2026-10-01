# SEC-04 — Assert the sandbox claims; two hold, two are weaker than stated (MEDIUM / INFO)

Requested: verify each claim from the code, not the comments.

## HOLDS — no Docker socket in the container

`assertMountAllowed` (`src/docker.ts:229-237`) refuses `/var/run/docker.sock` and
`/run/docker.sock`, and it is called on **every** bind mount in the mount loop
(`docker.ts:322`) and again on the landing-repo mount before it is built
(`docker.ts:490`). This is the right place — the guard's result is not a filtered value that
goes on being used, it throws. Verified, not assumed.

No `--privileged`, no `--cap-add`, no `-v /var/run` anywhere in `buildRunArgv`
(`docker.ts:269-328`). `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit 512`
are all present and are asserted by a test per the comment at `docker.ts:264-267`.

## HOLDS — runtime UID 1000, non-root

`user: "1000:1000"` (`docker.ts:503`), `USER bun` (`Dockerfile.sandbox:127`), and the build
*fails* if the base image's `bun` is not UID 1000 (`Dockerfile.sandbox:41-42`). That is a
genuine anti-drift assertion, not a comment.

## HOLDS — one shared container

One container per workspace: `containerNameForFile` / `containerName`
(`docker.ts:218-220`), with `safeSegment` (`docker.ts:209-216`) enforcing
`^[a-z0-9][a-z0-9-]*$` on the workspace name before it becomes part of a container name — so
no injection into `docker run` argv and no name collision between workspaces. Good.

## HOLDS — no inter-container networking

`network: "bridge"` (`docker.ts:497`), the default bridge, not a user-defined network. No
`--link`, no container name resolution beyond the default bridge's own DNS, and no
`proxy-net`-style external network membership (consistent with the homelab AGENTS.md rule at
`projects/` that a project must not join `proxy-net`). Two cod containers on the default
bridge *can* reach each other by IP/port — Docker's default bridge is a shared L2 segment.
This is not a finding today (one container per workspace, nothing listening), but "no
inter-container networking" is slightly stronger than what `bridge` guarantees.

## WEAKER THAN STATED — host credentials

Claim: credential-free. Code: `env: { TZ: workspace.timezone }` is the **only** environment
explicitly set (`docker.ts:501`), and `entrypoint.sh:94-97` installs nothing, deliberately and
loudly.

But the env map is what cod *adds*. It does not control what the Docker daemon injects, and
the container is not started with `--env-file` or `-e` for anything else — so by default
Docker contributes only its own small set (`PATH`, `HOSTNAME`, `HOME`, plus image
`ENV`). No `~/.docker`, no `SSH_AUTH_SOCK`, no cloud credential files are mounted. **This claim
holds.**

The real caveat is the opt-in landing mount (`docker.ts:479-491`): when
`workspace.landing.repo` is set, that host path is bind mounted **read-write** at `/landing`,
and an agent with `--auto` can write into it — and then `land.ts:199` pushes from it. An agent
that can write the landing repo can therefore influence what `git push origin` sends. That is
opt-in and operator-nominated, so it is a documented consequence rather than a flaw, but it
means "writable host path with agent write access" is reachable in the default configuration
for anyone who sets `landing`.

## WEAKER THAN STATED — what UID 1000 reaches on the host

Runtime UID 1000 is the **host operator's own UID** (`rohi`, per the file ownership throughout
this checkout). That is not a container-escape on its own — the container has no host mounts
outside the four listed — but it means:

- Every writable bind (`stateDir` at `/cod`, `/landing`, the `/work` volume) is written by a
  process whose UID matches the operator's. Host-side file ownership is therefore unchanged by
  agent writes, and nothing downstream can distinguish "the operator wrote this" from "an agent
  wrote this". No `agent`-specific UID, no separate namespace identity.

Combined with SEC-03 (state volume writable), agent-written ledger rows look exactly like
operator-written ones.

## Summary table

| Claim | Verdict |
|---|---|
| no Docker socket inside | HOLDS — refused centrally at `docker.ts:229`, tested path |
| no host credentials | HOLDS — env is TZ only; no agent creds mounted |
| runtime UID 1000 | HOLDS — asserted at build, pinned in argv |
| one shared container | HOLDS — names are slug-validated |
| no inter-container networking | MOSTLY HOLDS — default bridge still puts containers on a shared L2 segment |
| mounts | 3 rw binds/volume + 1 ro; `/work` and `/cod` rw, `/landing` opt-in rw, `cod.json` ro |