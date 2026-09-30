# Container

What the container enforces, what it does not, and how to change either safely.

## The image

`docker/Dockerfile.sandbox`, base `oven/bun:1.3.12`.

- **The base is pinned by digest**, not by tag. A tag is a moving pointer; a
  digest names the exact image that was tested.
- **opencode 1.18.31 is vendored** (177 MB) by `scripts/vendor-opencode.sh` with
  a pinned sha256, and copied in. It is deliberately **not committed** - a
  binary blob in git is permanent and makes every clone 177 MB heavier. This
  cost 78 MB of repo history once, and had to be purged with a history rewrite.
- The supervisor is **bundled** with `bun build --target=bun`, not copied as
  loose `.ts` files. Copying them pulled in an import graph the container has no
  `node_modules` for, and it died on the first import.
- The image runs as the base image's existing `bun` user at **UID 1000**.
  `useradd --uid 1000` fails: the uid is already taken.

## Enforced controls

Verified against a live container by `scripts/cleanroom.sh` on every run, so a
claim that drifts from the code fails the build.

| Control | How |
|---|---|
| Non-root | `USER bun`, `--user 1000:1000` |
| No capabilities | `--cap-drop ALL` |
| No privilege gain | `--security-opt no-new-privileges` |
| PID ceiling | `--pids-limit 512` |
| Memory ceiling | `--memory 2g` |
| No credentials | opencode runs unauthenticated; the clean-room fails if an `auth.json` appears |
| No Docker socket | never passed as a mount; the clean-room fails if any bind names it |
| Read-only workspace | `cod.json` mounted `ro` |
| Bounded output | 4 MB per stream per command, tail kept |
| Self-restart | `--restart`, capped - see `recovery.md` |

## Not enforced - do not rely on these

- **Agent-to-agent isolation.** One container, one filesystem, one uid. Any
  agent can read and overwrite any other agent's files. This is the accepted
  cost of "one container, many agents". Worktrees are the planned fix
  (one branch per worktree).
- **Write restriction.** Nothing stops an agent editing its own instructions.
- **Spend ceilings.** No accounting boundary inside the container.
- **Egress filtering.** Outbound is required - agents must install what a
  project needs - and that is also the exfiltration path.

## Changing a container flag

`buildRunArgv` in `src/docker.ts` is the single source. Its output is pinned by
tests, so a flag that is silently dropped fails rather than disappearing.

Two constraints that are Docker's, not ours:

- **`--rm` and `--restart` cannot be combined.** Docker refuses both together,
  and `--rm` would delete the container on the very exit the restart policy acts
  on. `cod down` removes explicitly and still refuses to remove a container it
  did not create.
- **A restart policy only engages after a container is up for ~10 seconds.**
  Docker does this deliberately, to stop a container that never starts from
  looping.

## Verification

```sh
cod up
docker inspect cod-sandbox-cod --format '{{json .HostConfig}}' | jq '{
  CapDrop, SecurityOpt, PidsLimit, Memory, RestartPolicy }'
docker exec cod-sandbox-cod id -u          # 1000
sh scripts/cleanroom.sh /tmp/cod-verify   # all 19 checks
```
