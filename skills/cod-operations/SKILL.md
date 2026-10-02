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
cod status            # container, supervisor, sandbox, blocked, unexported
cod logs --last 200   # the supervisor's own log; the governance line per tick
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
cod up                                        # quotes the container's FATAL lines
docker logs "$(cod container-name --json | jq -r .container)" --tail 100
cod doctor                                    # image present? config valid?
```

`cod up` waits for a live supervisor and, when there is none, prints what the
container said. The causes, most common first:

- **`uid 1000 cannot write the state directory`** - the state directory
  belongs to another user (a root `cod init`, a `sudo cod work ...`). The
  container runs as uid 1000. `cod up` prints the exact command:
  `sudo chown -R 1000:1000 <state dir>`.
- **A missing image** - it is built, not pulled: `cod image --rebuild`.
- **`agent sandbox: UNAVAILABLE`** in the log - the kernel has no Landlock, so
  agents will be refused (the supervisor still runs). Use a newer kernel, or
  set `"agentSandbox": "off"` in `cod.json` to accept running them unconfined.

`cod up` also replaces a container of this workspace that is stopped, or that
no longer matches `cod.json` or the image - so after editing `cod.json`, `cod up`
is the whole step.

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

### 2a. It says "up" but nothing is happening

`cod status` reports container state and ledger state as DIFFERENT claims. If
the blocked line is non-zero, work has stopped and is waiting on you:

```bash
cod status                 # the "blocked" line
cod work blocked           # what stopped, oldest first, with the reason
```

To look at one again: `cod work unblock <id> [why]` - a rejected item is
reviewed again, a failed one (three failed runs) goes back on the queue. An item
the reviewer sent back for changes is mid-retry, and unblocking it needs
`--override`, which is recorded as an operator override. Nothing clears a
rejection automatically - that would let a rejected item re-enter the queue on
its own, which is the company arguing with itself. `cod work run <id>` runs a
`ready` item now, in the container, the same way the tick would.

A department that stopped proposing is in the governance line of `cod logs`:
`held: its last 3 tasks all ended badly` (three strikes - unblock or fix what it
keeps getting wrong), or `held: resting until ...` (its plans found nothing new;
it will plan again by itself).

### 3. It all looks stuck and nothing is moving

Check the free model rather than the system. The provider is intermittent, and
a hung call looks identical to a broken scheduler. There are now **two
engines**, so check both - one being down while the other works is the normal
state of a free tier, and it is why both are installed:

```bash
c="$(cod container-name --json | jq -r .container)"
for model in kilo/kilo-auto/free opencode/space-bunny-free; do
  engine="${model%%/*}"
  docker exec "$c" sh -c 'd=$(mktemp -d) && cd "$d" && exec cod-sandbox --ro /usr --ro /bin --ro /lib --ro /lib64 --ro /etc --ro /proc --ro /sys \
    --rw /tmp --rw /dev --rw "$HOME" --rw "$d" -- timeout 60 '"$engine"' run --pure --auto --format json -m '"$model"' "What is 17 multiplied by 23?"'
done
```

In a scratch directory and through the sandbox, like every agent - never
`cd /work`: an engine with `--auto` in the main checkout is an unconfined agent
in the live repository. Look for `391` in a `"type":"text"` line.

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
container's restart policy does not survive a host reboot. The systemd unit in
`ops/` runs `cod up` on boot; `ops/README.md` has the steps:

```bash
sudo install -m 644 ops/cod-workspace@.service /etc/systemd/system/
sudo install -d -o 1000 -g 1000 -m 0750 /var/lib/cod/acme
sudo cod init acme --yes --workspace /var/lib/cod/acme/cod.json --state /var/lib/cod/acme
sudo chown -R 1000:1000 /var/lib/cod/acme
sudo systemctl enable --now cod-workspace@acme.service
```

## Destructive steps, and their undo

These are the only ones that lose anything. Each says what is lost first.

Where landed work goes: merges happen in the `/work` volume, and after each one
the supervisor writes the base branch as a bundle into the state directory. A
workspace naming `landing.repo` imports it with `cod land` - verified, and
fast-forward only - as `refs/heads/cod-landed`; pushing it anywhere is yours.
`cod status` says when there is landed work you have not exported. If `cod land`
refuses because the history no longer descends (the volume was purged and
recreated), `cod land --force` replaces the ref.

```bash
cod down               # STOPS the container. The work VOLUME is kept.
cod purge              # refuses without --purge. DELETES the work volume -
                       # every branch, commit and worktree - and the export.
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
