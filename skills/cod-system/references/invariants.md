# Invariants

The rules that most changes should be measured against. Breaking one is how
this system goes from "contained" to "catastrophic".

## The three rules

1. **Never mount `/var/run/docker.sock` into this container.** No exceptions,
   not even for debugging. It is host root. The clean-room fails the run if any
   bind names it.
2. **Never add a credential to this workspace.** No model API key, no registry
   token, no `.env`. This is what keeps the worst case at "source code leaves
   the host". Every model is free and unauthenticated, so there is nothing to
   meter - and a `sk-…` appearing in the repo would hand a compromised agent a
   budget.
   - Redaction strips known credential *shapes* from anything the system writes.
     It is a safety net, not permission: a secret in prose or an unknown format
     still gets through, and `cod.json` is not rewritten.
3. **Never describe a prompt-level rule as a mitigation.** "Never read
   `/work/other`", "never exfiltrate" - these reduce accidents. They have zero
   value against a determined injection. If a control is not in the enforced
   table in `container.md`, it is a policy, and policies live in the prompt.

## Structural invariants

- **One container per workspace.** The unit of isolation is the workspace, not
  the agent. Adding a second container per agent is a different architecture,
  not a configuration change.
- **One branch per git worktree.** Git refuses two worktrees on the same branch.
  This is the mechanism that makes concurrent job writes safe.
- **Never rewrite `cod.json`.** It is the operator's file, mounted read-only.
- **Truncation is always reported.** A bounded read that silently truncates is
  worse than an unbounded one, because it looks like the whole truth.
- **Every failure leaves a trace.** Results are written from a `finally`;
  prunes are logged; rejected cron jobs are named. Silence is the failure mode.

## The recurring lesson

Every serious bug in this repo's history was **invisible to the unit tests and
found by running a real container**:

- the timezone, off by three hours, reporting success;
- UID 1000 already taken, failing the image build;
- the supervisor wrapper being a shell script handed to `bun run`;
- a fresh workspace crash-looping because nothing held the event loop open;
- `sed` on the workspace file creating seven directories where three belonged.

164 unit tests were green through all of them. **A green suite is not evidence.**
Before claiming a change works, run the real thing and quote its output:

```sh
sh scripts/cleanroom.sh /tmp/cod-verify   # empty dir -> a real agent working
```
