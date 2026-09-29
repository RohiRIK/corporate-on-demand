# Open questions

Deferred, not forgotten. These were consciously pushed out of the
infrastructure and automation pass, and each is a decision that needs a person
rather than a default that needs a coder.

## Closed: task execution

A scheduled job now runs and returns a result. What it runs is an `echo` — by
decision, not by omission:

```
[cron] heartbeat firing at 2026-09-29T07:29:00.002Z
job "heartbeat" -> builder: verify the container works
[cron] heartbeat finished in 0ms
```

The plumbing is real end to end: a `Bun.cron` tick reaches a named agent's
task and the result comes back out. The *work* is an echo because the policy
around real work is undecided, and guessing at it would have optimised the
wrong thing. `src/task.ts` is the single seam — the real dispatcher replaces
`echoTask` and nothing above it changes.

An echo was chosen over a real model call for one reason: it cannot fail for
interesting reasons. If a scheduled job breaks, the cause is the scheduling,
not the work.

## 1. Model routing

Every worker carries one model from its template
(`opencode/space-bunny-free`). No tiering, no escalation.

Deferred deliberately. The token-economy question — lightweight for routine
work, expensive only when reasoning demands it — is a real project with real
cost implications, and guessing at thresholds before the schedule actually runs
jobs would optimise the wrong thing.

## 2. Merge and review policy

A `reviewer` worker exists in the template. Nothing defines what it reviews, or
what happens when it disagrees with the `builder`.

Worth deciding alongside real task execution, since a review policy written
against an `echo` would be a policy about nothing.

## 3. Budget ceilings

`spend limits` appear in the original v3.8.0 skill. There are none here, and
the absence is deliberate: every model is free and unauthenticated, so there is
nothing to meter, and a ceiling that never fires is theatre.

This becomes a real question the moment a paid model enters the picture. See
the credential rule in `docs/SECURITY_POSTURE.md` — that change needs a
decision, not a patch.

## 4. Cron result visibility

Schedules and results are observable three ways today: `cod supervise` output,
the container log, and the supervisor process.

A GUI was discussed and explicitly deferred. If it returns, the requirement is
a view of *the schedule and its results* — not an agent-activity dashboard.
`opencode web` is the latter and does not satisfy it.

## 5. Cross-agent coordination on a shared mount

One container, one filesystem, one uid. Two agents writing the same path
concurrently race, and the last writer wins. The supervisor serialises
*scheduled* work; nothing serialises two agents dispatched at once.

Decide whether to add a work-claim or lock mechanism, or accept the race and
document it per job. This only becomes reachable once agents run concurrently
for real, which is why it is not part of the echo stage.
