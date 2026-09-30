---
name: cod-system
description: "Use when changing, extending, or debugging the cod CLI - onboarding, the shared container, cron scheduling, security controls, or what happens on a crash. Explains how the system actually works and why each boundary is where it is. NOT a runtime tool: this is the map you read before editing code."
version: 1.1.0
author: Rohi Rikman
license: MIT
metadata:
  hermes:
    tags: [cod, infrastructure, docker, cron, architecture]
    related_skills: [create-cli, homelab-source, agent-proof]
---

# cod System

Documentation for people and agents **changing** this system. The router
stays thin; the detail lives in `references/`.

## Start here

| Question | Read |
|---|---|
| How does the whole thing fit together? | `references/architecture.md` |
| How do I onboard a workspace? | `references/onboarding.md` |
| How does the container work and what is enforced? | `references/container.md` |
| How does scheduling work, and what are its limits? | `references/scheduling.md` |
| What happens when the supervisor dies? | `references/recovery.md` |
| What must never be broken? | `references/invariants.md` |

Changing agent execution, model calls, or the pass/fail decision? Read the
`agent-proof` skill first: how to judge a run instead of trusting it, and the
traps that each cost real time here.

## The four things to know before editing anything

1. **The unit of isolation is the workspace, not the agent.** One container per
   workspace. Every worker in it shares one filesystem, one uid, and one network
   namespace. If you need agents not to see each other's work, that is a new
   container, not a new directory.
2. **The ledger is a cache; the files are the truth.** `src/work.ts`. Any change
   that treats the `work` table as authoritative is how a lost job becomes a lost
   job permanently. Claim and commit are fenced on `lease_epoch`, and an agent
   killed mid-call is a **zombie, not a corpse** — it wakes up and tries to write.
3. **The only seam for real work is the driver in `src/dispatch.ts`.** Everything
   above it — schedule, container, dispatch loop, reconciler, logging, results,
   redaction — is real and tested. Replacing `echoDriver` is how a job starts
   doing work. Replacing anything else to make a job "work" is how you break the
   substrate.
4. **Container state and schedule state are different claims.** The container
   can be `up` with no schedule running. `cod status` reports them separately and
   exits 1 when they disagree, and any change here must preserve that.

## Rules for changing this system

- **Add a test that fails first.** Every bug in this repo's history was invisible
  to the unit tests and found by running a real container. A green suite is not
  evidence.
- **Run `sh scripts/cleanroom.sh` before claiming done.** It is the only check
  that exercises the whole path from an empty directory to an agent producing
  output.
- **Do not trust a mock.** If the change is about containers, schedules, or
  processes, verify against the real thing and quote the output.
- **Never add a credential.** See `references/invariants.md`; this is the single
  rule that most changes should be measured against.
