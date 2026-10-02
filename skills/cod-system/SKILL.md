---
name: cod-system
description: "Use when changing, extending, or debugging the cod CLI - onboarding, the shared container, cron scheduling, security controls, or what happens on a crash. Explains how the system actually works and why each boundary is where it is. NOT a runtime tool: this is the map you read before editing code."
version: 1.2.0
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
| What may an agent touch, and how is that enforced? | `references/sandbox.md` |
| What must never be broken? | `references/invariants.md` |

Changing agent execution, model calls, or the pass/fail decision? Read the
`agent-proof` skill first: how to judge a run instead of trusting it, and the
traps that each cost real time here.

## The four things to know before editing anything

1. **The unit of isolation is the workspace; the sandbox confines each agent's
   writes.** One container per workspace, one filesystem, one uid, one network.
   Inside it every agent runs under Landlock (`references/sandbox.md`): it may
   write its own worktree and nothing that matters to anyone else. Reads are
   shared - if agents must not SEE each other's work, that is a new container.
2. **The ledger is a cache; the files are the truth.** `src/work.ts`. Any change
   that treats the `work` table as authoritative is how a lost job becomes a lost
   job permanently. Claim and commit are fenced on `lease_epoch`, and an agent
   killed mid-call is a **zombie, not a corpse** — it wakes up and tries to write.
3. **Every agent starts in one place: `runAgent` in `src/agent.ts`**, reached
   through the driver (`src/drivers.ts`), with a sandbox policy. Its run is
   judged by the event stream, never by its exit code or its own account, and
   what it changed is read from git. A second way to start an engine is an
   unconfined agent.
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
