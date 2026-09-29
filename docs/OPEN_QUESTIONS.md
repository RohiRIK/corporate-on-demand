# Open questions

Deliberately undecided. Each one is a decision that needs a person, not a
default that needs a coder.

## 1. Task execution is not wired

The scheduler registers jobs and reports that they fired. When a job fires it
logs:

```
job "heartbeat" -> agent builder: verify the container works (execution not wired yet)
```

No agent is dispatched. This is the honest state: the *schedule* is real and
verified end to end, the *work* is not yet performed by it.

Decide: does a cron job dispatch to a worker the same way an interactive
`cod run` does, or does the supervisor get its own dispatch path? The second is
simpler and keeps scheduled work off the interactive path entirely.

## 2. Model routing

Every worker currently carries one model from its template
(`opencode/space-bunny-free`). No tiering, no escalation.

Deferred deliberately. The token-economy question — lightweight for routine
work, expensive only when reasoning demands it — is a real project with real
cost implications, and guessing at thresholds before the schedule actually runs
jobs would optimise the wrong thing.

## 3. Merge and review policy

A `reviewer` worker exists in the template. Nothing defines what it reviews, or
what happens when it disagrees with the `builder`.

This was explicitly out of scope for the infrastructure pass, and it should stay
out of scope until jobs actually run, or the policy will be written against a
mechanism that does not exist yet.

## 4. Budget ceilings

`spend limits` appear in the original v3.8.0 skill. The current implementation
has none, and the absence is deliberate: with every model free and
unauthenticated, there is nothing to meter, and a ceiling that never fires is
theatre.

This becomes a real question the moment a paid model enters the picture. See
the credential rule in `docs/SECURITY_POSTURE.md` — that change needs a
decision, not a patch.

## 5. Cron result visibility

Cron schedules and their results are observable in three ways today:
`cod supervise` output, the container log, and a `supervisor` process
supervised by the CLI.

A GUI was discussed and explicitly deferred. If it comes back, note that the
requirement was a view of *the schedule and its results* — not an agent-activity
dashboard. `opencode web` is the latter and does not satisfy it.

## 6. Cross-agent coordination on a shared mount

One container, one filesystem, one uid. Two agents writing the same path
concurrently race, and the last writer wins. The supervisor serialises
*scheduled* work but nothing serialises two agents dispatched at once.

Decide whether the next phase introduces a work-claim or lock mechanism, or
accept the race and document it per job.
