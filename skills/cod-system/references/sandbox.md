# The agent sandbox

What an agent may touch, how that is enforced, and how to change it without
opening a hole.

## Mechanism

Every agent runs through `cod-sandbox` (`docker/sandbox.c`): a static launcher
that restricts itself with **Landlock** and then `exec`s the engine. Landlock is
an unprivileged Linux LSM - no root, no capability, no namespace - so it works
under the container's `--cap-drop ALL` and no-new-privileges (it needs
`no_new_privs`, which Docker already set). Every child of the agent inherits the
restriction; there is no way to drop it from inside.

Rules are ALLOW rules on directory trees: `--ro PATH` grants read and execute
beneath it, `--rw PATH` grants everything beneath it, and anything not named is
denied. `/cod` is named by no rule, so it cannot be read, written or executed.
On ABI 6+ the launcher also scopes signals and abstract unix sockets, so an
agent cannot signal the supervisor that started it.

## Policy

`src/sandbox.ts` decides it, as pure functions a test can read:

| Function | For | Grants |
|---|---|---|
| `jobPolicy(..., mode: "write")` | a task, a writing cron job | reads the system and the repository; writes its own worktree, `.git/objects`, `.git/refs/heads/cod`, `.git/logs/refs/heads/cod`, `.git/worktrees/<job>`, plus `/tmp`, `/dev`, `$HOME` |
| `jobPolicy(..., mode: "read")` | a plan, a read-only cron job | reads the system and the repository; writes `/tmp`, `/dev`, `$HOME` only |
| `rolePolicy(scratch, ...)` | the reviewer, a meeting voice | reads the system; writes its scratch directory, `/tmp`, `/dev`, `$HOME` |

Everything an agent is denied is denied because it is not in its list: `/cod`,
the main checkout, `.git/config`, `.git/hooks`, `.git/info`, `.git/HEAD`, the
base branch's ref, other worktrees.

## Choosing whether to run

`chooseSandbox(mode, bin, exists)`:

- `"agentSandbox": "off"` in `cod.json` → `off`: agents run unconfined, and the
  supervisor logs it at `warn` every start.
- otherwise (`"required"`, the default) with no launcher → `missing`: `runAgent`
  refuses before spawning, with the reason.
- otherwise → `on`. A kernel without Landlock makes the launcher exit 78, and
  the run fails with its message.

The supervisor probes once at start (`cod-sandbox --probe`), logs the line, and
records it in the heartbeat; `cod status` and `cod supervise` show it.

## Changing it safely

- **Add to a list, never widen a path.** Granting `/work` instead of the
  worktree grants every other worktree and the main checkout. Granting
  `.git` instead of its subdirectories grants `config` and `hooks`, which the
  supervisor's own git reads.
- **A path that does not exist is skipped**, not created - create it before the
  sandbox opens if the agent needs it (the supervisor creates the `cod/` reflog
  directory for this reason).
- **Test it against the kernel.** `tests/sandbox.test.ts` compiles the real
  launcher and runs real git through it; a policy test without enforcement is a
  description. Add the denied case and the allowed case together - a denial
  that passes because the binary is missing proves nothing.
- **Never add a code path that spawns an engine directly.** Everything goes
  through `runAgent` with a sandbox choice and a policy.

## What it does not do

- Read isolation: an agent can read the repository and every other worktree.
- `/tmp` and `$HOME` are shared by every agent.
- Any `cod/` ref is writable, not only the agent's own - refs share a
  directory, and Landlock grants directories.
- The object store is writable (commits need it); the host-side export runs
  `git fsck --strict` on every bundle before importing it.
- Egress is open, by design.
