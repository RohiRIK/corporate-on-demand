---
name: cod-operations
description: Use when something is wrong with a cod workspace from the HOST - the container will not start, the system looks stuck, or you need to read state, logs and results without going inside. Runbook only; safe to read, destructive steps are marked.
---

# Operating a cod workspace from outside the container

For the host operator. Everything here runs on the **host**, against a workspace
file, and is safe to run while the container is live.

The rule that makes this file exist: **the agent's world ends at the container
boundary.** An agent inside cannot see Docker, the host filesystem outside its
mounts, or your shell. So a diagnosis that needs those facts can only be run
from here, and its output has to come back in as a fact rather than a feeling.

## Start with the read-only triage

Always this first. It cannot change anything.

```bash
cod doctor            # config, image, container, volume, state
cod status            # is the container up, what is the supervisor doing
cod logs --tail 200   # the supervisor's own log
cod results           # what each job did, and WHICH FILES it changed
cod work list         # the ledger: what is proposed, running, failed
```

`cod results` is the line that matters most. It shows the changed files, so a
job that is failing can be distinguished from a job that is idle without
opening a diff:

```
ok   author   16721ms r0  [1 file: answer.txt]  builder: Create a file…
```

## The four problems, and what each actually looks like

### 1. The container will not start

**Symptom:** `cod up` fails, or the container exits immediately.

```bash
docker ps -a --filter name=cod-sandbox        # is it there, and what state
docker logs <container> --tail 100            # the real error
cod doctor                                   # image present? config valid?
```

The usual cause is a **missing image**, because the image is built rather than
pulled:

```bash
cod build          # rebuilds cod-sandbox
```

If the logs show the entrypoint dying, read `docker/entrypoint.sh` first - the
entrypoint is what seeds the initial Git commit, and a volume that has `.git`
but no commit cannot create a worktree.

### 2. A job is stuck and the ledger shows `running`

Read the ledger, then reconcile. Reconcile is the thing that resolves stuck
items, and it is safe to run at any time:

```bash
cod work list
cod reconcile            # expired leases, lost acks, zombie runs
cod work list            # did the item move
```

A job that stays `running` across two reconciles is a **zombie**, and its
result will be fenced when it finally returns. Reconcile exists precisely so
you do not have to wait it out.

### 3. It all looks stuck and nothing is moving

Check the free model rather than the system. The provider is intermittent, and
a hung call looks identical to a broken scheduler. There are now **two
engines**, so check both - one being down while the other works is the normal
state of a free tier, and it is why both are installed:

```bash
docker exec <container> sh -lc 'cd /work && timeout 60 kilo run --pure --auto --format json -m kilo/kilo-auto/free "What is 2 plus 2?"'
docker exec <container> sh -lc 'cd /work && timeout 60 opencode run --pure --auto --format json -m opencode/space-bunny-free "What is 2 plus 2?"'
```

If BOTH hang or error, the system is fine and the **providers** are not. If
either answers, the scheduler is the problem and `cod logs` will say so.

Note `--auto`: it is required by both engines, and without it every tool call is
auto-rejected and the run reports success having done nothing.

### 3a. A result says FAIL and the reason looks like a provider error

`agent FAILED: agent reported an error: ...` means the run was **judged, not
merely attempted**. `cod` now refuses to call a run successful unless the event
stream proves work happened: a terminal `step_finish`, at least one completed
tool, no error events, and a real prompt.

So `FAIL` is a good outcome for a system that used to lie. The two you will see:

- `no completed tool: the agent produced text without doing anything` - the
  agent claimed the work without doing it. Treat the work as NOT done.
- `no terminal step_finish: the run was truncated, not completed` - a known
  upstream stream bug. Re-run it; a retry is safe because each job gets a fresh
  worktree.

Every provider failure now carries the engine's own log line, found by the
`ref=err_...` id. If it says `no log entry found`, the engine wrote nothing for
that id - which is a fact about the log, not about the failure.

### 3b. A job is read-only and is reported as having done nothing

A job that only inspects and reports makes no tool call, so the assertion would
reject it. Those jobs are marked in `cod.json`:

```json
{ "name": "report", "expectTools": false, "task": "..." }
```

The default is **strict** - a job is expected to change something. Only set
`expectTools: false` for a job that genuinely reads and reports; it is a
narrower pass, not a bypass, so the job must still finish cleanly and have been
given a real prompt.

### 4. Everything is fine but you want it to start by itself

`cod down` stops the container. That is not the same as boot persistence - the
container's restart policy does not survive a recreated host:

```bash
cod boot install acme   # writes a systemd unit
systemctl --user enable cod-workspace@acme.service
```

## Destructive steps, and their undo

These are the only ones that lose anything. Each says what is lost first.

```bash
cod down               # STOPS the container. The work VOLUME is kept.
cod purge              # asks first; --purge skips the question. DELETES the
                       # work volume: every branch, commit and worktree.
```

`cod purge` destroys the agent's committed work. There is no undo and no
backup, because the volume is the only copy. Use `cod down` unless you are
certain.

## What NOT to do

- **Do not `docker exec` to fix a job.** The worktree and the ledger are already
  consistent; hand-editing them behind the system's back is how a healthy
  workspace becomes one that cannot be reconciled.
- **Do not edit the ledger database directly.** It is the source of truth for
  leases and epochs, and a hand-edited epoch is a fencing token that no longer
  fences.
- **Do not `docker rm -f` a container you did not create.** `cod down` only
  touches containers carrying this workspace's own label, which is why decoy
  containers survive it. Plain `docker rm` has no such guard.
- **Do not add a paid model to `src/backend.ts` to unblock a job.** A test
  fails the build if one appears, and it would: the container holds no
  credential, so the run would fail rather than cost you - but the failure
  would look like a provider outage.
- **Do not re-pin a single model to "fix" flakiness.** That is the failure this
  whole rotation mechanism exists to remove.
- **Do not widen an agent's blast radius to unblock a job.** If a job is
  refused for touching `src/`, that refusal is the boundary working. The CEO
  re-proposes it deliberately; you do not.
